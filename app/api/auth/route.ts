import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant } from "@/lib/tenants";
import { signToken } from "@/lib/jwt";

// Simple in-memory rate limiter (per IP, resets on redeploy)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  record.count++;
  return record.count > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again in 15 minutes." },
        { status: 429 }
      );
    }

    // Parse and validate input
    const body = await req.json();
    const { username, password } = body;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username ||
      !password
    ) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    if (username.length > 100 || password.length > 200) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const tenant = await authenticateTenant(username, password);
    if (!tenant) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Reset rate limit on successful login
    loginAttempts.delete(ip);

    const token = signToken({
      tenant_id: tenant.tenant_id,
      name: tenant.name,
      username,
    });

    return NextResponse.json({
      token,
      tenant_id: tenant.tenant_id,
      name: tenant.name,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
