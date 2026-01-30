import { prisma } from "@/lib/db";

type SeverityCategory =
  | "SAFETY"
  | "LEGAL"
  | "FRAUD"
  | "ETHICS"
  | "PRICING"
  | "SUPPORT"
  | "OTHER";

const SEVERITY_WEIGHTS: Record<SeverityCategory, number> = {
  SAFETY: 1.0,
  LEGAL: 0.9,
  FRAUD: 0.9,
  ETHICS: 0.85,
  PRICING: 0.6,
  SUPPORT: 0.55,
  OTHER: 0.4,
};

const SOURCE_WEIGHTS: Record<string, number> = {
  RSS: 0.9,
  REDDIT: 0.6,
};

const NEGATIVE_WORDS = [
  "scam","fraud","unsafe","danger","dangerous","fire","overheating","explode","lawsuit","illegal",
  "boycott","hate","terrible","awful","broken","defect","recall","misleading","fake","refund",
  "complaint","angry","worst","ripoff","chargeback","stolen","criminal","shock","outrage"
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function classifySeverity(text: string): SeverityCategory {
  const t = normalize(text);

  const safety = ["unsafe","danger","dangerous","fire","overheat","overheating","explode","explosion","injury","injured","death","fatal","recall","smoke","burning"];
  const legal  = ["lawsuit","legal","court","illegal","regulator","regulatory","compliance","ban","fine","penalty","investigation"];
  const fraud  = ["scam","fraud","fake","counterfeit","stolen","phishing","chargeback","ripoff"];
  const ethics = ["racist","sexist","harassment","abuse","discrimination","unethical","privacy","data leak","breach"];
  const pricing = ["price","pricing","fees","hidden fee","overpriced","markup","dealer markup","bait","switch"];
  const support = ["support","service","customer service","ignored","no response","waiting","delay","rude","refund"];

  const has = (arr: string[]) => arr.some((k) => t.includes(k));

  if (has(safety)) return "SAFETY";
  if (has(legal)) return "LEGAL";
  if (has(fraud)) return "FRAUD";
  if (has(ethics)) return "ETHICS";
  if (has(pricing)) return "PRICING";
  if (has(support)) return "SUPPORT";
  return "OTHER";
}

function negativeIntensity(text: string): number {
  const t = normalize(text);
  let hits = 0;
  for (const w of NEGATIVE_WORDS) if (t.includes(w)) hits += 1;
  // map hits to 0..100
  return clamp(hits * 12, 0, 100);
}

// Logistic-ish mapping to percent 0..95
function escalationPercent(riskScore: number, velocityScore: number, horizon: "24h" | "72h"): number {
  const base = horizon === "24h" ? -2.2 : -1.6; // 72h slightly higher baseline
  const x = base + (riskScore / 22) + (velocityScore / 35);
  const p = 1 / (1 + Math.exp(-x));
  return clamp(Math.round(p * 100), 1, 95);
}

function round0to100(x: number) {
  return clamp(Math.round(x), 0, 100);
}

export async function scoreIssuesForOrg(organizationId: string) {
  const brands = await prisma.brand.findMany({
    where: { organizationId },
    select: { id: true },
  });

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  let issuesScored = 0;

  for (const b of brands) {
    // score recent issues only (MVP)
    const issues = await prisma.issue.findMany({
      where: { brandId: b.id },
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: { id: true },
    });

    for (const issue of issues) {
      const ims = await prisma.issueMention.findMany({
        where: { issueId: issue.id },
        include: { mention: true },
        orderBy: { mention: { createdAt: "desc" } },
        take: 250,
      });

      if (ims.length === 0) continue;

      const mentions = ims.map((x) => x.mention);

      // Velocity
      const last1h = mentions.filter((m) => m.createdAt >= oneHourAgo).length;
      const last6h = mentions.filter((m) => m.createdAt >= sixHoursAgo).length;
      const last24h = mentions.filter((m) => m.createdAt >= dayAgo).length;

      // avoid divide by zero; compare last hour to prior 5 hours approx
      const prior5h = Math.max(last6h - last1h, 0);
      const velocityRaw = last1h / Math.max(1, prior5h / 5); // ratio vs baseline per hour
      const velocityScore = round0to100(clamp(velocityRaw * 22, 0, 100)); // tuned scale

      // Authority: average by sourceType, plus a little bump if multiple RSS domains exist
      const authorityAvg =
        mentions.reduce((acc, m) => acc + (SOURCE_WEIGHTS[m.sourceType] ?? 0.5), 0) /
        Math.max(1, mentions.length);

      const authorityScore = round0to100(authorityAvg * 100);

      // Severity: classify by combined text; take max category seen (conservative)
      const categories = mentions.map((m) => classifySeverity(m.text));
      const maxSeverityWeight = categories.reduce((mx, c) => Math.max(mx, SEVERITY_WEIGHTS[c]), 0.4);
      const severityScore = round0to100(maxSeverityWeight * 100);

      // Spread: distinct sources + distinct URLs + distinct RSS domains
      const distinctSourceTypes = new Set(mentions.map((m) => m.sourceType)).size;
      const distinctSources = new Set(mentions.map((m) => m.sourceName)).size;
      const distinctUrls = new Set(mentions.map((m) => m.url)).size;

      const domains = new Set<string>();
      for (const m of mentions) {
        if (m.sourceType === "RSS") {
          try {
            const u = new URL(m.url);
            domains.add(u.hostname.replace(/^www\./, ""));
          } catch {
            // ignore invalid URLs
          }
        }
      }

      const spreadRaw = distinctSourceTypes * 12 + distinctSources * 5 + domains.size * 10 + Math.min(25, distinctUrls / 10);
      const spreadScore = round0to100(spreadRaw);

      // Sentiment: negative intensity max over recent mentions
      const sentimentScore = round0to100(
        Math.max(...mentions.slice(0, 40).map((m) => negativeIntensity(m.text)), 0)
      );

      // Pattern: “dangerous combo” detector
      const patternScore = round0to100(
        (severityScore >= 85 ? 40 : 0) +
          (authorityScore >= 70 ? 30 : 0) +
          (velocityScore >= 70 ? 30 : 0)
      );

      // Final weighted risk (0..100)
      const risk =
        velocityScore * 0.25 +
        authorityScore * 0.25 +
        severityScore * 0.2 +
        spreadScore * 0.15 +
        sentimentScore * 0.1 +
        patternScore * 0.05;

      const score0to100 = round0to100(risk);

      const escalation24h = escalationPercent(score0to100, velocityScore, "24h");
      const escalation72h = escalationPercent(score0to100, velocityScore, "72h");

      // Upsert RiskScore
      await prisma.riskScore.upsert({
        where: { issueId: issue.id },
        update: {
          score0to100,
          velocityScore,
          authorityScore,
          severityScore,
          spreadScore,
          sentimentScore,
          patternScore,
          escalation24h,
          escalation72h,
          computedAt: new Date(),
        },
        create: {
          issueId: issue.id,
          score0to100,
          velocityScore,
          authorityScore,
          severityScore,
          spreadScore,
          sentimentScore,
          patternScore,
          escalation24h,
          escalation72h,
        },
      });

      // Recommendation rules
      const category = maxSeverityWeight >= 1.0 ? "SAFETY" : categories[0] ?? "OTHER";
      let action: "IGNORE" | "MONITOR" | "PREPARE" | "ESCALATE" = "IGNORE";
      let owner: "PR" | "LEGAL" | "CX" | "EXEC" = "PR";
      let posture: "SILENT" | "CORRECTIVE" | "PROACTIVE" = "SILENT";

      const safetyOrLegal = severityScore >= 85 && (category === "SAFETY" || category === "LEGAL" || category === "FRAUD");
      if (score0to100 >= 75 || safetyOrLegal) {
        action = "ESCALATE";
        owner = safetyOrLegal ? "LEGAL" : "PR";
        posture = "CORRECTIVE";
      } else if (score0to100 >= 50) {
        action = "PREPARE";
        owner = "PR";
        posture = "PROACTIVE";
      } else if (score0to100 >= 30) {
        action = "MONITOR";
        owner = "PR";
        posture = "SILENT";
      } else {
        action = "IGNORE";
        owner = "PR";
        posture = "SILENT";
      }

      const drivers = [
        `velocity=${velocityScore}`,
        `authority=${authorityScore}`,
        `severity=${severityScore}`,
        `spread=${spreadScore}`,
        `sentiment=${sentimentScore}`,
      ].join(", ");

      const rationale = `Drivers: ${drivers}. Mentions: last1h=${last1h}, last6h=${last6h}, last24h=${last24h}.`;

      await prisma.recommendation.upsert({
        where: { issueId: issue.id },
        update: { action, owner, posture, rationale },
        create: { issueId: issue.id, action, owner, posture, rationale },
      });

      issuesScored += 1;
    }
  }

  return { issuesScored };
}
