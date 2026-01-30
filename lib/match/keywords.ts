export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildKeywordList(params: {
  brandName: string;
  aliases: string[];
  competitors: string[];
}): string[] {
  const raw = [params.brandName, ...params.aliases, ...params.competitors]
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);

  // Deduplicate normalized keywords
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const nk = normalizeText(k);
    if (!seen.has(nk)) {
      seen.add(nk);
      out.push(nk);
    }
  }
  return out;
}

export function matchesAnyKeyword(text: string, normalizedKeywords: string[]): boolean {
  const t = normalizeText(text);
  return normalizedKeywords.some((k) => t.includes(k));
}
