import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import { UserRole } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  user: {
    id: "7dc2cf7e-ec27-4110-8179-347767632763",
    name: "Student Example",
    email: "student@example.com",
    passwordHash: "",
    role: "STUDENT",
    tokenVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  resetToken: null as null | {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    attempts: number;
    usedAt: Date | null;
  },
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  resetTokenFindUnique: vi.fn(),
  resetTokenFindFirst: vi.fn(),
  resetTokenCreate: vi.fn(),
  resetTokenUpdateMany: vi.fn(),
  resetTokenDeleteMany: vi.fn(),
  enrollmentFindUnique: vi.fn(),
  enrollmentFindMany: vi.fn(),
  enrollmentUpsert: vi.fn(),
  enrollmentDelete: vi.fn(),
  batchFindUnique: vi.fn(),
  folderFindMany: vi.fn(),
  studentProgressFindMany: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
      update: mocks.userUpdate,
    },
    passwordResetToken: {
      findUnique: mocks.resetTokenFindUnique,
      findFirst: mocks.resetTokenFindFirst,
      create: mocks.resetTokenCreate,
      updateMany: mocks.resetTokenUpdateMany,
      deleteMany: mocks.resetTokenDeleteMany,
    },
    enrollment: {
      findUnique: mocks.enrollmentFindUnique,
      findMany: mocks.enrollmentFindMany,
      upsert: mocks.enrollmentUpsert,
      delete: mocks.enrollmentDelete,
    },
    batch: { findUnique: mocks.batchFindUnique },
    folder: { findMany: mocks.folderFindMany },
    studentProgress: { findMany: mocks.studentProgressFindMany },
    $transaction: vi.fn(async (operation: unknown) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      if (typeof operation === "function") {
        return operation({
          user: { update: mocks.userUpdate },
          passwordResetToken: {
            updateMany: mocks.resetTokenUpdateMany,
            deleteMany: mocks.resetTokenDeleteMany,
          },
        });
      }
      throw new Error("Unexpected transaction operation");
    }),
  },
}));

vi.mock("../src/services/email.js", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

import { app } from "../src/app.js";

const secret = "test-secret-with-at-least-thirty-two-characters";
const password = "Correct-Horse-Battery-42!";

beforeEach(async () => {
  process.env.JWT_SECRET = secret;
  process.env.JWT_EXPIRES_IN_SECONDS = "3600";
  process.env.FRONTEND_URL = "https://lms.example.com";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASSWORD = "test-password";
  process.env.SMTP_FROM = "LMS <noreply@example.com>";
  process.env.NODE_ENV = "test";

  mocks.user.passwordHash = await bcrypt.hash(password, 4);
  mocks.user.role = "STUDENT";
  mocks.user.tokenVersion = 0;
  mocks.resetToken = null;
  mocks.userFindUnique.mockImplementation(
    async ({ where }: { where: { email?: string; id?: string } }) =>
      (where.email === mocks.user.email || where.id === mocks.user.id) ? { ...mocks.user } : null,
  );
  mocks.userCreate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: mocks.user.id,
      name: data.name,
      email: data.email,
      role: data.role,
      createdAt: mocks.user.createdAt,
    }),
  );
  mocks.userUpdate.mockImplementation(async ({ data }: { data: { tokenVersion?: { increment: number }; passwordHash?: string } }) => {
    if (data.tokenVersion) mocks.user.tokenVersion += data.tokenVersion.increment;
    if (data.passwordHash) mocks.user.passwordHash = data.passwordHash;
    return { ...mocks.user };
  });
  mocks.resetTokenFindFirst.mockImplementation(
    async ({ where }: {
      where: {
        userId: string;
        usedAt: null;
        expiresAt: { gt: Date };
        attempts: { lt: number };
      };
    }) => {
      const token = mocks.resetToken;
      if (
        !token
        || token.userId !== where.userId
        || token.usedAt
        || token.expiresAt <= where.expiresAt.gt
        || token.attempts >= where.attempts.lt
      ) return null;
      return { ...token };
    },
  );
  mocks.resetTokenCreate.mockImplementation(
    async ({ data }: { data: Omit<NonNullable<typeof mocks.resetToken>, "id" | "usedAt" | "attempts"> }) => {
      mocks.resetToken = { ...data, attempts: 0, id: "reset-token-id", usedAt: null };
      return { ...mocks.resetToken };
    },
  );
  mocks.resetTokenUpdateMany.mockImplementation(
    async ({ where, data }: {
      where: { id?: string; usedAt?: null; expiresAt?: { gt: Date }; attempts?: { lt: number } };
      data: { usedAt?: Date; attempts?: { increment: number } };
    }) => {
      if (!mocks.resetToken || mocks.resetToken.id !== where.id || mocks.resetToken.usedAt) return { count: 0 };
      if (where.expiresAt && mocks.resetToken.expiresAt <= where.expiresAt.gt) return { count: 0 };
      if (where.attempts && mocks.resetToken.attempts >= where.attempts.lt) return { count: 0 };
      if (data.usedAt) mocks.resetToken.usedAt = data.usedAt;
      if (data.attempts) mocks.resetToken.attempts += data.attempts.increment;
      return { count: 1 };
    },
  );
  mocks.resetTokenDeleteMany.mockImplementation(
    async ({ where }: { where: { userId?: string; tokenHash?: string } }) => {
      if (
        mocks.resetToken
        && (where.userId === mocks.resetToken.userId || where.tokenHash === mocks.resetToken.tokenHash)
      ) {
        mocks.resetToken = null;
      }
      return { count: 1 };
    },
  );
  mocks.enrollmentFindUnique.mockResolvedValue(null);
  mocks.enrollmentFindMany.mockResolvedValue([]);
  mocks.enrollmentUpsert.mockResolvedValue({ id: "enrollment-id" });
  mocks.enrollmentDelete.mockResolvedValue({ id: "enrollment-id" });
  mocks.batchFindUnique.mockResolvedValue({ id: "815b0715-3ddb-4f85-a3bf-3705790801dc" });
  mocks.folderFindMany.mockResolvedValue([]);
  mocks.studentProgressFindMany.mockResolvedValue([]);
  mocks.sendPasswordResetEmail.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function login() {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: mocks.user.email, password });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

