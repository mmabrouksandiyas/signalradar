"use client";

import { useState } from "react";

type ApiOk = { ok: true; results: Array<{ brandId: string; scannedMentions: number; assignedToExisting: number; createdIssues: number; errors: number }> };
type ApiErr = { ok: false; error: string };
type ApiResp = ApiOk | ApiErr;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export default function RunClusterButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cluster/run", { method: "POST" });
      const data = (await res.json()) as ApiResp;

      if (!res.ok || data.ok === false) {
        throw new Error(data.ok === false ? data.error : "Request failed");
      }

      const sum = data.results.reduce(
        (acc, r) => ({
          scanned: acc.scanned + r.scannedMentions,
          assigned: acc.assigned + r.assignedToExisting,
          created: acc.created + r.createdIssues,
          errors: acc.errors + r.errors,
        }),
        { scanned: 0, assigned: 0, created: 0, errors: 0 }
      );

      setMsg(`✅ Clustered. scanned=${sum.scanned}, assigned=${sum.assigned}, newIssues=${sum.created}, errors=${sum.errors}`);
    } catch (e: unknown) {
      setMsg(`❌ ${errMsg(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={loading}
        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {loading ? "Clustering…" : "Run clustering"}
      </button>
      {msg && <div className="text-xs text-gray-600">{msg}</div>}
    </div>
  );
}
