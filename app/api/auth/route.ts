import { NextRequest, NextResponse } from "next/server";
import { authenticateTenant } from "@/lib/tenants";
import { signToken } from "@/lib/jwt";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
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
