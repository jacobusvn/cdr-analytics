import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    time: Date.now(),
    url: req.url,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({
    ok: true,
    received: body,
    time: Date.now(),
  });
}
