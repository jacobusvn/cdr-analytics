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

// Cache tenant list
let tenantCache: Record<string, string> | null = null;
let tenantCacheTime = 0;
const TENANT_CACHE_TTL = 10 * 60 * 1000;

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
  apiBase = apiBase.replace("https://", "http://");

  return apiBase;
}

export async function GET(req: NextRequest) {
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
 * PBXware CDR format:
 * header: ["From","To","Date/Time","Total Duration","Rating Duration","Rating Cost","Status","Unique ID","Recording Path","Recording Available","Location Type","MOS"]
 * csv: [["27107457100","27876541788","1773916846","8","3","","Answered","1773916846.378458","","False","",0], ...]
 *
 * Direction detection:
 * - Location Type "Local" = internal call between extensions
 * - From CSV: when "From" is a DID/trunk number (27...) and "To" is external = outbound
 * - When "From" is external and "To" is a DID/extension = inbound
 * - When "From" contains a name like "Jacobus van Niekerk (7108)" = outbound from extension
 * - When "To" contains "Ring Group" or extension number = inbound routed to extension
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
  const maxPages = 10;

  // Collect all DID numbers seen to help with direction detection
  const didNumbers = new Set<string>();

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
      return allRecords.length > 0 ? allRecords : null;
    }

    const data = await response.json();

    if (data.error || !data.csv || !Array.isArray(data.csv) || data.csv.length === 0) {
      break;
    }

    const header: string[] = data.header || [];
    const col = {
      from: header.indexOf("From"),
      to: header.indexOf("To"),
      dateTime: header.indexOf("Date/Time"),
      totalDuration: header.indexOf("Total Duration"),
      ratingDuration: header.indexOf("Rating Duration"),
      ratingCost: header.indexOf("Rating Cost"),
      status: header.indexOf("Status"),
      uniqueId: header.indexOf("Unique ID"),
      recordingAvailable: header.indexOf("Recording Available"),
      locationType: header.indexOf("Location Type"),
      mos: header.indexOf("MOS"),
    };

    for (const row of data.csv) {
      const fromRaw = col.from >= 0 ? String(row[col.from] || "") : "";
      const toRaw = col.to >= 0 ? String(row[col.to] || "") : "";
      const epochStr = col.dateTime >= 0 ? String(row[col.dateTime] || "") : "";
      const totalDur = col.totalDuration >= 0 ? Number(row[col.totalDuration] || 0) : 0;
      const ratingCost = col.ratingCost >= 0 ? parseFloat(String(row[col.ratingCost] || "0")) || 0 : 0;
      const rawStatus = col.status >= 0 ? String(row[col.status] || "") : "";
      const uniqueId = col.uniqueId >= 0 ? String(row[col.uniqueId] || "") : "";
      const locationType = col.locationType >= 0 ? String(row[col.locationType] || "") : "";
      const hasRecording = col.recordingAvailable >= 0 ? String(row[col.recordingAvailable] || "") === "True" : false;

      // Convert epoch to ISO
      const epoch = parseInt(epochStr, 10);
      const timestamp = !isNaN(epoch)
        ? new Date(epoch * 1000).toISOString()
        : epochStr;

      // Map status
      const statusUpper = rawStatus.toUpperCase();
      let status: string;
      if (statusUpper === "ANSWERED") status = "answered";
      else if (statusUpper === "BUSY") status = "busy";
      else if (statusUpper === "NO ANSWER" || statusUpper === "NOANSWER") status = "missed";
      else if (statusUpper === "FAILED" || statusUpper === "CANCEL") status = "failed";
      else if (statusUpper === "VOICEMAIL") status = "voicemail";
      else status = "missed";

      // Extract clean numbers (PBXware sometimes includes names like "Jacobus van Niekerk (7108)")
      const fromNum = extractNumber(fromRaw);
      const toNum = extractNumber(toRaw);

      // Direction detection:
      // "Local" = internal extension-to-extension call
      // If "To" starts with the tenant code prefix (e.g. 999xxxx) = inbound to auto-attendant/ring group
      // If "From" is an extension (short number or has name) calling external number = outbound
      // If "From" is external (long number not matching DIDs) calling DID = inbound
      let direction: string;
      if (locationType.toLowerCase() === "local") {
        // Internal call - check if calling out via extension
        if (fromNum.length <= 5 || /^\d{3,4}$/.test(fromNum)) {
          // Short extension number dialing out
          direction = isExternalNumber(toNum) ? "outbound" : "internal";
        } else {
          direction = "internal";
        }
      } else {
        // Trunk call - determine by checking if From or To looks like tenant's DID
        // Collect DIDs as we go (numbers that appear frequently in From for short calls are likely DIDs)
        direction = detectDirection(fromNum, toNum, fromRaw, toRaw);
      }

      allRecords.push({
        id: uniqueId || `${serverId}-${page}-${allRecords.length}`,
        timestamp,
        caller: formatPhoneNumber(fromNum || fromRaw),
        callee: formatPhoneNumber(toNum || toRaw),
        duration: totalDur,
        status,
        direction,
        cost: ratingCost,
      });
    }

    if (!data.next_page) break;
    page++;
  }

  return allRecords.length > 0 ? allRecords : null;
}

