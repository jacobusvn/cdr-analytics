import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../../lib/jwt";

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

export async function GET(req: NextRequest) {
  // Verify auth token
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = verifyToken(authHeader.slice(7));
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  // Try fetching from external API if configured
  const apiBase = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  if (apiBase && apiKey) {
    try {
      const params = new URLSearchParams({
        i_customer: payload.tenant_id,
        ...(from && { from_date: from }),
        ...(to && { to_date: to }),
      });

      const response = await fetch(
        `${apiBase}/CDR/get_xdr_list?${params}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        // Map API response to our CDR format
        const records: CDRRecord[] = (data.xdr_list || []).map(
          (xdr: Record<string, unknown>, i: number) => ({
            id: String(xdr.i_xdr || i),
            timestamp: String(xdr.connect_time || xdr.bill_time || ""),
            caller: String(xdr.CLI || xdr.CLD || ""),
            callee: String(xdr.CLD || ""),
            duration: Number(xdr.charged_quantity || xdr.duration || 0),
            status: xdr.disconnect_cause === "0" ? "answered" : "missed",
            direction: xdr.call_class === "1" ? "inbound" : "outbound",
            cost: Number(xdr.charged_amount || 0),
          })
        );
        return NextResponse.json({ records, source: "api" });
      }
    } catch (err) {
      console.error("API fetch failed, returning demo data:", err);
    }
  }

  // Return demo data if no API configured or API call failed
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

  // Seed based on tenant ID for consistent demo data per tenant
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
