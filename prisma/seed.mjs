import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const hash = (s) =>
  crypto.createHash("sha256").update(s).digest("hex");

async function main() {
  const org = await prisma.organization.create({
    data: { name: "Demo Org" },
  });

  const brand = await prisma.brand.create({
    data: {
      organizationId: org.id,
      name: "Demo Motors UAE",
      aliases: ["DemoMotors", "Demo Motors", "DemoMotors UAE"],
      competitors: ["FastCar ME", "AutoX"],
    },
  });

  await prisma.source.createMany({
    data: [
      {
        brandId: brand.id,
        type: "RSS",
        name: "Example News",
        config: { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
      },
      {
        brandId: brand.id,
        type: "REDDIT",
        name: "Reddit Search",
        config: { query: "Demo Motors", subreddits: ["cars", "dubai"] },
      },
    ],
  });

  const m1 = await prisma.mention.create({
    data: {
      brandId: brand.id,
      sourceType: "RSS",
      sourceName: "Example News",
      url: "https://example.com/demo-motors-battery",
      urlHash: hash("https://example.com/demo-motors-battery"),
      text: "Customers report battery overheating in Demo Motors EVs, raising safety concerns.",
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      engagementProxy: 120,
    },
  });

  const m2 = await prisma.mention.create({
    data: {
      brandId: brand.id,
      sourceType: "REDDIT",
      sourceName: "Reddit",
      url: "https://reddit.com/r/cars/demo",
      urlHash: hash("https://reddit.com/r/cars/demo"),
      text: "Anyone else having overheating issues with Demo Motors EV?",
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      engagementProxy: 80,
    },
  });

  const issue = await prisma.issue.create({
    data: {
      brandId: brand.id,
      title: "Battery overheating safety complaints",
      summary:
        "Early reports across news and social indicate battery overheating framed as a safety risk.",
      status: "ACTIVE",
    },
  });

  await prisma.issueMention.createMany({
    data: [
      { issueId: issue.id, mentionId: m1.id },
      { issueId: issue.id, mentionId: m2.id },
    ],
  });

  await prisma.riskScore.create({
    data: {
      issueId: issue.id,
      score0to100: 78,
      velocityScore: 80,
      authorityScore: 75,
      severityScore: 95,
      spreadScore: 60,
      sentimentScore: 65,
      patternScore: 50,
      escalation24h: 63,
      escalation72h: 74,
    },
  });

  await prisma.recommendation.create({
    data: {
      issueId: issue.id,
      action: "ESCALATE",
      owner: "LEGAL",
      posture: "CORRECTIVE",
      rationale:
        "High severity safety framing combined with rising velocity across platforms indicates escalation risk.",
    },
  });

  console.log("Seed completed.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