/**
 * Extract a phone number from a PBXware field that may contain a name.
 * Examples:
 * - "27107457100" -> "27107457100"
 * - "Jacobus van Niekerk (7108)" -> "7108"
 * - "Ring Group 1000 Voicemail (1100)" -> "1100"
 * - "Incoming Calls Ring Group (1000)" -> "1000"
 */
function extractNumber(raw: string): string {
  // If it's already a clean number, return as-is
  if (/^\d+$/.test(raw.trim())) return raw.trim();

  // Extract number from parentheses: "Name (1234)" -> "1234"
  const parenMatch = raw.match(/\((\d+)\)/);
  if (parenMatch) return parenMatch[1];

  // Try to find a long number in the string
  const numMatch = raw.match(/\b(\d{7,})\b/);
  if (numMatch) return numMatch[1];

  return raw.trim();
}

/**
 * Detect call direction for trunk calls.
 * Heuristic: in Bicom PBXware, inbound calls come from external numbers
 * to the tenant's DID. Outbound calls go from the tenant's DID to external.
 *
 * Key patterns:
 * - From: "27107457100" (DID) -> To: "27876541788" = OUTBOUND (DID calling out)
 * - From: "27876540890" -> To: "27107457100" (DID) = INBOUND (external calling DID)
 * - From: extension name -> To: external = OUTBOUND
 * - From: external -> To: ring group/extension = INBOUND
 */
function detectDirection(fromNum: string, toNum: string, fromRaw: string, toRaw: string): string {
  // If "From" contains a name with extension (like "Jacobus van Niekerk (7108)")
  // it's an outbound call from that extension
  if (/[a-zA-Z]/.test(fromRaw) && /\(\d+\)/.test(fromRaw)) {
    return "outbound";
  }

  // If "To" contains a Ring Group, Voicemail, or extension name = inbound
  if (/ring\s*group|voicemail|queue/i.test(toRaw)) {
    return "inbound";
  }
  if (/[a-zA-Z]/.test(toRaw) && /\(\d+\)/.test(toRaw)) {
    return "inbound";
  }

  // If "To" is a short number (extension, ring group, auto attendant like 9992000)
  if (/^\d{3,7}$/.test(toNum)) {
    return "inbound";
  }

  // Both are long numbers - harder to tell
  // In SA, DIDs typically match patterns like 2710XXXXXXX (landline) or 27XXXXXXXXX
  // The "From" field in outbound calls is the tenant's DID (caller ID)
  // For inbound, "From" is the external caller
  // Without knowing exact DIDs, we use a heuristic:
  // If this is a non-Local call and To is a long external number, likely outbound
  // The "From" being the DID means the PBX is routing out

  // Default: if both numbers are long external numbers, assume outbound
  // (PBXware shows the DID as "From" when the PBX initiates the call)
  return "outbound";
}

function isExternalNumber(num: string): boolean {
  // External numbers are long (11+ digits for SA)
  return /^\d{10,}$/.test(num);
}

function formatPhoneNumber(num: string): string {
  if (/^\d{11}$/.test(num) && num.startsWith("27")) {
    return `+${num}`;
  }
  if (/^\d{10,}$/.test(num) && !num.startsWith("+")) {
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
