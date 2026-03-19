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
  let apiBase = process.env.API_BASE_URL; // e.g. https://pbx.nexys.co.za
  const apiKey = process.env.API_KEY;

  // Auto-prepend https:// if missing
  if (apiBase && !apiBase.startsWith("http")) {
    apiBase = `https://${apiBase}`;
  }

  if (apiBase && apiKey) {
    try {
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
        server: payload.tenant_id,
        start: fmtDate(startDate),
        end: fmtDate(endDate),
        starttime: "00:00:00",
        endtime: "23:59:59",
        limit: "500",
      });

      const response = await fetch(`${apiBase}/index.php?${params}`);

      if (response.ok) {
        const data = await response.json();
        // PBXware returns an array of CDR records or an object with error
        const cdrList = Array.isArray(data) ? data : (data.cdr || data.records || []);
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
            const direction = dcontext.includes("from-trunk") || dcontext.includes("incoming")
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
      } else {
        const errText = await response.text();
        console.error("PBXware API error:", response.status, errText);
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
