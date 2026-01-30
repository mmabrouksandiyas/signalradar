import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scoreIssuesForOrg } from "@/lib/risk/engine";

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

  const result = await scoreIssuesForOrg(org.id);
  return NextResponse.json({ ok: true, orgId: org.id, ...result });
}