describe("authentication API", () => {
  it("registers a student and never returns the password hash", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ name: "New Student", email: "NEW@example.com", password });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      name: "New Student",
      email: "new@example.com",
      role: UserRole.STUDENT,
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: UserRole.STUDENT, passwordHash: expect.any(String) }),
    }));
  });

  it("rejects invalid credentials", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: mocks.user.email, password: "incorrect-password" });

    expect(response.status).toBe(401);
  });

  it("logs out and revokes the presented JWT", async () => {
    const token = await login();
    const logout = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it("does not allow a student to create teacher-only resources", async () => {
    const token = await login();
    const response = await request(app)
      .post("/api/courses")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Unauthorized course" });

    expect(response.status).toBe(403);
  });

  it("does not allow students to create teacher accounts or grant batch access", async () => {
    const token = await login();
    const teacherResponse = await request(app)
      .post("/api/admin/teachers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Teacher",
        email: "teacher@example.com",
        password: "Strong-Teacher-Password-123!",
      });
    expect(teacherResponse.status).toBe(403);

    const accessResponse = await request(app)
      .post("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentId: mocks.user.id });
    expect(accessResponse.status).toBe(403);
  });

  it("lets super admins create teachers with a strong password", async () => {
    mocks.user.role = "SUPER_ADMIN";
    const token = await login();
    const response = await request(app)
      .post("/api/admin/teachers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "New Teacher",
        email: "NEW.TEACHER@example.com",
        password: "Strong-Teacher-Password-123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.teacher).toMatchObject({
      email: "new.teacher@example.com",
      role: UserRole.TEACHER,
    });
    expect(response.body.teacher.passwordHash).toBeUndefined();
  });

  it("rejects weak passwords when a super admin creates a teacher", async () => {
    mocks.user.role = "SUPER_ADMIN";
    const token = await login();
    const response = await request(app)
      .post("/api/admin/teachers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "New Teacher",
        email: "teacher@example.com",
        password: "12345678",
      });

    expect(response.status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("lets only super admins grant student batch access", async () => {
    mocks.user.role = "SUPER_ADMIN";
    const studentId = "8dc2cf7e-ec27-4110-8179-347767632764";
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.id === studentId) return { id: studentId, role: UserRole.STUDENT };
      return (where.email === mocks.user.email || where.id === mocks.user.id) ? { ...mocks.user } : null;
    });
    const token = await login();
    const response = await request(app)
      .post("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentId });

    expect(response.status).toBe(201);
    expect(mocks.enrollmentUpsert).toHaveBeenCalledOnce();
  });

  it("does not let teachers grant batch access", async () => {
    mocks.user.role = "TEACHER";
    const token = await login();
    const response = await request(app)
      .post("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentId: "8dc2cf7e-ec27-4110-8179-347767632764" });

    expect(response.status).toBe(403);
    expect(mocks.enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("blocks students who are not enrolled in a batch", async () => {
    const token = await login();
    const response = await request(app)
      .get("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/folders")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(mocks.folderFindMany).not.toHaveBeenCalled();
  });

  it("returns video progress percentages for enrolled batches and courses", async () => {
    mocks.enrollmentFindMany.mockResolvedValue([
      {
        batch: {
          id: "815b0715-3ddb-4f85-a3bf-3705790801dc",
          name: "Morning batch",
          course: { id: "71e96a40-abde-470c-8ff6-632207f6c83a", title: "Biology" },
          folders: [{
            contents: [
              {
                id: "510c1804-f36f-4434-b085-7c138c7966dd",
                title: "Cell structure",
                durationSeconds: 300,
                progress: [{ watchDuration: 180, lastPosition: 270, isCompleted: true, lastWatchedAt: new Date() }],
              },
              {
                id: "7340a427-35ab-4814-a011-c8dc7534320a",
                title: "Cell division",
                durationSeconds: 420,
                progress: [],
              },
            ],
          }],
        },
      },
      {
        batch: {
          id: "6d7ace28-37ac-496f-87cb-17503e92d289",
          name: "Evening batch",
          course: { id: "71e96a40-abde-470c-8ff6-632207f6c83a", title: "Biology" },
          folders: [{ contents: [{
            id: "9efc4530-1621-4c49-bc01-e6fa622c806f",
            title: "Genetics",
            durationSeconds: 600,
            progress: [{ watchDuration: 120, lastPosition: 120, isCompleted: false, lastWatchedAt: new Date() }],
          }] }],
        },
      },
    ]);

    const token = await login();
    const response = await request(app)
      .get("/api/progress/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.batches).toHaveLength(2);
    expect(response.body.batches[0]).toMatchObject({
      totalVideos: 2,
      completedVideos: 1,
      completionPercentage: 50,
      watchDuration: 180,
    });
    expect(response.body.courses[0]).toMatchObject({
      totalVideos: 3,
      completedVideos: 1,
      completionPercentage: 33,
      watchDuration: 300,
    });
    expect(mocks.enrollmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: mocks.user.id },
    }));
  });

  it("sends an OTP and consumes it once", async () => {
    mocks.sendPasswordResetEmail.mockImplementation(
      async (_email: string, _name: string, code: string) => {
        const tokenHash = createHmac("sha256", secret).update(`${mocks.user.id}:${code}`).digest("hex");
        mocks.resetToken = {
          id: "reset-token-id",
          userId: mocks.user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          attempts: 0,
          usedAt: null,
        };
      },
    );

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: mocks.user.email });
    expect(forgot.status).toBe(202);
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce();
    const otp = mocks.sendPasswordResetEmail.mock.calls[0]?.[2] as string;
    expect(otp).toMatch(/^\d{6}$/);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: mocks.user.email, otp, password: "New-Correct-Horse-84!" });
    expect(reset.status).toBe(200);

    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: mocks.user.email, otp, password: "Another-Correct-Horse-85!" });
    expect(replay.status).toBe(400);
    expect(mocks.user.tokenVersion).toBe(1);
  });

  it("rejects a wrong OTP and locks it after five attempts", async () => {
    mocks.resetToken = {
      id: "reset-token-id",
      userId: mocks.user.id,
      tokenHash: createHmac("sha256", secret).update(`${mocks.user.id}:123456`).digest("hex"),
      expiresAt: new Date(Date.now() + 10 * 60_000),
      attempts: 0,
      usedAt: null,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: mocks.user.email, otp: "999999", password: "New-Correct-Horse-84!" });
      expect(response.status).toBe(400);
    }
    expect(mocks.resetToken?.attempts).toBe(5);
    const locked = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: mocks.user.email, otp: "123456", password: "New-Correct-Horse-84!" });
    expect(locked.status).toBe(400);
    expect(mocks.user.tokenVersion).toBe(0);
  });

  it("returns the same forgot-password response for an unknown email", async () => {
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "unknown@example.com" });

    expect(response.status).toBe(202);
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("rejects malformed requests using Zod validation", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
  });
});
