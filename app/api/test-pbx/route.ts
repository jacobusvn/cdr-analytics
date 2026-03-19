import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let apiBase = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  // Force HTTP (PBXware has incomplete SSL chain)
  if (apiBase && !apiBase.startsWith("http")) {
    apiBase = `http://${apiBase}`;
  }
  if (apiBase) {
    apiBase = apiBase.replace("https://", "http://");
  }

  if (!apiBase || !apiKey) {
    return NextResponse.json({
      error: "Missing env vars",
      API_BASE_URL_SET: !!apiBase,
      API_KEY_SET: !!apiKey,
    });
  }

  const results: Record<string, unknown> = {
    apiBase,
    apiKeyLength: apiKey.length,
  };

  // Step 1: Get tenant list to find server ID for tenantcode 999
  let serverId: string | null = null;
  try {
    const tenantUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.tenant.list`;
    const res1 = await fetch(tenantUrl);
    results.tenantListStatus = res1.status;
    const tenantData = await res1.json();

    // Find server ID for tenantcode 999 (UnitedTech)
    for (const [sid, tenant] of Object.entries(tenantData)) {
      const t = tenant as Record<string, unknown>;
      if (t.tenantcode === "999") {
        serverId = sid;
        results.mappedServerId = sid;
        results.mappedTenantName = t.name;
        break;
      }
    }
    results.totalTenants = Object.keys(tenantData).length;
  } catch (err) {
    results.tenantListError = String(err);
  }

  if (!serverId) {
    results.error = "Could not find server ID for tenantcode 999";
    return NextResponse.json(results);
  }

  // Step 2: Fetch CDR for server ID (using short date range)
  try {
    const cdrUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.cdr.download&server=${serverId}&start=Mar-17-2026&end=Mar-19-2026&starttime=00:00:00&endtime=23:59:59&limit=5`;
    results.cdrUrl = cdrUrl.replace(apiKey, "***");
    const res2 = await fetch(cdrUrl);
    results.cdrStatus = res2.status;
    results.cdrHeaders = Object.fromEntries(res2.headers.entries());
    const text2 = await res2.text();
    results.cdrRawLength = text2.length;
    results.cdrRaw = text2.substring(0, 3000);
    try {
      const parsed = JSON.parse(text2);
      results.cdrType = typeof parsed;
      results.cdrIsArray = Array.isArray(parsed);
      if (typeof parsed === "object" && parsed !== null) {
        results.cdrKeys = Object.keys(parsed).slice(0, 10);
        results.cdrKeyCount = Object.keys(parsed).length;
        // Show first record
        const firstKey = Object.keys(parsed)[0];
        if (firstKey) {
          results.cdrFirstRecord = parsed[firstKey];
          results.cdrFirstKey = firstKey;
        }
      }
    } catch {
      results.cdrParseError = "Not valid JSON";
    }
  } catch (err) {
    results.cdrError = String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
