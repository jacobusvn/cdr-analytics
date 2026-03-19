import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "default-dev-secret";

export interface TokenPayload {
  tenant_id: string;
  name: string;
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as TokenPayload;
  } catch {
    return null;
  }
}
