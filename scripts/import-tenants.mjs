#!/usr/bin/env node
/**
 * Bulk import tenants from a CSV file.
 *
 * Usage: node scripts/import-tenants.mjs <path-to-csv>
 *
 * CSV format (with header row):
 *   username,password,tenant_id,company_name
 *   john,pass123,1001,Acme Corp
 *   jane,secret456,1002,Beta Inc
 *
 * Output: The full TENANTS JSON string ready to paste into Vercel env vars.
 */

import { readFileSync } from "fs";
import bcrypt from "bcryptjs";

const csvPath = process.argv[2];

if (!csvPath) {
  console.log("Usage: node scripts/import-tenants.mjs <path-to-csv>");
  console.log("");
  console.log("CSV format (first row is header):");
  console.log("  username,password,tenant_id,company_name");
  console.log("  john,pass123,1001,Acme Corp");
  console.log("  jane,secret456,1002,Beta Inc");
  process.exit(1);
}

const raw = readFileSync(csvPath, "utf-8").trim();
const lines = raw.split(/\r?\n/);

if (lines.length < 2) {
  console.error("Error: CSV must have a header row and at least one data row.");
  process.exit(1);
}

// Parse header
const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
const usernameIdx = header.findIndex((h) => h === "username" || h === "user");
const passwordIdx = header.findIndex((h) => h === "password" || h === "pass");
const tenantIdIdx = header.findIndex((h) => h === "tenant_id" || h === "tenantid" || h === "id");
const nameIdx = header.findIndex((h) => h === "company_name" || h === "company" || h === "name");

if (usernameIdx === -1 || passwordIdx === -1 || tenantIdIdx === -1 || nameIdx === -1) {
  console.error("Error: CSV must have columns: username, password, tenant_id, company_name");
  console.error("Found columns:", header.join(", "));
  process.exit(1);
}

const tenants = {};
let count = 0;
const errors = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  // Simple CSV parsing (handles quoted fields with commas)
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());

  const username = fields[usernameIdx];
  const password = fields[passwordIdx];
  const tenantId = fields[tenantIdIdx];
  const name = fields[nameIdx];

  if (!username || !password || !tenantId || !name) {
    errors.push(`Row ${i + 1}: Missing data (username=${username}, tenant_id=${tenantId}, name=${name})`);
    continue;
  }

  if (tenants[username]) {
    errors.push(`Row ${i + 1}: Duplicate username "${username}" (skipped)`);
    continue;
  }

  const hash = bcrypt.hashSync(password, 10);
  tenants[username] = {
    password_hash: hash,
    tenant_id: tenantId,
    name: name,
  };
  count++;
  process.stdout.write(`\rProcessing... ${count} tenants hashed`);
}

console.log(""); // newline after progress

if (errors.length > 0) {
  console.log("\n⚠️  Warnings:");
  errors.forEach((e) => console.log(`   ${e}`));
}

console.log(`\n✅ Successfully processed ${count} tenants\n`);

const json = JSON.stringify(tenants);

console.log("═══════════════════════════════════════════════════════════");
console.log("TENANTS env var value (copy everything between the lines):");
console.log("═══════════════════════════════════════════════════════════");
console.log(json);
console.log("═══════════════════════════════════════════════════════════");
console.log(`\nCharacter count: ${json.length}`);
console.log("\nPaste this value into Vercel → Settings → Environment Variables → TENANTS");
