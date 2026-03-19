import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let apiBase = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  // Force HTTP
  if (apiBase && !apiBase.startsWith("http")) {
    apiBase = `http://${apiBase}`;
  }
  if (apiBase) {
    apiBase = apiBase.replace("https://", "http://");
  }

  if (!apiBase || !apiKey) {
    return NextResponse.json({ error: "Missing env vars" });
  }

  const results: Record<string, unknown> = {};

  // Get server ID for tenant 999
  let serverId: string | null = null;
  try {
    const res = await fetch(`${apiBase}/index.php?apikey=${apiKey}&action=pbxware.tenant.list`);
    const tenants = await res.json();
    for (const [sid, t] of Object.entries(tenants)) {
      if ((t as Record<string, unknown>).tenantcode === "999") {
        serverId = sid;
        break;
      }
    }
    results.serverId = serverId;
  } catch (err) {
    results.tenantError = String(err);
  }

  if (!serverId) {
    results.error = "No server ID for tenant 999";
    return NextResponse.json(results);
  }

  // Fetch CDR - page 1, limit 10
  try {
    const cdrUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.cdr.download&server=${serverId}&start=Mar-01-2026&end=Mar-19-2026&starttime=00:00:00&endtime=23:59:59&limit=10&page=1`;
    const res = await fetch(cdrUrl);
    const data = await res.json();

    results.success = data.success;
    results.nextPage = data.next_page;
    results.totalRecords = data.records;
    results.limit = data.limit;
    results.header = data.header;

    // Show first 5 records with header mapping
    if (data.csv && data.header) {
      const mapped = data.csv.slice(0, 5).map((row: unknown[]) => {
        const record: Record<string, unknown> = {};
        (data.header as string[]).forEach((h: string, i: number) => {
          record[h] = row[i];
        });
        return record;
      });
      results.sampleRecords = mapped;
    }

    // Also show raw csv rows
    results.rawCsvFirst3 = data.csv?.slice(0, 3);

    // Count total pages
    let totalRecords = 0;
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 20) {
      const pageUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.cdr.download&server=${serverId}&start=Mar-01-2026&end=Mar-19-2026&starttime=00:00:00&endtime=23:59:59&limit=200&page=${page}`;
      const pageRes = await fetch(pageUrl);
      const pageData = await pageRes.json();
      const count = pageData.csv?.length || 0;
      totalRecords += count;
      hasMore = pageData.next_page === true;
      page++;
    }
    results.totalRecordsAllPages = totalRecords;
    results.totalPages = page - 1;

  } catch (err) {
    results.cdrError = String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
