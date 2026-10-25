import { Router } from "express";
import bcrypt from "bcryptjs";
import { ContentType, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { HttpError } from "../middleware/errors.js";
import {
  authenticatedUser,
  authenticate,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  batchSchema,
  contentSchema,
  createTeacherSchema,
  courseSchema,
  enrollmentSchema,
  folderSchema,
  gradeSchema,
  heartbeatSchema,
  homeworkSchema,
  submissionSchema,
} from "../validators/schemas.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();
const adminOnly = [authenticate, requireRole(UserRole.SUPER_ADMIN)];
const teacherOnly = [authenticate, requireRole(UserRole.TEACHER)];
const studentOnly = [authenticate, requireRole(UserRole.STUDENT)];

function param(req: AuthenticatedRequest, key: string) {
  const value = req.params[key];
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, `Invalid ${key}`);
  return parsed.data;
}

async function ownedCourse(courseId: string, teacherId: string) {
  const course = await prisma.course.findFirst({ where: { id: courseId, teacherId } });
  if (!course) throw new HttpError(404, "Course not found");
  return course;
}

async function ownedBatch(batchId: string, teacherId: string) {
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, course: { teacherId } },
  });
  if (!batch) throw new HttpError(404, "Batch not found");
  return batch;
}

async function enrolledBatch(batchId: string, studentId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_batchId: { studentId, batchId } },
  });
  if (!enrollment) throw new HttpError(404, "Batch not found");
}

async function ownedFolder(folderId: string, teacherId: string) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, batch: { course: { teacherId } } },
  });
  if (!folder) throw new HttpError(404, "Folder not found");
  return folder;
}

async function assertBatchReadAccess(batchId: string, userId: string, role: UserRole) {
  if (role === UserRole.SUPER_ADMIN) return;
  if (role === UserRole.STUDENT) return enrolledBatch(batchId, userId);
  await ownedBatch(batchId, userId);
}

router.post(
  "/admin/teachers",
  ...adminOnly,
  validateBody(createTeacherSchema),
  async (req, res) => {
    const { name, email, password } = req.body as ReturnType<typeof createTeacherSchema.parse>;
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const teacher = await prisma.user.create({
        data: { name, email, passwordHash, role: UserRole.TEACHER },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      res.status(201).json({ teacher });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new HttpError(409, "An account with this email already exists");
      }
      throw error;
    }
  },
);

router.get("/courses", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  if (auth.role === UserRole.TEACHER || auth.role === UserRole.SUPER_ADMIN) {
    const courses = await prisma.course.findMany({
      ...(auth.role === UserRole.TEACHER ? { where: { teacherId: auth.userId } } : {}),
      include: { batches: { select: { id: true, name: true, _count: { select: { enrollments: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ courses });
    return;
  }
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: auth.userId },
    include: { batch: { include: { course: true } } },
  });
  res.json({ courses: enrollments.map(({ batch }) => ({ ...batch.course, batch })) });
});

router.post("/courses", ...teacherOnly, validateBody(courseSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const course = await prisma.course.create({ data: { ...req.body, teacherId: userId } });
  res.status(201).json({ course });
});

router.post("/courses/:courseId/batches", ...teacherOnly, validateBody(batchSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const courseId = param(req as AuthenticatedRequest, "courseId");
  await ownedCourse(courseId, userId);
  const batch = await prisma.batch.create({ data: { ...req.body, courseId } });
  res.status(201).json({ batch });
});

router.post(
  "/batches/:batchId/enrollments",
  ...adminOnly,
  validateBody(enrollmentSchema),
  async (req, res) => {
    const batchId = param(req as AuthenticatedRequest, "batchId");
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!batch) throw new HttpError(404, "Batch not found");
    const { studentId } = req.body as ReturnType<typeof enrollmentSchema.parse>;
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== UserRole.STUDENT) {
      throw new HttpError(404, "Student account not found");
    }
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_batchId: { studentId, batchId } },
      create: { studentId, batchId },
      update: {},
    });
    res.status(201).json({ enrollment });
  },
);

router.delete("/batches/:batchId/enrollments/:studentId", ...adminOnly, async (req, res) => {
  const batchId = param(req as AuthenticatedRequest, "batchId");
  const studentId = param(req as AuthenticatedRequest, "studentId");
  const student = await prisma.user.findFirst({
    where: { id: studentId, role: UserRole.STUDENT },
    select: { id: true },
  });
  if (!student) throw new HttpError(404, "Student account not found");
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_batchId: { studentId, batchId } },
  });
  if (!enrollment) throw new HttpError(404, "Student does not have access to this batch");
  await prisma.enrollment.delete({ where: { id: enrollment.id } });
  res.status(204).end();
});

