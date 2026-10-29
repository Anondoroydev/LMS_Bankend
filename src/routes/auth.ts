import { randomInt, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { UserRole } from "@prisma/client";
import { prisma } from "../config/database.js";
import { authenticate, authenticatedUser, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { validateBody } from "../middleware/validate.js";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "../validators/schemas.js";
import { sendPasswordResetEmail } from "../services/email.js";
import { hashPasswordResetCode } from "../services/password-reset.js";

const router = Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many authentication requests. Try again later." },
});

function createSession(user: { id: string; role: UserRole; tokenVersion: number }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  const expiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 3600);
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60) {
    throw new Error("JWT_EXPIRES_IN_SECONDS must be an integer of at least 60");
  }
  const token = jwt.sign(
    { role: user.role, tokenVersion: user.tokenVersion },
    secret,
    { subject: user.id, expiresIn: expiresInSeconds },
  );
  return { token, expiresIn: expiresInSeconds };
}

router.post("/register", authRateLimit, validateBody(registerSchema), async (req, res) => {
  const { name, email, password } = req.body as ReturnType<typeof registerSchema.parse>;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: UserRole.STUDENT },
      select: { id: true, name: true, email: true, role: true, tokenVersion: true },
    });
    res.status(201).json({
      ...createSession(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "An account with this email already exists");
    }
    throw error;
  }
});

router.post("/login", authRateLimit, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as ReturnType<typeof loginSchema.parse>;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  res.json({
    ...createSession(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

router.post("/logout", authenticate, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  res.status(204).end();
});

router.get("/me", authenticate, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) throw new HttpError(401, "User account no longer exists");
  res.json({ user });
});

router.post("/forgot-password", authRateLimit, validateBody(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body as ReturnType<typeof forgotPasswordSchema.parse>;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) {
    res.status(202).json({ message: "If an account exists for that email, reset instructions will be sent." });
    return;
  }

  const code = randomInt(100_000, 1_000_000).toString();
  const codeHash = hashPasswordResetCode(user.id, code);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: codeHash, expiresAt } }),
  ]);

  try {
    await sendPasswordResetEmail(user.email, user.name, code);
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash: codeHash } });
    throw error;
  }
  res.status(202).json({ message: "If an account exists for that email, reset instructions will be sent." });
});

router.post("/reset-password", authRateLimit, validateBody(resetPasswordSchema), async (req, res) => {
  const { email, otp, password } = req.body as ReturnType<typeof resetPasswordSchema.parse>;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const resetToken = user
    ? await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      orderBy: { createdAt: "desc" },
    })
    : null;
  if (!user || !resetToken) {
    throw new HttpError(400, "Password reset token is invalid or expired");
  }
  const expectedHash = Buffer.from(resetToken.tokenHash, "hex");
  const suppliedHash = Buffer.from(hashPasswordResetCode(user.id, otp), "hex");
  if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash)) {
    const attempt = await prisma.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) throw new HttpError(400, "Password reset token is invalid or expired");
    throw new HttpError(400, "Password reset code is incorrect or expired");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new HttpError(400, "Password reset token is invalid or expired");
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } });
  });
  res.json({ message: "Password reset successfully. Please log in with your new password." });
});

export { router as authRouter };
