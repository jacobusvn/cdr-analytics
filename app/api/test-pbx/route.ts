import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiBase = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

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
    apiKeyPrefix: apiKey.substring(0, 4) + "...",
  };

  // Test 1: Basic connectivity - try tenant list
  try {
    const tenantUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.tenant.list`;
    results.tenantListUrl = tenantUrl.replace(apiKey, "***");
    const res1 = await fetch(tenantUrl);
    results.tenantListStatus = res1.status;
    results.tenantListHeaders = Object.fromEntries(res1.headers.entries());
    const text1 = await res1.text();
    results.tenantListRaw = text1.substring(0, 2000);
    try {
      results.tenantListJson = JSON.parse(text1);
    } catch {
      results.tenantListParseError = "Not valid JSON";
    }
  } catch (err) {
    results.tenantListError = String(err);
  }

  // Test 2: CDR download for server/tenant 999
  try {
    const cdrUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.cdr.download&server=999&start=Mar-01-2026&end=Mar-19-2026&starttime=00:00:00&endtime=23:59:59&limit=5`;
    results.cdrUrl = cdrUrl.replace(apiKey, "***");
    const res2 = await fetch(cdrUrl);
    results.cdrStatus = res2.status;
    const text2 = await res2.text();
    results.cdrRaw = text2.substring(0, 2000);
    try {
      results.cdrJson = JSON.parse(text2);
    } catch {
      results.cdrParseError = "Not valid JSON";
    }
  } catch (err) {
    results.cdrError = String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
