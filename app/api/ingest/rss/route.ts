import { NextResponse } from "next/server";
import { ingestAllRssForOrg } from "@/lib/ingest/rss";
import { prisma } from "@/lib/db";

// MVP: No auth gating yet. We'll lock this down once NextAuth is in.
// For now you can pass ?org=... or it will use the first org found.

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgIdFromQuery = url.searchParams.get("org");

  const org =
    orgIdFromQuery
      ? await prisma.organization.findUnique({ where: { id: orgIdFromQuery } })
      : await prisma.organization.findFirst();

  if (!org) {
    return NextResponse.json({ ok: false, error: "No organization found" }, { status: 400 });
  }

  const result = await ingestAllRssForOrg(org.id);
  return NextResponse.json({ ok: true, orgId: org.id, ...result });
}
