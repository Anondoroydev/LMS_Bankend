import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const name = process.env.TEACHER_NAME;
  const email = process.env.TEACHER_EMAIL?.toLowerCase();
  const password = process.env.TEACHER_PASSWORD;
  if (!name || !email || !password || password.length < 12) {
    throw new Error("Set TEACHER_NAME, TEACHER_EMAIL, and TEACHER_PASSWORD (minimum 12 characters)");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== UserRole.TEACHER) {
    throw new Error("This email already belongs to a non-teacher account; use a different email");
  }
  await prisma.user.upsert({
    where: { email },
    create: { name, email, passwordHash, role: UserRole.TEACHER },
    update: { name, passwordHash, role: UserRole.TEACHER },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
