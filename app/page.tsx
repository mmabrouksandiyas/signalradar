<form
  action={async () => {
    "use server";
    await fetch(`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/ingest/rss`, {
      method: "POST",
      cache: "no-store",
    });
  }}
>
  <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
    Run RSS ingest (MVP)
  </button>
</form>
