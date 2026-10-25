import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Anondo";
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email) throw new Error("Set SUPER_ADMIN_EMAIL before bootstrapping the account");
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("Set SUPER_ADMIN_PASSWORD to a unique password between 12 and 128 characters");
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.role === UserRole.SUPER_ADMIN) {
    if (await bcrypt.compare(password, existing.passwordHash)) {
      return;
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          passwordHash: await bcrypt.hash(password, 12),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.passwordResetToken.deleteMany({ where: { userId: existing.id } }),
    ]);
    return;
  }
  if (existing) {
    throw new Error("The configured super-admin email belongs to another role; refusing privilege escalation");
  }

  let admin;
  try {
    admin = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: UserRole.SUPER_ADMIN,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const concurrentlyCreated = await prisma.user.findUnique({ where: { email } });
      if (concurrentlyCreated?.role === UserRole.SUPER_ADMIN) {
        return;
      }
    }
    throw error;
  }
  if (!admin) throw new Error("Super admin bootstrap failed to produce an account");

}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
