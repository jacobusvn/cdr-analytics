import { NextRequest, NextResponse } from "next/server";

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

    // Dynamic imports to avoid Vercel bundling issues
    const bcrypt = await import("bcryptjs");
    const jwt = await import("jsonwebtoken");

    // Parse tenants from env
    let tenants: Record<string, { password_hash: string; tenant_id: string; name: string }>;
    try {
      tenants = JSON.parse(process.env.TENANTS || "{}");
    } catch {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    // Authenticate
    const tenant = tenants[username];
    if (!tenant) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, tenant.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Reset rate limit on successful login
    loginAttempts.delete(ip);

    // Sign JWT
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const token = jwt.default.sign(
      { tenant_id: tenant.tenant_id, name: tenant.name, username },
      secret,
      { algorithm: "HS256", expiresIn: "8h" }
    );

    return NextResponse.json({
      token,
      tenant_id: tenant.tenant_id,
      name: tenant.name,
    });
  } catch (err) {
    console.error("Auth error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
