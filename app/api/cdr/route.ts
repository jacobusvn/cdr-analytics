import { NextRequest, NextResponse } from "next/server";

interface CDRRecord {
  id: string;
  timestamp: string;
  caller: string;
  callee: string;
  duration: number;
  status: string;
  direction: string;
  cost: number;
}

interface TokenPayload {
  tenant_id: string;
  name: string;
  username: string;
}

// Cache tenant list to avoid hitting the API on every CDR request
let tenantCache: Record<string, string> | null = null; // tenantcode -> server ID
let tenantCacheTime = 0;
const TENANT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getTenantServerMap(apiUrl: string, apiKey: string): Promise<Record<string, string>> {
  const now = Date.now();
  if (tenantCache && now - tenantCacheTime < TENANT_CACHE_TTL) {
    return tenantCache;
  }

  const res = await fetch(`${apiUrl}/index.php?apikey=${apiKey}&action=pbxware.tenant.list`);
  if (!res.ok) throw new Error(`Tenant list failed: ${res.status}`);

  const data = await res.json();
  const map: Record<string, string> = {};
  for (const [serverId, tenant] of Object.entries(data)) {
    const t = tenant as Record<string, unknown>;
    if (t.tenantcode) {
      map[String(t.tenantcode)] = serverId;
    }
  }

  tenantCache = map;
  tenantCacheTime = now;
  return map;
}

function getApiUrl(): string | null {
  let apiBase = process.env.API_BASE_URL;
  if (!apiBase) return null;

  if (!apiBase.startsWith("http")) {
    apiBase = `http://${apiBase}`;
  }
  // Force HTTP — pbx.nexys.co.za has an incomplete SSL certificate chain
  apiBase = apiBase.replace("https://", "http://");

  return apiBase;
}

