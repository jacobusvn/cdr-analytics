import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const steps: Record<string, unknown> = {};

  try {
    steps.step1 = "parsing body";
    const body = await req.json();
    const { username, password } = body;
    steps.step2 = { username, passwordLength: password?.length };

    steps.step3 = "importing bcryptjs";
    const bcrypt = await import("bcryptjs");
    steps.step4 = { bcryptLoaded: true, compareType: typeof bcrypt.compare };

    steps.step5 = "importing jsonwebtoken";
    const jwt = await import("jsonwebtoken");
    steps.step6 = { jwtLoaded: true, signType: typeof jwt.default?.sign, defaultType: typeof jwt.default };

    steps.step7 = "parsing tenants";
    const tenants = JSON.parse(process.env.TENANTS || "{}");
    const tenant = tenants[username];
    steps.step8 = { tenantFound: !!tenant, tenantKeys: tenant ? Object.keys(tenant) : [] };

    if (!tenant) {
      return NextResponse.json({ steps, error: "tenant not found" }, { status: 401 });
    }

    steps.step9 = "comparing password";
    steps.step9a = { hashLength: tenant.password_hash?.length, hashPrefix: tenant.password_hash?.substring(0, 7) };
    const valid = await bcrypt.compare(password, tenant.password_hash);
    steps.step10 = { valid };

    if (!valid) {
      return NextResponse.json({ steps, error: "invalid password" }, { status: 401 });
    }

    steps.step11 = "signing jwt";
    const secret = process.env.JWT_SECRET;
    steps.step12 = { secretLength: secret?.length };

    const token = jwt.default.sign(
      { tenant_id: tenant.tenant_id, name: tenant.name, username },
      secret!,
      { algorithm: "HS256", expiresIn: "8h" }
    );
    steps.step13 = { tokenLength: token.length };

    return NextResponse.json({ steps, success: true, token: token.substring(0, 20) + "..." });
  } catch (err) {
    steps.error = {
      message: String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
    };
    return NextResponse.json({ steps }, { status: 500 });
  }
}
