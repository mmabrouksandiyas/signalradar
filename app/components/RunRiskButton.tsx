"use client";

import { useState } from "react";

type ApiOk = { ok: true; issuesScored: number };
type ApiErr = { ok: false; error: string };
type ApiResp = ApiOk | ApiErr;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export default function RunRiskButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/risk/run", { method: "POST" });
      const data = (await res.json()) as ApiResp;

      if (!res.ok || data.ok === false) {
        throw new Error(data.ok === false ? data.error : "Request failed");
      }

      setMsg(`✅ Risk scored for ${data.issuesScored} issue(s). Refresh the board.`);
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
        {loading ? "Scoring…" : "Run risk scoring"}
      </button>
      {msg && <div className="text-xs text-gray-600">{msg}</div>}
    </div>
  );
}
