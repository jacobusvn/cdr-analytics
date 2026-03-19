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
  // PBXware returns { "10": { tenantcode: "999", name: "UnitedTech", ... }, "13": { ... } }
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

  // Auto-prepend http:// if no protocol specified
  // NOTE: Using HTTP because pbx.nexys.co.za has an incomplete SSL certificate chain
  if (!apiBase.startsWith("http")) {
    apiBase = `http://${apiBase}`;
  }
  // Force HTTP for PBXware (self-signed/incomplete SSL cert)
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
      // Look up the PBXware server ID from tenantcode
      const tenantMap = await getTenantServerMap(apiUrl, apiKey);
      const serverId = tenantMap[payload.tenant_id];

      if (!serverId) {
        console.error(`No PBXware server found for tenantcode: ${payload.tenant_id}`);
        // Fall through to demo data
      } else {
        // Format dates as MMM-DD-YYYY for PBXware API
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const now = new Date();
        const startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const endDate = to ? new Date(to) : now;

        const fmtDate = (d: Date) =>
          `${months[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

        const params = new URLSearchParams({
          apikey: apiKey,
          action: "pbxware.cdr.download",
          server: serverId,
          start: fmtDate(startDate),
          end: fmtDate(endDate),
          starttime: "00:00:00",
          endtime: "23:59:59",
          limit: "500",
        });

        const response = await fetch(`${apiUrl}/index.php?${params}`);

        if (response.ok) {
          const data = await response.json();

          // Check for API error response
          if (data.error) {
            console.error("PBXware API returned error:", data.error);
          } else {
            // PBXware returns CDR records - could be array or keyed object
            let cdrList: Record<string, unknown>[];
            if (Array.isArray(data)) {
              cdrList = data;
            } else if (typeof data === "object" && data !== null) {
              // PBXware may return records as a keyed object like { "0": {...}, "1": {...} }
              const values = Object.values(data);
              if (values.length > 0 && typeof values[0] === "object") {
                cdrList = values as Record<string, unknown>[];
              } else {
                cdrList = [];
              }
            } else {
              cdrList = [];
            }

            const records: CDRRecord[] = cdrList.map(
              (cdr: Record<string, unknown>, i: number) => {
                const disposition = String(cdr.disposition || "").toUpperCase();
                let status: string;
                if (disposition === "ANSWERED") status = "answered";
                else if (disposition === "BUSY") status = "busy";
                else if (disposition === "NO ANSWER") status = "missed";
                else if (disposition === "FAILED") status = "failed";
                else status = "missed";

                // Determine direction from context or channel info
                const dcontext = String(cdr.dcontext || "");
                const lastapp = String(cdr.lastapp || "").toLowerCase();
                const direction =
                  dcontext.includes("from-trunk") ||
                  dcontext.includes("incoming") ||
                  dcontext.includes("from-pstn")
                    ? "inbound" : "outbound";

                return {
                  id: String(cdr.uniqueid || cdr.linkedid || i),
                  timestamp: String(cdr.calldate || ""),
                  caller: String(cdr.src || cdr.clid || ""),
                  callee: String(cdr.dst || ""),
                  duration: Number(cdr.billsec || cdr.duration || 0),
                  status,
                  direction,
                  cost: Number(cdr.cost || cdr.rate || 0),
                };
              }
            );

            return NextResponse.json({ records, source: "api" });
          }
        } else {
          const errText = await response.text();
          console.error("PBXware API error:", response.status, errText);
        }
      }
    } catch (err) {
      console.error("PBXware API fetch failed, returning demo data:", err);
    }
  }

  const records = generateDemoData(payload.tenant_id, from, to);
  return NextResponse.json({ records, source: "demo" });
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