export async function GET(req: NextRequest) {
  // Verify auth token
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let payload: TokenPayload;
  try {
    const jwt = await import("jsonwebtoken");
    payload = jwt.default.verify(authHeader.slice(7), secret, {
      algorithms: ["HS256"],
    }) as TokenPayload;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  // Try fetching from Bicom PBXware MT v7 API
  const apiUrl = getApiUrl();
  const apiKey = process.env.API_KEY;

  if (apiUrl && apiKey) {
    try {
      const tenantMap = await getTenantServerMap(apiUrl, apiKey);
      const serverId = tenantMap[payload.tenant_id];

      if (!serverId) {
        console.error(`No PBXware server found for tenantcode: ${payload.tenant_id}`);
      } else {
        const records = await fetchAllCDR(apiUrl, apiKey, serverId, from, to);
        if (records !== null) {
          return NextResponse.json({ records, source: "api" });
        }
      }
    } catch (err) {
      console.error("PBXware API fetch failed, returning demo data:", err);
    }
  }

  const records = generateDemoData(payload.tenant_id, from, to);
  return NextResponse.json({ records, source: "demo" });
}

/**
 * Fetch CDR records from PBXware with pagination.
 * PBXware returns:
 * {
 *   "success": "Success.",
 *   "next_page": true/false,
 *   "limit": 100,
 *   "records": 100,
 *   "header": ["From", "To", "Date/Time", "Total Duration", "Rating Duration", "Rating Cost", "Status", "Unique ID", "Recording Path", "Recording Available", "Location Type", "MOS"],
 *   "csv": [["27107457100", "27876541788", "1773913437", "8", "3", "", "Answered", "1773913437.377244", "", "False", "", 0], ...]
 * }
 */
async function fetchAllCDR(
  apiUrl: string,
  apiKey: string,
  serverId: string,
  from: string,
  to: string
): Promise<CDRRecord[] | null> {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();
  const startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = to ? new Date(to) : now;

  const fmtDate = (d: Date) =>
    `${months[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

  const allRecords: CDRRecord[] = [];
  let page = 1;
  const pageSize = 200;
  const maxPages = 10; // Safety limit: max 2000 records

  while (page <= maxPages) {
    const params = new URLSearchParams({
      apikey: apiKey,
      action: "pbxware.cdr.download",
      server: serverId,
      start: fmtDate(startDate),
      end: fmtDate(endDate),
      starttime: "00:00:00",
      endtime: "23:59:59",
      limit: String(pageSize),
      page: String(page),
    });

    const response = await fetch(`${apiUrl}/index.php?${params}`);
    if (!response.ok) {
      console.error("PBXware CDR API error:", response.status);
      return allRecords.length > 0 ? allRecords : null;
    }

    const data = await response.json();

    if (data.error) {
      console.error("PBXware CDR error:", data.error);
      return allRecords.length > 0 ? allRecords : null;
    }

    if (!data.csv || !Array.isArray(data.csv) || data.csv.length === 0) {
      break;
    }

    // Parse header to get column indices
    const header: string[] = data.header || [];
    const colIdx = {
      from: header.indexOf("From"),
      to: header.indexOf("To"),
      dateTime: header.indexOf("Date/Time"),
      totalDuration: header.indexOf("Total Duration"),
      ratingDuration: header.indexOf("Rating Duration"),
      ratingCost: header.indexOf("Rating Cost"),
      status: header.indexOf("Status"),
      uniqueId: header.indexOf("Unique ID"),
      locationType: header.indexOf("Location Type"),
    };

    for (const row of data.csv) {
      const fromNum = colIdx.from >= 0 ? String(row[colIdx.from] || "") : "";
      const toNum = colIdx.to >= 0 ? String(row[colIdx.to] || "") : "";
      const epochStr = colIdx.dateTime >= 0 ? String(row[colIdx.dateTime] || "") : "";
      const totalDur = colIdx.totalDuration >= 0 ? Number(row[colIdx.totalDuration] || 0) : 0;
      const ratingCost = colIdx.ratingCost >= 0 ? Number(row[colIdx.ratingCost] || 0) : 0;
      const rawStatus = colIdx.status >= 0 ? String(row[colIdx.status] || "") : "";
      const uniqueId = colIdx.uniqueId >= 0 ? String(row[colIdx.uniqueId] || "") : "";
      const locationType = colIdx.locationType >= 0 ? String(row[colIdx.locationType] || "") : "";

      // Convert Unix epoch to ISO timestamp
      const epoch = parseInt(epochStr, 10);
      const timestamp = !isNaN(epoch)
        ? new Date(epoch * 1000).toISOString()
        : epochStr;

      // Map PBXware status to our status
      const statusUpper = rawStatus.toUpperCase();
      let status: string;
      if (statusUpper === "ANSWERED") status = "answered";
      else if (statusUpper === "BUSY") status = "busy";
      else if (statusUpper === "NO ANSWER" || statusUpper === "NOANSWER") status = "missed";
      else if (statusUpper === "FAILED" || statusUpper === "CANCEL") status = "failed";
      else if (statusUpper === "VOICEMAIL") status = "voicemail";
      else status = "missed";

      // Determine direction:
      // "Local" location type = internal, otherwise check if from/to matches tenant DID pattern
      // In PBXware, inbound calls typically have the tenant extension as the "To" field
      const direction = locationType.toLowerCase() === "local" ? "outbound" : "inbound";

      allRecords.push({
        id: uniqueId || `${serverId}-${page}-${allRecords.length}`,
        timestamp,
        caller: formatPhoneNumber(fromNum),
        callee: formatPhoneNumber(toNum),
        duration: totalDur,
        status,
        direction,
        cost: ratingCost,
      });
    }

    // Check if there are more pages
    if (!data.next_page) {
      break;
    }
    page++;
  }

  return allRecords.length > 0 ? allRecords : null;
}

function formatPhoneNumber(num: string): string {
  // Format South African numbers: 27xxxxxxxxx -> +27 xx xxx xxxx
  if (num.startsWith("27") && num.length >= 11) {
    return `+${num}`;
  }
  if (num.length >= 7 && !num.startsWith("+")) {
    return `+${num}`;
  }
  return num;
}

function generateDemoData(
  tenantId: string,
  from: string,
  to: string
): CDRRecord[] {
  const now = new Date();
  const startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = to ? new Date(to) : now;
  const records: CDRRecord[] = [];
  const statuses = ["answered", "missed", "voicemail", "busy"];
  const directions = ["inbound", "outbound"];

  let seed = 0;
  for (let i = 0; i < tenantId.length; i++) seed += tenantId.charCodeAt(i);
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const dayCount = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)
  );
  const totalRecords = Math.min(dayCount * 12, 500);

  for (let i = 0; i < totalRecords; i++) {
    const offset = rand() * (endDate.getTime() - startDate.getTime());
    const ts = new Date(startDate.getTime() + offset);
    const status = statuses[Math.floor(rand() * statuses.length)];
    const duration = status === "answered" ? Math.floor(rand() * 600) + 10 : 0;

    records.push({
      id: `${tenantId}-${i}`,
      timestamp: ts.toISOString(),
      caller: `+27${String(Math.floor(rand() * 900000000 + 100000000))}`,
      callee: `+27${String(Math.floor(rand() * 900000000 + 100000000))}`,
      duration,
      status,
      direction: directions[Math.floor(rand() * directions.length)],
      cost: status === "answered" ? Math.round(rand() * 500) / 100 : 0,
    });
  }

  return records.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}
