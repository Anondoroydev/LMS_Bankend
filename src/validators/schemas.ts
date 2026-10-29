import { ContentType } from "@prisma/client";
import { z } from "zod";

const uuid = z.string().uuid();
const url = z.string().url().max(2048);
const strongPassword = z.string()
  .min(16)
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: strongPassword,
});
export const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
});
export const resetPasswordSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  password: strongPassword,
});
export const courseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
});
export const batchSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export const enrollmentSchema = z.union([
  z.object({ studentId: uuid }),
  z.object({
    studentEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
  }),
]);
export const createTeacherSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: strongPassword,
});
export const studentProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(30),
  fatherName: z.string().trim().min(1).max(120),
  motherName: z.string().trim().min(1).max(120),
  className: z.string().trim().min(1).max(80),
});
export const folderSchema = z.object({
  title: z.string().trim().min(1).max(200),
  batchId: uuid,
  parentFolderId: uuid.nullable().optional(),
});
export const contentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.nativeEnum(ContentType),
  folderId: uuid,
  videoUrl: url.optional(),
  liveUrl: url.optional(),
  documentUrl: url.optional(),
  textContent: z.string().trim().min(1).max(20000).optional(),
  durationSeconds: z.number().int().positive().max(24 * 60 * 60).optional(),
}).superRefine((value, context) => {
  const requiredField = {
    [ContentType.VIDEO]: "videoUrl",
    [ContentType.LIVE_LINK]: "liveUrl",
    [ContentType.DOCUMENT]: "documentUrl",
    [ContentType.TEXT]: "textContent",
  }[value.type] as "videoUrl" | "liveUrl" | "documentUrl" | "textContent";
  if (!value[requiredField]) {
    context.addIssue({ code: "custom", path: [requiredField], message: `${requiredField} is required for ${value.type}` });
  }
});
export const homeworkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  dueDate: z.iso.datetime().transform((value) => new Date(value)),
  folderId: uuid,
});
export const submissionSchema = z.object({
  fileUrl: url.optional(),
}).refine((value) => Boolean(value.fileUrl), { message: "A fileUrl is required" });
export const gradeSchema = z.object({
  marks: z.number().min(0).max(1000),
  feedback: z.string().max(10000).optional(),
});
export const courseMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});
export const courseReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(3).max(1200),
});
export const heartbeatSchema = z.object({
  contentId: uuid,
  watchDurationDelta: z.number().int().min(0).max(15),
  lastPosition: z.number().int().min(0),
});
