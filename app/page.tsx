import Link from "next/link";
import { prisma } from "@/lib/db";
import RunIngestButton from "@/app/components/RunIngestButton";
import RunClusterButton from "@/app/components/RunClusterButton";

export default async function Page() {
  const issues = await prisma.issue.findMany({
    orderBy: { updatedAt: "desc" }, // safe DB ordering
    include: {
      brand: true,
      risk: true,
      rec: true,
    },
    take: 200,
  });

  // Sort in memory by risk score (nulls last)
  issues.sort((a, b) => {
    const ar = a.risk?.score0to100 ?? -1;
    const br = b.risk?.score0to100 ?? -1;
    return br - ar;
  });

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Risk Board</h1>
          <p className="text-sm text-gray-600">
            Emerging issues ranked by risk score, with escalation probabilities and recommended action.
          </p>
<div className="flex flex-wrap items-center gap-3">
  <RunIngestButton />
  <RunClusterButton />
</div>

          
        </header>

        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-medium text-gray-600">
            <div className="col-span-4">Issue</div>
            <div className="col-span-2">Brand</div>
            <div className="col-span-1">Risk</div>
            <div className="col-span-2">Escalation</div>
            <div className="col-span-3">Action</div>
          </div>

          {issues.length === 0 ? (
            <div className="p-6 text-sm text-gray-600">
              No issues yet. Seed data or run RSS ingest to generate mentions.
            </div>
          ) : (
            <ul>
              {issues.map((i) => (
                <li key={i.id} className="grid grid-cols-12 px-4 py-4 border-t items-center">
                  <div className="col-span-4">
                    <Link className="font-medium hover:underline" href={`/issues/${i.id}`}>
                      {i.title}
                    </Link>
                    <div className="text-xs text-gray-500">{i.status}</div>
                  </div>

                  <div className="col-span-2 text-sm">{i.brand.name}</div>

                  <div className="col-span-1 text-sm font-semibold">
                    {i.risk?.score0to100 ?? "-"}
                  </div>

                  <div className="col-span-2 text-sm">
                    {i.risk ? `${i.risk.escalation24h}% / ${i.risk.escalation72h}%` : "-"}
                  </div>

                  <div className="col-span-3 text-sm">
                    {i.rec ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded-full border px-2 py-1 text-xs font-medium">
                          {i.rec.action}
                        </span>
                        <span className="text-xs text-gray-500">
                          {i.rec.owner} • {i.rec.posture}
                        </span>
                      </span>
                    ) : (
                      "-"
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="text-xs text-gray-500">
          MVP: RSS ingestion → Mentions. Next: keyword filtering → clustering → scoring.
        </footer>
      </div>
    </main>
  );
}
