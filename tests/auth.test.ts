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
    phone: null as string | null,
    fatherName: null as string | null,
    motherName: null as string | null,
    className: null as string | null,
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
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
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
  batchFindFirst: vi.fn(),
  courseFindFirst: vi.fn(),
  courseDeleteMany: vi.fn(),
  courseMessageFindFirst: vi.fn(),
  courseMessageFindMany: vi.fn(),
  courseMessageCreate: vi.fn(),
  courseReviewFindMany: vi.fn(),
  courseReviewAggregate: vi.fn(),
  courseReviewFindUnique: vi.fn(),
  courseReviewUpsert: vi.fn(),
  folderFindMany: vi.fn(),
  studentProgressFindMany: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      findMany: mocks.userFindMany,
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
    course: { findFirst: mocks.courseFindFirst, deleteMany: mocks.courseDeleteMany },
    courseMessage: {
      findFirst: mocks.courseMessageFindFirst,
      findMany: mocks.courseMessageFindMany,
      create: mocks.courseMessageCreate,
    },
    courseReview: {
      findMany: mocks.courseReviewFindMany,
      aggregate: mocks.courseReviewAggregate,
      findUnique: mocks.courseReviewFindUnique,
      upsert: mocks.courseReviewUpsert,
    },
    enrollment: {
      findUnique: mocks.enrollmentFindUnique,
      findMany: mocks.enrollmentFindMany,
      upsert: mocks.enrollmentUpsert,
      delete: mocks.enrollmentDelete,
    },
    batch: { findUnique: mocks.batchFindUnique, findFirst: mocks.batchFindFirst },
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
  mocks.user.phone = null;
  mocks.user.fatherName = null;
  mocks.user.motherName = null;
  mocks.user.className = null;
  mocks.user.tokenVersion = 0;
  mocks.resetToken = null;
  mocks.userFindUnique.mockImplementation(
    async ({ where }: { where: { email?: string; id?: string } }) =>
      (where.email === mocks.user.email || where.id === mocks.user.id) ? { ...mocks.user } : null,
  );
  mocks.userFindFirst.mockImplementation(async ({ where }: { where: { id?: string; role?: string } }) =>
    where.id === mocks.user.id && where.role === mocks.user.role ? { id: mocks.user.id } : null);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.userCreate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: mocks.user.id,
      name: data.name,
      email: data.email,
      role: data.role,
      tokenVersion: 0,
      createdAt: mocks.user.createdAt,
    }),
  );
  mocks.userUpdate.mockImplementation(async ({ data }: {
    data: {
      tokenVersion?: { increment: number };
      passwordHash?: string;
      name?: string;
      role?: string;
      phone?: string;
      fatherName?: string;
      motherName?: string;
      className?: string;
    };
  }) => {
    if (data.tokenVersion) mocks.user.tokenVersion += data.tokenVersion.increment;
    if (data.passwordHash) mocks.user.passwordHash = data.passwordHash;
    if (data.name) mocks.user.name = data.name;
    if (data.role) mocks.user.role = data.role;
    if (data.phone) mocks.user.phone = data.phone;
    if (data.fatherName) mocks.user.fatherName = data.fatherName;
    if (data.motherName) mocks.user.motherName = data.motherName;
    if (data.className) mocks.user.className = data.className;
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
  mocks.batchFindFirst.mockResolvedValue({ id: "815b0715-3ddb-4f85-a3bf-3705790801dc" });
  mocks.courseFindFirst.mockResolvedValue({ id: "71e96a40-abde-470c-8ff6-632207f6c83a" });
  mocks.courseDeleteMany.mockResolvedValue({ count: 1 });
  mocks.courseMessageFindFirst.mockResolvedValue(null);
  mocks.courseMessageFindMany.mockResolvedValue([]);
  mocks.courseMessageCreate.mockResolvedValue({
    id: "b5cddbb7-3816-4f2e-8e11-4aa3c57c2917",
    courseId: "71e96a40-abde-470c-8ff6-632207f6c83a",
    senderId: mocks.user.id,
    content: "Hello teacher",
    createdAt: new Date("2026-10-29T10:00:00.000Z"),
    sender: { id: mocks.user.id, name: mocks.user.name, role: mocks.user.role },
  });
  mocks.courseReviewFindMany.mockResolvedValue([]);
  mocks.courseReviewAggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });
  mocks.courseReviewFindUnique.mockResolvedValue(null);
  mocks.courseReviewUpsert.mockImplementation(async ({ create }: {
    create: { courseId: string; studentId: string; rating: number; content: string };
  }) => ({
    id: "course-review-id",
    ...create,
    createdAt: new Date("2026-10-29T10:00:00.000Z"),
    updatedAt: new Date("2026-10-29T10:00:00.000Z"),
    student: { name: mocks.user.name },
  }));
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
  it("allows a super admin to convert an existing student into a teacher", async () => {
    mocks.user.role = "SUPER_ADMIN";
    const student = {
      id: "8dc2cf7e-ec27-4110-8179-347767632764",
      name: "Registered Student",
      email: "teacher@example.com",
      role: UserRole.STUDENT,
      createdAt: mocks.user.createdAt,
    };
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email === student.email) return { ...student };
      return where.email === mocks.user.email || where.id === mocks.user.id ? { ...mocks.user } : null;
    });
    mocks.userUpdate.mockImplementation(async ({ where, data }: {
      where: { id: string };
      data: {
        name: string;
        passwordHash: string;
        role: string;
        tokenVersion: { increment: number };
      };
    }) => ({
      ...student,
      id: where.id,
      name: data.name,
      role: data.role,
    }));

    const token = await login();
    const response = await request(app)
      .post("/api/admin/teachers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Course Teacher", email: student.email, password });

    expect(response.status).toBe(200);
    expect(response.body.teacher).toMatchObject({
      id: student.id,
      email: student.email,
      role: UserRole.TEACHER,
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: student.id },
      data: expect.objectContaining({
        role: UserRole.TEACHER,
        tokenVersion: { increment: 1 },
      }),
    }));
    expect(mocks.resetTokenDeleteMany).toHaveBeenCalledWith({ where: { userId: student.id } });
  });

  it("registers a student and never returns the password hash", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ name: "New Student", email: "NEW@example.com", password });

    expect(response.status).toBe(201);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.expiresIn).toBe(3600);
    expect(response.body.user).toMatchObject({
      name: "New Student",
      email: "new@example.com",
      role: UserRole.STUDENT,
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: UserRole.STUDENT, passwordHash: expect.any(String) }),
    }));

    const account = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${response.body.token}`);
    expect(account.status).toBe(200);
    expect(account.body.user.role).toBe(UserRole.STUDENT);
  });

  it("requires a student profile and saves the requested family and class details", async () => {
    const token = await login();
    const initial = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
    expect(initial.status).toBe(200);
    expect(initial.body.complete).toBe(false);

    const updated = await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Student Example",
        phone: "01700000000",
        fatherName: "Father Example",
        motherName: "Mother Example",
        className: "৮ম শ্রেণি",
      });

    expect(updated.status).toBe(200);
    expect(updated.body.complete).toBe(true);
    expect(updated.body.profile).toMatchObject({
      name: "Student Example",
      phone: "01700000000",
      fatherName: "Father Example",
      motherName: "Mother Example",
      className: "৮ম শ্রেণি",
    });
  });

  it("returns actual teacher and student rosters only to super admins", async () => {
    const token = await login();
    const forbidden = await request(app).get("/api/admin/students").set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(403);

    mocks.user.role = "SUPER_ADMIN";
    const adminToken = await login();
    const students = [{
      ...mocks.user,
      role: "STUDENT",
      enrollments: [{ id: "enrollment-id", batch: { id: "batch-id", name: "Class 8", course: { id: "course-id", title: "Math" } } }],
    }];
    mocks.userFindMany.mockResolvedValueOnce([{ id: "teacher-id", name: "Teacher", email: "teacher@example.com", _count: { courses: 2 } }]);
    mocks.userFindMany.mockResolvedValueOnce(students);

    const teachersResponse = await request(app).get("/api/admin/teachers").set("Authorization", `Bearer ${adminToken}`);
    const studentsResponse = await request(app).get("/api/admin/students").set("Authorization", `Bearer ${adminToken}`);

    expect(teachersResponse.status).toBe(200);
    expect(teachersResponse.body.teachers).toHaveLength(1);
    expect(studentsResponse.status).toBe(200);
    expect(studentsResponse.body.students[0].enrollments[0].batch.course.title).toBe("Math");
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

  it("allows teachers to delete only their own courses", async () => {
    mocks.user.role = "TEACHER";
    const token = await login();
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";

    const response = await request(app)
      .delete(`/api/courses/${courseId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(204);
    expect(mocks.courseDeleteMany).toHaveBeenCalledWith({
      where: { id: courseId, teacherId: mocks.user.id },
    });

    mocks.courseDeleteMany.mockResolvedValueOnce({ count: 0 });
    const notOwned = await request(app)
      .delete(`/api/courses/${courseId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(notOwned.status).toBe(404);
  });

  it("allows super admins to delete any course and denies students", async () => {
    const studentToken = await login();
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";
    const forbidden = await request(app)
      .delete(`/api/courses/${courseId}`)
      .set("Authorization", `Bearer ${studentToken}`);
    expect(forbidden.status).toBe(403);

    mocks.user.role = "SUPER_ADMIN";
    const adminToken = await login();
    const response = await request(app)
      .delete(`/api/courses/${courseId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(204);
    expect(mocks.courseDeleteMany).toHaveBeenCalledWith({ where: { id: courseId } });
  });

  it("allows enrolled students and course teachers to send and read course chat messages", async () => {
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";
    const studentToken = await login();
    const sent = await request(app)
      .post(`/api/courses/${courseId}/messages`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ content: "  Hello teacher  " });

    expect(sent.status).toBe(201);
    expect(mocks.courseFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: courseId }),
    }));
    expect(mocks.courseMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { courseId, senderId: mocks.user.id, content: "Hello teacher" },
    }));

    mocks.user.role = "TEACHER";
    const teacherToken = await login();
    const messages = await request(app)
      .get(`/api/courses/${courseId}/messages`)
      .set("Authorization", `Bearer ${teacherToken}`);

    expect(messages.status).toBe(200);
    expect(mocks.courseFindFirst).toHaveBeenCalledWith({
      where: { id: courseId, teacherId: mocks.user.id },
    });
    expect(messages.body.messages).toHaveLength(0);
  });

  it("rejects course chat messages from un-enrolled students and admins", async () => {
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";
    const studentToken = await login();
    mocks.courseFindFirst.mockResolvedValueOnce(null);
    const unenrolled = await request(app)
      .get(`/api/courses/${courseId}/messages`)
      .set("Authorization", `Bearer ${studentToken}`);
    expect(unenrolled.status).toBe(404);

    mocks.user.role = "SUPER_ADMIN";
    const adminToken = await login();
    const adminResponse = await request(app)
      .post(`/api/courses/${courseId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ content: "Admin message" });
    expect(adminResponse.status).toBe(403);
  });

  it("groups a student's enrolled batches by course and includes the teacher name", async () => {
    const token = await login();
    const course = {
      id: "71e96a40-abde-470c-8ff6-632207f6c83a",
      title: "Biology",
      teacher: { id: "teacher-id", name: "Course Teacher" },
    };
    mocks.enrollmentFindMany.mockResolvedValueOnce([
      { batch: { id: "batch-one", name: "Class 8A", course } },
      { batch: { id: "batch-two", name: "Class 8B", course } },
    ]);
    mocks.enrollmentFindMany.mockResolvedValueOnce([
      { studentId: "student-one", batch: { courseId: course.id } },
      { studentId: "student-two", batch: { courseId: course.id } },
      { studentId: "student-one", batch: { courseId: course.id } },
    ]);

    const response = await request(app)
      .get("/api/courses")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.courses).toHaveLength(1);
    expect(response.body.courses[0].teacher.name).toBe("Course Teacher");
    expect(response.body.courses[0].studentCount).toBe(2);
    expect(response.body.courses[0].batches.map((batch: { id: string }) => batch.id)).toEqual(["batch-one", "batch-two"]);
  });

  it("allows enrolled students to create a course review and read real reviews", async () => {
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";
    const review = {
      id: "review-id",
      courseId,
      studentId: mocks.user.id,
      rating: 5,
      content: "The lessons are clear and helpful.",
      createdAt: new Date("2026-10-29T10:00:00.000Z"),
      student: { name: mocks.user.name },
    };
    mocks.courseReviewUpsert.mockResolvedValue(review);
    mocks.courseReviewFindMany.mockResolvedValue([review]);
    mocks.courseReviewAggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { _all: 1 } });
    mocks.courseReviewFindUnique.mockResolvedValue(review);

    const token = await login();
    const submitted = await request(app)
      .post(`/api/courses/${courseId}/reviews`)
      .auth(token, { type: "bearer" })
      .send({ rating: 5, content: review.content });

    expect(submitted.status).toBe(200);
    expect(submitted.body.review).toMatchObject({ rating: 5, content: review.content });
    expect(mocks.courseReviewUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { courseId_studentId: { courseId, studentId: mocks.user.id } },
      create: { courseId, studentId: mocks.user.id, rating: 5, content: review.content },
    }));

    const listed = await request(app)
      .get(`/api/courses/${courseId}/reviews`)
      .auth(token, { type: "bearer" });
    expect(listed.status).toBe(200);
    expect(listed.body.summary).toEqual({ averageRating: 5, reviewCount: 1 });
    expect(listed.body.reviews[0]).toMatchObject({ student: { name: mocks.user.name } });
    expect(listed.body.myReview.rating).toBe(5);
  });

  it("rejects course reviews from non-enrolled students and invalid ratings", async () => {
    const courseId = "71e96a40-abde-470c-8ff6-632207f6c83a";
    const token = await login();
    const invalidRating = await request(app)
      .post(`/api/courses/${courseId}/reviews`)
      .auth(token, { type: "bearer" })
      .send({ rating: 6, content: "This is a review." });
    expect(invalidRating.status).toBe(400);

    mocks.courseFindFirst.mockResolvedValueOnce(null);
    const notEnrolled = await request(app)
      .post(`/api/courses/${courseId}/reviews`)
      .auth(token, { type: "bearer" })
      .send({ rating: 4, content: "This is a review." });
    expect(notEnrolled.status).toBe(404);
    expect(mocks.courseReviewUpsert).not.toHaveBeenCalled();
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

  it("lets super admins grant student batch access by student ID", async () => {
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

  it("lets super admins enroll a student by email and safely repeat the request", async () => {
    mocks.user.role = "SUPER_ADMIN";
    const token = await login();
    const student = {
      id: "8dc2cf7e-ec27-4110-8179-347767632764",
      email: "student.to.enroll@example.com",
      role: UserRole.STUDENT,
    };
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email === student.email) return student;
      return (where.email === mocks.user.email || where.id === mocks.user.id) ? { ...mocks.user } : null;
    });
    mocks.enrollmentFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "enrollment-id" });
    const url = "/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments";

    const first = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ studentEmail: ` ${student.email.toUpperCase()} ` });
    const repeated = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send({ studentEmail: student.email });

    expect(first.status).toBe(201);
    expect(first.body.alreadyEnrolled).toBe(false);
    expect(repeated.status).toBe(200);
    expect(repeated.body.alreadyEnrolled).toBe(true);
    expect(mocks.enrollmentUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.userFindUnique).toHaveBeenCalledWith({ where: { email: student.email } });
  });

  it("lets teachers enroll a student by email in their own batch", async () => {
    mocks.user.role = "TEACHER";
    const studentId = "8dc2cf7e-ec27-4110-8179-347767632764";
    mocks.userFindUnique.mockImplementation(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email === "new.student@example.com") return { id: studentId, role: UserRole.STUDENT };
      return (where.email === mocks.user.email || where.id === mocks.user.id) ? { ...mocks.user } : null;
    });
    const token = await login();
    const response = await request(app)
      .post("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentEmail: "NEW.STUDENT@example.com" });

    expect(response.status).toBe(201);
    expect(mocks.batchFindFirst).toHaveBeenCalledWith({
      where: {
        id: "815b0715-3ddb-4f85-a3bf-3705790801dc",
        course: { teacherId: mocks.user.id },
      },
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({ where: { email: "new.student@example.com" } });
    expect(mocks.enrollmentUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId_batchId: { studentId, batchId: "815b0715-3ddb-4f85-a3bf-3705790801dc" } },
    }));
  });

  it("does not let teachers enroll students in another teacher's batch", async () => {
    mocks.user.role = "TEACHER";
    mocks.batchFindFirst.mockResolvedValue(null);
    const token = await login();
    const response = await request(app)
      .post("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/enrollments")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentEmail: "student@example.com" });

    expect(response.status).toBe(404);
    expect(mocks.batchFindFirst).toHaveBeenCalledOnce();
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

  it("provides enrolled students with video sources for browser playback", async () => {
    mocks.enrollmentFindUnique.mockResolvedValue({ id: "enrollment-id" });
    mocks.folderFindMany.mockResolvedValue([{
      id: "folder-id",
      title: "Chapter one",
      contents: [{
        id: "video-id",
        title: "Introduction",
        type: "VIDEO",
        videoUrl: "https://cdn.example.com/introduction.mp4",
      }],
      homework: [],
    }]);

    const token = await login();
    const response = await request(app)
      .get("/api/batches/815b0715-3ddb-4f85-a3bf-3705790801dc/folders")
      .auth(token, { type: "bearer" });

    expect(response.status).toBe(200);
    expect(response.body.folders[0].contents[0]).toMatchObject({
      type: "VIDEO",
      videoUrl: "https://cdn.example.com/introduction.mp4",
    });
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
