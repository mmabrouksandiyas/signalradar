"use client";

import { useState } from "react";

type IngestResponse =
  | { ok: true; totalNew: number; errors: Array<{ sourceId: string; name: string; error: string }> }
  | { ok: false; error: string };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

export default function RunIngestButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/ingest/rss", { method: "POST" });
      const data = (await res.json()) as IngestResponse;

      if (!res.ok || data.ok === false) {
        const err = data.ok === false ? data.error : "Request failed";
        throw new Error(err);
      }

      setMsg(`✅ Ingested. New: ${data.totalNew}. Errors: ${data.errors.length}`);
    } catch (err: unknown) {
      setMsg(`❌ ${errorMessage(err)}`);
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
        {loading ? "Running…" : "Run RSS ingest"}
      </button>
      {msg && <div className="text-xs text-gray-600">{msg}</div>}
    </div>
  );
}
