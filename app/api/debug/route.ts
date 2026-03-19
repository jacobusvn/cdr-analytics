import { NextRequest, NextResponse } from "next/server";

// Force dynamic - do not prerender
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  void req;
  const diagnostics: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      JWT_SECRET_SET: !!process.env.JWT_SECRET,
      JWT_SECRET_LENGTH: process.env.JWT_SECRET?.length || 0,
      TENANTS_SET: !!process.env.TENANTS,
      TENANTS_LENGTH: process.env.TENANTS?.length || 0,
      API_BASE_URL_SET: !!process.env.API_BASE_URL,
      NODE_ENV: process.env.NODE_ENV,
    },
  };

  // Test imports
  try {
    const bcrypt = await import("bcryptjs");
    diagnostics.bcryptjs = { loaded: true, version: typeof bcrypt.hashSync };
  } catch (e) {
    diagnostics.bcryptjs = { loaded: false, error: String(e) };
  }

  try {
    const jwt = await import("jsonwebtoken");
    diagnostics.jsonwebtoken = { loaded: true, version: typeof jwt.sign };
  } catch (e) {
    diagnostics.jsonwebtoken = { loaded: false, error: String(e) };
  }

  // Test TENANTS parsing
  try {
    const tenants = JSON.parse(process.env.TENANTS || "{}");
    diagnostics.tenants_parsed = {
      success: true,
      count: Object.keys(tenants).length,
      usernames: Object.keys(tenants),
    };
  } catch (e) {
    diagnostics.tenants_parsed = { success: false, error: String(e) };
  }

  return NextResponse.json(diagnostics);
}
