import { prisma } from "@/lib/db";

type ClusterResult = {
  brandId: string;
  scannedMentions: number;
  assignedToExisting: number;
  createdIssues: number;
  errors: number;
};

type TokenMap = Map<string, number>;

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","else","to","of","in","on","for","with","at","by",
  "from","as","is","are","was","were","be","been","being","it","this","that","these","those",
  "you","your","we","our","they","their","i","me","my","he","she","his","her","them","us",
  "not","no","yes","can","could","should","would","will","just","about","into","over","under",
  "more","most","less","very","new","now"
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  const t = normalize(text);
  if (!t) return [];
  return t
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function toTf(tokens: string[]): TokenMap {
  const m: TokenMap = new Map();
  for (const tok of tokens) m.set(tok, (m.get(tok) ?? 0) + 1);
  return m;
}

function cosine(a: TokenMap, b: TokenMap): number {
  let dot = 0;
  let a2 = 0;
  let b2 = 0;

  for (const [, av] of a) a2 += av * av;
  for (const [, bv] of b) b2 += bv * bv;

  for (const [k, av] of a) {
    const bv = b.get(k);
    if (bv) dot += av * bv;
  }

  const denom = Math.sqrt(a2) * Math.sqrt(b2);
  return denom === 0 ? 0 : dot / denom;
}

function topKeywords(text: string, max = 6): string[] {
  const toks = tokenize(text);
  const tf = toTf(toks);
  const arr = Array.from(tf.entries()).sort((x, y) => y[1] - x[1]);
  return arr.slice(0, max).map(([k]) => k);
}

function summarize(text: string, maxLen = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + "…";
}

function statusFromCounts(last1h: number, last24h: number): "EMERGING" | "ACTIVE" | "STABILIZING" | "DYING" {
  if (last1h >= 5) return "ACTIVE";
  if (last24h >= 5 && last1h <= 1) return "STABILIZING";
  if (last24h >= 1) return "EMERGING";
  return "DYING";
}

// Build an issue “signature” using its title/summary + recent mention texts
async function buildIssueVector(issueId: string): Promise<TokenMap> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: {
      mentions: {
        include: { mention: true },
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  if (!issue) return new Map();

  const texts: string[] = [];
  texts.push(issue.title);
  if (issue.summary) texts.push(issue.summary);

  for (const im of issue.mentions) texts.push(im.mention.text);

  const all = texts.join(" ");
  return toTf(tokenize(all));
}

export async function clusterMentionsForOrg(organizationId: string): Promise<ClusterResult[]> {
  const brands = await prisma.brand.findMany({
    where: { organizationId },
    select: { id: true },
  });

  const results: ClusterResult[] = [];

  for (const brand of brands) {
    let scanned = 0;
    let assigned = 0;
    let created = 0;
    let errors = 0;

    // Unclustered mentions = mentions that have no IssueMention row
    const mentions = await prisma.mention.findMany({
      where: {
        brandId: brand.id,
        issueMentions: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 200, // MVP cap per run
    });

    scanned = mentions.length;

    // Load recent issues (limit for MVP)
    const issues = await prisma.issue.findMany({
      where: { brandId: brand.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true },
    });

    // Precompute vectors for existing issues (MVP cache in memory)
    const issueVectors = new Map<string, TokenMap>();
    for (const i of issues) {
      issueVectors.set(i.id, await buildIssueVector(i.id));
    }

    const SIM_THRESHOLD = 0.28; // tune later

    for (const m of mentions) {
      try {
        const mv = toTf(tokenize(m.text));

        let bestIssueId: string | null = null;
        let bestScore = 0;

        for (const [issueId, iv] of issueVectors) {
          const s = cosine(mv, iv);
          if (s > bestScore) {
            bestScore = s;
            bestIssueId = issueId;
          }
        }

        if (bestIssueId && bestScore >= SIM_THRESHOLD) {
          // attach to existing
          await prisma.issueMention.create({
            data: { issueId: bestIssueId, mentionId: m.id },
          });

          await prisma.issue.update({
            where: { id: bestIssueId },
            data: { updatedAt: new Date() },
          });

          assigned += 1;
        } else {
          // create new issue
          const kw = topKeywords(m.text, 6);
          const title = kw.length ? kw.join(" ") : "New issue";
          const summary = summarize(m.text);

          const newIssue = await prisma.issue.create({
            data: {
              brandId: brand.id,
              title,
              summary,
              status: "EMERGING",
            },
          });

          await prisma.issueMention.create({
            data: { issueId: newIssue.id, mentionId: m.id },
          });

          // Put the new issue into our cache so next mentions can match it
          issueVectors.set(newIssue.id, toTf(tokenize(`${title} ${summary} ${m.text}`)));

          created += 1;
        }
      } catch {
        errors += 1;
      }
    }

    // Update status for most recent issues (MVP: last 50)
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const recentIssues = await prisma.issue.findMany({
      where: { brandId: brand.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true },
    });

    for (const i of recentIssues) {
      const last1h = await prisma.issueMention.count({
        where: { issueId: i.id, mention: { createdAt: { gte: oneHourAgo } } },
      });
      const last24h = await prisma.issueMention.count({
        where: { issueId: i.id, mention: { createdAt: { gte: dayAgo } } },
      });

      const status = statusFromCounts(last1h, last24h);
      await prisma.issue.update({
        where: { id: i.id },
        data: { status },
      });
    }

    results.push({
      brandId: brand.id,
      scannedMentions: scanned,
      assignedToExisting: assigned,
      createdIssues: created,
      errors,
    });
  }

  return results;
}
