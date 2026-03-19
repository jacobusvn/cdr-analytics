import bcrypt from "bcryptjs";

export interface Tenant {
  password_hash: string;
  tenant_id: string;
  name: string;
}

type TenantMap = Record<string, Tenant>;

let tenantCache: TenantMap | null = null;

export function getTenants(): TenantMap {
  if (tenantCache) return tenantCache;
  try {
    tenantCache = JSON.parse(process.env.TENANTS || "{}");
    return tenantCache!;
  } catch {
    return {};
  }
}

export async function authenticateTenant(
  username: string,
  password: string
): Promise<{ tenant_id: string; name: string } | null> {
  const tenants = getTenants();
  const tenant = tenants[username];
  if (!tenant) return null;

  const valid = await bcrypt.compare(password, tenant.password_hash);
  if (!valid) return null;

  return { tenant_id: tenant.tenant_id, name: tenant.name };
}
