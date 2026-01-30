import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clusterMentionsForOrg } from "@/lib/cluster/issues";

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

  const results = await clusterMentionsForOrg(org.id);
  return NextResponse.json({ ok: true, orgId: org.id, results });
}
