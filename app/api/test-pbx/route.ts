import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let apiBase = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  // Auto-prepend https:// if missing
  if (apiBase && !apiBase.startsWith("http")) {
    apiBase = `https://${apiBase}`;
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
    apiKeyPrefix: apiKey.substring(0, 4) + "...",
  };

  // Test 1: Simple HTTPS connectivity to the server
  try {
    const simpleUrl = `${apiBase}/`;
    results.simpleTestUrl = simpleUrl;
    const res0 = await fetch(simpleUrl, { redirect: "manual" });
    results.simpleStatus = res0.status;
    results.simpleHeaders = Object.fromEntries(res0.headers.entries());
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    results.simpleError = e.message;
    results.simpleCause = e.cause ? String(e.cause) : undefined;
    results.simpleStack = e.stack?.split("\n").slice(0, 3);
  }

  // Test 2: Try with http:// instead of https://
  try {
    const httpUrl = apiBase.replace("https://", "http://") + "/index.php?apikey=" + apiKey + "&action=pbxware.tenant.list";
    results.httpTestUrl = httpUrl.replace(apiKey, "***");
    const res1 = await fetch(httpUrl, { redirect: "manual" });
    results.httpStatus = res1.status;
    results.httpHeaders = Object.fromEntries(res1.headers.entries());
    const text1 = await res1.text();
    results.httpBody = text1.substring(0, 2000);
    try { results.httpJson = JSON.parse(text1); } catch { /* not json */ }
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    results.httpError = e.message;
    results.httpCause = e.cause ? String(e.cause) : undefined;
  }

  // Test 3: HTTPS tenant list
  try {
    const tenantUrl = `${apiBase}/index.php?apikey=${apiKey}&action=pbxware.tenant.list`;
    results.tenantListUrl = tenantUrl.replace(apiKey, "***");
    const res2 = await fetch(tenantUrl);
    results.tenantListStatus = res2.status;
    const text2 = await res2.text();
    results.tenantListRaw = text2.substring(0, 2000);
    try { results.tenantListJson = JSON.parse(text2); } catch { /* not json */ }
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    results.tenantListError = e.message;
    results.tenantListCause = e.cause ? String(e.cause) : undefined;
  }

  return NextResponse.json(results, { status: 200 });
}
