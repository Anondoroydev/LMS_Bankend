import { createHmac } from "node:crypto";

export function hashPasswordResetCode(userId: string, code: string) {
  const pepper = process.env.JWT_SECRET;
  if (!pepper || pepper.length < 32) {
    throw new Error("JWT_SECRET must be configured before hashing password reset codes");
  }
  return createHmac("sha256", pepper).update(`${userId}:${code}`).digest("hex");
}
