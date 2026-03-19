import jwt from "jsonwebtoken";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "your-secret-key-change-this") {
    throw new Error(
      "JWT_SECRET environment variable is required. Generate one with: openssl rand -base64 32"
    );
  }
  return secret;
}

export interface TokenPayload {
  tenant_id: string;
  name: string;
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { algorithm: "HS256", expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    return null;
  }
}
