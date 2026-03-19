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

/**
 * Raw CDR entry from PBXware before deduplication.
 * PBXware creates multiple CDR entries per call:
 * - Trunk leg (external number → DID)
 * - Ring group leg (DID → ring group)
 * - Extension leg (ring group → extension)
 * - Voicemail leg (extension → voicemail)
 * All share the same epoch timestamp prefix in the Unique ID.
 */
interface RawCDREntry {
  fromRaw: string;
  toRaw: string;
  fromNum: string;
  toNum: string;
  epoch: number;
  timestamp: string;
  totalDuration: number;
  ratingCost: number;
  status: string;
  uniqueId: string;
  callGroup: string; // epoch prefix of unique ID — groups related legs
  locationType: string;
  hasRecording: boolean;
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
        const result = await fetchAndProcessCDR(apiUrl, apiKey, serverId, from, to);
        if (result !== null) {
          return NextResponse.json({
            records: result.records,
            source: "api",
            stats: result.stats,
          });
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
 * Fetch all CDR pages, then deduplicate and filter to unique external calls.
 */
async function fetchAndProcessCDR(
  apiUrl: string,
  apiKey: string,
  serverId: string,
  from: string,
  to: string
): Promise<{ records: CDRRecord[]; stats: Record<string, number> } | null> {
  const rawEntries = await fetchAllRawCDR(apiUrl, apiKey, serverId, from, to);
  if (!rawEntries || rawEntries.length === 0) return null;

  const totalRaw = rawEntries.length;

  // Step 1: Group CDR entries by call group (epoch prefix of Unique ID).
  // All legs of the same call share the same epoch timestamp.
  // E.g., "1773916846.378458" and "1773916846.378460" are legs of the same call.
  const callGroups = new Map<string, RawCDREntry[]>();
  for (const entry of rawEntries) {
    const group = entry.callGroup;
    if (!callGroups.has(group)) {
      callGroups.set(group, []);
    }
    callGroups.get(group)!.push(entry);
  }

  // Step 2: For each call group, pick the best representative leg and classify
  const uniqueRecords: CDRRecord[] = [];

  for (const [callGroup, legs] of callGroups) {
    const call = classifyCall(legs);
    if (!call) continue; // filtered out (internal call or unanswered outbound)
    uniqueRecords.push(call);
  }

  // Sort by timestamp descending (newest first)
  uniqueRecords.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    records: uniqueRecords,
    stats: {
      totalRawEntries: totalRaw,
      callGroups: callGroups.size,
      uniqueExternalCalls: uniqueRecords.length,
    },
  };
}

/**
 * Classify a group of CDR legs into a single call record.
 * Returns null if the call should be filtered out:
 * - Internal extension-to-extension calls
 * - Unanswered outbound calls
 */
function classifyCall(legs: RawCDREntry[]): CDRRecord | null {
  // Determine if this is an internal, inbound, or outbound call
  // by analyzing all legs of the call.

  let hasExternalFrom = false;   // External number in From field
  let hasExternalTo = false;     // External number in To field
  let hasExtensionFrom = false;  // Extension/name in From field
  let hasExtensionTo = false;    // Extension/ring group/voicemail in To
  let hasAutoAttendant = false;  // To field is auto-attendant (e.g., 9992000)
  let isLocal = false;           // Any leg marked as "Local"
  let bestStatus = "missed";
  let longestDuration = 0;
  let bestLeg: RawCDREntry = legs[0];
  let totalCost = 0;
  let externalCaller = "";
  let externalCallee = "";

  for (const leg of legs) {
    // Track the leg with the longest duration (most representative)
    if (leg.totalDuration > longestDuration) {
      longestDuration = leg.totalDuration;
      bestLeg = leg;
    }

    // Accumulate cost
    totalCost += leg.ratingCost;

    // If any leg is answered, the call is answered
    if (leg.status === "answered") {
      bestStatus = "answered";
    } else if (leg.status === "voicemail" && bestStatus !== "answered") {
      bestStatus = "voicemail";
    } else if (leg.status === "busy" && bestStatus === "missed") {
      bestStatus = "busy";
    }

    // Classify From field
    if (isExternalNumber(leg.fromNum)) {
      hasExternalFrom = true;
      if (!externalCaller) externalCaller = leg.fromNum;
    }
    if (hasNameWithExtension(leg.fromRaw) || isShortExtension(leg.fromNum)) {
      hasExtensionFrom = true;
    }

    // Classify To field
    if (isExternalNumber(leg.toNum)) {
      hasExternalTo = true;
      if (!externalCallee) externalCallee = leg.toNum;
    }
    if (hasNameWithExtension(leg.toRaw) || isShortExtension(leg.toNum)) {
      hasExtensionTo = true;
    }
    if (/ring\s*group|voicemail|queue|auto\s*attendant/i.test(leg.toRaw)) {
      hasAutoAttendant = true;
    }
    // Auto-attendant numbers like 9992000, 7012000, etc.
    if (/^\d{3,4}2000$/.test(leg.toNum) || /^\d{4,7}$/.test(leg.toNum)) {
      hasAutoAttendant = true;
    }

    if (leg.locationType.toLowerCase() === "local") {
      isLocal = true;
    }
  }

  // Determine direction
  let direction: string;
  let caller: string;
  let callee: string;

  if (hasExternalFrom && (hasExtensionTo || hasAutoAttendant)) {
    // External number calling into the PBX → INBOUND
    direction = "inbound";
    caller = externalCaller;
    callee = findInternalTarget(legs);
  } else if (hasExtensionFrom && hasExternalTo) {
    // Extension dialing out to external number → OUTBOUND
    direction = "outbound";
    caller = findInternalSource(legs);
    callee = externalCallee;
  } else if (hasExternalFrom && hasExternalTo && !isLocal) {
    // Both external numbers on a trunk call
    // If To is the DID (trunk number) → INBOUND
    // If From is the DID → OUTBOUND
    // Heuristic: PBXware shows the initiating party in "From"
    // For inbound: external caller in From, DID in To
    // For outbound: DID in From, external destination in To
    // Since we can't always tell, check if any leg has an extension/ring group
    if (hasAutoAttendant || hasExtensionTo) {
      direction = "inbound";
      caller = externalCaller;
      callee = externalCallee;
    } else {
      direction = "outbound";
      caller = legs[0].fromNum;
      callee = legs[0].toNum;
    }
  } else if (isLocal && !hasExternalFrom && !hasExternalTo) {
    // Pure internal call between extensions → FILTER OUT
    return null;
  } else {
    // Default classification based on best guess
    if (hasExternalFrom) {
      direction = "inbound";
      caller = externalCaller;
      callee = findInternalTarget(legs);
    } else if (hasExternalTo) {
      direction = "outbound";
      caller = findInternalSource(legs);
      callee = externalCallee;
    } else {
      // Pure internal → FILTER OUT
      return null;
    }
  }

  // Filter rule: For missed/unanswered calls, only report INBOUND misses.
  // Ignore unanswered outbound calls (user chose not to answer or line busy).
  if (bestStatus !== "answered" && bestStatus !== "voicemail" && direction === "outbound") {
    return null;
  }

  return {
    id: bestLeg.uniqueId || bestLeg.callGroup,
    timestamp: bestLeg.timestamp,
    caller: formatPhoneNumber(caller || bestLeg.fromNum),
    callee: formatPhoneNumber(callee || bestLeg.toNum),
    duration: longestDuration,
    status: bestStatus,
    direction,
    cost: totalCost,
  };
}

/**
 * Find the internal target (extension/ring group name) from call legs.
 */
function findInternalTarget(legs: RawCDREntry[]): string {
  for (const leg of legs) {
    // Prefer the leg that shows a named extension or ring group
    if (hasNameWithExtension(leg.toRaw)) {
      return leg.toRaw;
    }
  }
  // Fall back to auto-attendant or short extension
  for (const leg of legs) {
    if (isShortExtension(leg.toNum)) {
      return leg.toNum;
    }
  }
  return legs[0].toNum;
}

/**
 * Find the internal source (extension/name) from call legs.
 */
function findInternalSource(legs: RawCDREntry[]): string {
  for (const leg of legs) {
    if (hasNameWithExtension(leg.fromRaw)) {
      // Extract just the name and extension
      return leg.fromRaw;
    }
  }
  for (const leg of legs) {
    if (isShortExtension(leg.fromNum)) {
      return leg.fromNum;
    }
  }
  return legs[0].fromNum;
}

/**
 * Fetch all raw CDR entries from PBXware with pagination.
 */
async function fetchAllRawCDR(
  apiUrl: string,
  apiKey: string,
  serverId: string,
  from: string,
  to: string
): Promise<RawCDREntry[] | null> {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();
  const startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = to ? new Date(to) : now;

  const fmtDate = (d: Date) =>
    `${months[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

  const allEntries: RawCDREntry[] = [];
  let page = 1;
  const pageSize = 200;
  const maxPages = 25; // Up to 5000 raw entries

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
      return allEntries.length > 0 ? allEntries : null;
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
    };

    for (const row of data.csv) {
      const fromRaw = col.from >= 0 ? String(row[col.from] || "") : "";
      const toRaw = col.to >= 0 ? String(row[col.to] || "") : "";
      const epochStr = col.dateTime >= 0 ? String(row[col.dateTime] || "") : "";
      const totalDuration = col.totalDuration >= 0 ? Number(row[col.totalDuration] || 0) : 0;
      const ratingCost = col.ratingCost >= 0 ? parseFloat(String(row[col.ratingCost] || "0")) || 0 : 0;
      const rawStatus = col.status >= 0 ? String(row[col.status] || "") : "";
      const uniqueId = col.uniqueId >= 0 ? String(row[col.uniqueId] || "") : "";
      const locationType = col.locationType >= 0 ? String(row[col.locationType] || "") : "";
      const hasRecording = col.recordingAvailable >= 0 ? String(row[col.recordingAvailable] || "") === "True" : false;

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

      // Call group = epoch prefix of Unique ID (before the dot)
      // e.g., "1773916846.378458" → "1773916846"
      // All legs of the same call share this epoch timestamp
      const callGroup = uniqueId.split(".")[0] || epochStr;

      allEntries.push({
        fromRaw,
        toRaw,
        fromNum: extractNumber(fromRaw),
        toNum: extractNumber(toRaw),
        epoch: epoch || 0,
        timestamp,
        totalDuration,
        ratingCost,
        status,
        uniqueId,
        callGroup,
        locationType,
        hasRecording,
      });
    }

    if (!data.next_page) break;
    page++;
  }

  return allEntries.length > 0 ? allEntries : null;
}

// --- Helper functions ---

function extractNumber(raw: string): string {
  if (/^\d+$/.test(raw.trim())) return raw.trim();
  const parenMatch = raw.match(/\((\d+)\)/);
  if (parenMatch) return parenMatch[1];
  const numMatch = raw.match(/\b(\d{7,})\b/);
  if (numMatch) return numMatch[1];
  return raw.trim();
}

function isExternalNumber(num: string): boolean {
  // SA external numbers: 27XXXXXXXXX (11 digits) or 0XXXXXXXXX (10 digits)
  return /^\d{10,}$/.test(num);
}

function isShortExtension(num: string): boolean {
  // PBXware extensions are typically 3-4 digits, ring groups/auto-attendants up to 7
  return /^\d{2,7}$/.test(num);
}

function hasNameWithExtension(raw: string): boolean {
  return /[a-zA-Z]/.test(raw) && /\(\d+\)/.test(raw);
}

function formatPhoneNumber(num: string): string {
  // Clean any name prefix first
  const clean = extractNumber(num);
  if (/^\d{11}$/.test(clean) && clean.startsWith("27")) {
    return `+${clean}`;
  }
  if (/^\d{10}$/.test(clean) && clean.startsWith("0")) {
    return `+27${clean.substring(1)}`;
  }
  if (/^\d{10,}$/.test(clean) && !clean.startsWith("+")) {
    return `+${clean}`;
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