router.get("/batches/:batchId/folders", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  const batchId = param(req as AuthenticatedRequest, "batchId");
  await assertBatchReadAccess(batchId, auth.userId, auth.role);
  const folders = await prisma.folder.findMany({
    where: { batchId },
    include: {
      contents: { orderBy: { createdAt: "asc" } },
      homework: { orderBy: { dueDate: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (auth.role === UserRole.STUDENT) {
    res.json({
      folders: folders.map((folder) => ({
        ...folder,
        contents: folder.contents.map(({ videoUrl: _protectedSource, ...content }) => content),
      })),
    });
    return;
  }
  res.json({ folders });
});

router.post("/folders", ...teacherOnly, validateBody(folderSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const { batchId, parentFolderId, ...data } = req.body as ReturnType<typeof folderSchema.parse>;
  await ownedBatch(batchId, userId);
  if (parentFolderId) {
    const parent = await ownedFolder(parentFolderId, userId);
    if (parent.batchId !== batchId) throw new HttpError(400, "Parent folder must belong to the same batch");
  }
  const folder = await prisma.folder.create({
    data: { ...data, batchId, ...(parentFolderId ? { parentFolderId } : {}) },
  });
  res.status(201).json({ folder });
});

router.post("/content", ...teacherOnly, validateBody(contentSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const { folderId, ...data } = req.body as ReturnType<typeof contentSchema.parse>;
  await ownedFolder(folderId, userId);
  const content = await prisma.content.create({ data: { ...data, folderId } });
  res.status(201).json({ content });
});

router.get("/content/:contentId", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  const contentId = param(req as AuthenticatedRequest, "contentId");
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { folder: { select: { batchId: true, batch: { select: { course: { select: { teacherId: true } } } } } } },
  });
  if (!content) throw new HttpError(404, "Content not found");
  if (auth.role === UserRole.STUDENT) await enrolledBatch(content.folder.batchId, auth.userId);
  else if (auth.role === UserRole.TEACHER && content.folder.batch.course.teacherId !== auth.userId) {
    throw new HttpError(404, "Content not found");
  }
  if (auth.role === UserRole.STUDENT && content.type === ContentType.VIDEO) {
    const { videoUrl: _protectedSource, ...studentContent } = content;
    res.json({ content: studentContent, playback: { provider: "not_configured" } });
    return;
  }
  res.json({ content });
});

router.post("/homework", ...teacherOnly, validateBody(homeworkSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const { folderId, ...data } = req.body as ReturnType<typeof homeworkSchema.parse>;
  await ownedFolder(folderId, userId);
  const homework = await prisma.homework.create({
    data: { ...data, folderId, createdById: userId },
  });
  res.status(201).json({ homework });
});

router.get("/batches/:batchId/homework", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  const batchId = param(req as AuthenticatedRequest, "batchId");
  await assertBatchReadAccess(batchId, auth.userId, auth.role);
  const homework = await prisma.homework.findMany({
    where: { folder: { batchId } },
    include: auth.role === UserRole.STUDENT
      ? { submissions: { where: { studentId: auth.userId } } }
      : { submissions: { include: { student: { select: { id: true, name: true, email: true } } } } },
    orderBy: { dueDate: "asc" },
  });
  res.json({ homework });
});

router.post(
  "/homework/:homeworkId/submissions",
  ...studentOnly,
  validateBody(submissionSchema),
  async (req, res) => {
    const { userId } = authenticatedUser(req as AuthenticatedRequest);
    const homeworkId = param(req as AuthenticatedRequest, "homeworkId");
    const homework = await prisma.homework.findUnique({
      where: { id: homeworkId },
      include: { folder: { select: { batchId: true } } },
    });
    if (!homework) throw new HttpError(404, "Homework not found");
    await enrolledBatch(homework.folder.batchId, userId);
    if (homework.dueDate < new Date()) throw new HttpError(400, "Homework deadline has passed");
    const submission = await prisma.submission.upsert({
      where: { homeworkId_studentId: { homeworkId, studentId: userId } },
      create: { ...req.body, homeworkId, studentId: userId },
      update: { ...req.body, submittedAt: new Date() },
    });
    res.status(201).json({ submission });
  },
);

router.patch(
  "/submissions/:submissionId/grade",
  ...teacherOnly,
  validateBody(gradeSchema),
  async (req, res) => {
    const { userId } = authenticatedUser(req as AuthenticatedRequest);
    const submissionId = param(req as AuthenticatedRequest, "submissionId");
    const submission = await prisma.submission.findFirst({
      where: { id: submissionId, homework: { createdById: userId } },
    });
    if (!submission) throw new HttpError(404, "Submission not found");
    const graded = await prisma.submission.update({
      where: { id: submissionId },
      data: req.body,
    });
    res.json({ submission: graded });
  },
);

