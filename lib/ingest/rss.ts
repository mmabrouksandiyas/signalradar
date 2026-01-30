import Parser from "rss-parser";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashUrl } from "@/lib/hash";
import {
  buildKeywordList,
  matchesAnyKeyword,
} from "@/lib/match/keywords";

/* ----------------------------- Types ----------------------------- */

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  creator?: string;
  author?: string;
};

type SourceConfig = {
  url?: unknown;
};

type IngestError = {
  sourceId: string;
  name: string;
  error: string;
};

/* ---------------------------- Parser ----------------------------- */

const parser = new Parser<RssItem>({
  timeout: 15_000,
  customFields: {
    item: ["creator", "author"],
  },
});

/* -------------------------- Helpers ------------------------------ */

function pickText(item: RssItem): string {
  return (item.contentSnippet || item.content || item.title || "").trim();
}

function pickAuthor(item: RssItem): string | null {
  const a = (item.creator || item.author || "").trim();
  return a.length ? a : null;
}

function pickCreatedAt(item: RssItem): Date {
  const raw = item.isoDate || item.pubDate;
  const d = raw ? new Date(raw) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function getConfigUrl(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null) return undefined;
  const obj = config as SourceConfig;
  return typeof obj.url === "string" && obj.url.trim().length
    ? obj.url.trim()
    : undefined;
}

function toInputJsonValue(
  value: unknown
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return Prisma.DbNull;
  }
}

function isPrismaDuplicate(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown RSS error";
}

/* ------------------------- Ingestion ----------------------------- */

export async function ingestAllRssForOrg(organizationId: string) {
  const brands = await prisma.brand.findMany({
    where: { organizationId },
    include: { sources: true },
  });

  let totalNew = 0;
  let totalSkipped = 0;
  const errors: IngestError[] = [];

  for (const brand of brands) {
    const keywords = buildKeywordList({
      brandName: brand.name,
      aliases: brand.aliases,
      competitors: brand.competitors,
    });

    const rssSources = brand.sources.filter(
      (s) => s.type === "RSS" && s.isEnabled
    );

    for (const source of rssSources) {
      const url = getConfigUrl(source.config);

      if (!url) {
        errors.push({
          sourceId: source.id,
          name: source.name,
          error: "Missing config.url",
        });
        continue;
      }

      try {
        const feed = await parser.parseURL(url);
        const items = feed.items ?? [];

        for (const item of items) {
          const link = item.link?.trim();
          if (!link) continue;

          const text = pickText(item);
          if (!text) continue;

          /* -------- Brand keyword filtering -------- */
          if (!matchesAnyKeyword(text, keywords)) {
            totalSkipped += 1;
            continue;
          }

          const createdAt = pickCreatedAt(item);
          const urlHash = hashUrl(link);

          try {
            await prisma.mention.create({
              data: {
                brandId: brand.id,
                sourceType: "RSS",
                sourceName: source.name,
                url: link,
                urlHash,
                author: pickAuthor(item),
                text,
                language: null,
                createdAt,
                engagementProxy: 0,
                rawJson: toInputJsonValue(item),
              },
            });

            totalNew += 1;
          } catch (err: unknown) {
            if (isPrismaDuplicate(err)) continue;
            throw err;
          }
        }
      } catch (err: unknown) {
        errors.push({
          sourceId: source.id,
          name: source.name,
          error: errorMessage(err),
        });
      }
    }
  }

  return {
    totalNew,
    totalSkipped,
    errors,
  };
}
