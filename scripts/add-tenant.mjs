#!/usr/bin/env node
/**
 * Helper script to generate tenant config entries
 * Usage: node scripts/add-tenant.mjs <username> <password> <tenant_id> <company_name>
 */

import bcrypt from "bcryptjs";

const [, , username, password, tenantId, ...nameParts] = process.argv;
const name = nameParts.join(" ");

if (!username || !password || !tenantId || !name) {
  console.log("Usage: node scripts/add-tenant.mjs <username> <password> <tenant_id> <company_name>");
  console.log('Example: node scripts/add-tenant.mjs john pass123 1001 "Acme Corp"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log("\nAdd this entry to your TENANTS environment variable:\n");
console.log(`"${username}": ${JSON.stringify({ password_hash: hash, tenant_id: tenantId, name })}`);
console.log("\nFull TENANTS value (if this is your only tenant):\n");
console.log(`TENANTS={"${username}":${JSON.stringify({ password_hash: hash, tenant_id: tenantId, name })}}`);