router.post("/progress/heartbeat", ...studentOnly, validateBody(heartbeatSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const { contentId, watchDurationDelta, lastPosition } =
    req.body as ReturnType<typeof heartbeatSchema.parse>;
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { folder: { select: { batchId: true } } },
  });
  if (!content || content.type !== ContentType.VIDEO) throw new HttpError(404, "Video not found");
  await enrolledBatch(content.folder.batchId, userId);
  if (content.durationSeconds !== null && lastPosition > content.durationSeconds) {
    throw new HttpError(400, "Playback position exceeds video duration");
  }
  const recentHeartbeat = await prisma.progressHeartbeat.findFirst({
    where: { studentId: userId, contentId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recentHeartbeat && Date.now() - recentHeartbeat.createdAt.getTime() < 8_000) {
    throw new HttpError(429, "Wait before sending the next playback heartbeat");
  }
  const completed = content.durationSeconds !== null
    && lastPosition >= Math.max(0, content.durationSeconds - 10);
  const progress = await prisma.$transaction(async (tx) => {
    await tx.progressHeartbeat.create({
      data: { studentId: userId, contentId, watchDuration: watchDurationDelta, lastPosition },
    });
    return tx.studentProgress.upsert({
      where: { studentId_contentId: { studentId: userId, contentId } },
      create: {
        studentId: userId,
        contentId,
        watchDuration: watchDurationDelta,
        lastPosition,
        isCompleted: completed,
        lastWatchedAt: new Date(),
      },
      update: {
        watchDuration: { increment: watchDurationDelta },
        lastPosition,
        ...(completed ? { isCompleted: true } : {}),
        lastWatchedAt: new Date(),
      },
    });
  });
  res.json({ progress });
});

router.get("/progress/me", ...studentOnly, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: userId },
    select: {
      batch: {
        select: {
          id: true,
          name: true,
          course: { select: { id: true, title: true } },
          folders: {
            select: {
              contents: {
                where: { type: ContentType.VIDEO },
                select: {
                  id: true,
                  title: true,
                  durationSeconds: true,
                  progress: {
                    where: { studentId: userId },
                    select: {
                      watchDuration: true,
                      lastPosition: true,
                      isCompleted: true,
                      lastWatchedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const batches = enrollments.map(({ batch }) => {
    const videos = batch.folders.flatMap((folder) => folder.contents);
    const completedVideos = videos.filter((video) => video.progress[0]?.isCompleted).length;
    const watchDuration = videos.reduce(
      (total, video) => total + (video.progress[0]?.watchDuration ?? 0),
      0,
    );
    return {
      batchId: batch.id,
      batchName: batch.name,
      course: batch.course,
      totalVideos: videos.length,
      completedVideos,
      completionPercentage: videos.length === 0 ? 0 : Math.round((completedVideos / videos.length) * 100),
      watchDuration,
      videos: videos.map(({ progress, ...video }) => ({
        ...video,
        progress: progress[0] ?? null,
      })),
    };
  });

  const coursesById = new Map<string, {
    course: { id: string; title: string };
    totalVideos: number;
    completedVideos: number;
    watchDuration: number;
  }>();
  for (const batch of batches) {
    const course = coursesById.get(batch.course.id) ?? {
      course: batch.course,
      totalVideos: 0,
      completedVideos: 0,
      watchDuration: 0,
    };
    course.totalVideos += batch.totalVideos;
    course.completedVideos += batch.completedVideos;
    course.watchDuration += batch.watchDuration;
    coursesById.set(batch.course.id, course);
  }

  res.json({
    batches,
    courses: Array.from(coursesById.values()).map((course) => ({
      ...course,
      completionPercentage: course.totalVideos === 0
        ? 0
        : Math.round((course.completedVideos / course.totalVideos) * 100),
    })),
  });
});

router.get("/progress/batches/:batchId", ...teacherOnly, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const batchId = param(req as AuthenticatedRequest, "batchId");
  await ownedBatch(batchId, userId);
  const progress = await prisma.studentProgress.findMany({
    where: { content: { folder: { batchId } } },
    include: {
      student: { select: { id: true, name: true, email: true } },
      content: { select: { id: true, title: true, durationSeconds: true } },
    },
    orderBy: { lastWatchedAt: "desc" },
  });
  res.json({ progress });
});

router.get("/progress/batches/:batchId/students/:studentId", ...teacherOnly, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const batchId = param(req as AuthenticatedRequest, "batchId");
  const studentId = param(req as AuthenticatedRequest, "studentId");
  await ownedBatch(batchId, userId);
  await enrolledBatch(batchId, studentId);

  const progress = await prisma.studentProgress.findMany({
    where: { studentId, content: { folder: { batchId } } },
    include: {
      content: {
        select: {
          id: true,
          title: true,
          durationSeconds: true,
          folder: { select: { title: true } },
          watchLogs: {
            where: { studentId },
            select: { id: true, watchDuration: true, lastPosition: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { lastWatchedAt: "desc" },
  });
  res.json({ studentId, batchId, progress });
});

export { router as apiRouter };
