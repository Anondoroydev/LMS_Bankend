import { Router } from "express";
import bcrypt from "bcryptjs";
import { ContentType, Prisma, UserRole } from "@prisma/client";
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
  courseMessageSchema,
  courseReviewSchema,
  createTeacherSchema,
  courseSchema,
  enrollmentSchema,
  folderSchema,
  gradeSchema,
  heartbeatSchema,
  homeworkSchema,
  submissionSchema,
  studentProfileSchema,
} from "../validators/schemas.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();
const adminOnly = [authenticate, requireRole(UserRole.SUPER_ADMIN)];
const teacherOnly = [authenticate, requireRole(UserRole.TEACHER)];
const studentOnly = [authenticate, requireRole(UserRole.STUDENT)];
const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  fatherName: true,
  motherName: true,
  className: true,
} as const;

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

async function assertCourseChatAccess(courseId: string, userId: string, role: UserRole) {
  if (role === UserRole.TEACHER) {
    await ownedCourse(courseId, userId);
    return;
  }
  if (role !== UserRole.STUDENT) throw new HttpError(403, "Insufficient permissions");
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      batches: { some: { enrollments: { some: { studentId: userId } } } },
    },
    select: { id: true },
  });
  if (!course) throw new HttpError(404, "Course not found");
}

router.get("/admin/teachers", ...adminOnly, async (_req, res) => {
  const teachers = await prisma.user.findMany({
    where: { role: UserRole.TEACHER },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      _count: { select: { courses: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ teachers });
});

router.get("/admin/students", ...adminOnly, async (_req, res) => {
  const students = await prisma.user.findMany({
    where: { role: UserRole.STUDENT },
    select: {
      ...profileSelect,
      createdAt: true,
      enrollments: {
        select: {
          id: true,
          batch: {
            select: {
              id: true,
              name: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ students });
});

router.get("/profile", ...studentOnly, async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const profile = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!profile) throw new HttpError(404, "Student account not found");
  const complete = Boolean(
    profile.name.trim()
    && profile.phone
    && profile.fatherName
    && profile.motherName
    && profile.className,
  );
  res.json({ profile, complete });
});

router.patch("/profile", ...studentOnly, validateBody(studentProfileSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const profile = await prisma.user.update({
    where: { id: userId },
    data: req.body,
    select: profileSelect,
  });
  res.json({ profile, complete: true });
});

router.post(
  "/admin/teachers",
  ...adminOnly,
  validateBody(createTeacherSchema),
  async (req, res) => {
    const { name, email, password } = req.body as ReturnType<typeof createTeacherSchema.parse>;
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== UserRole.STUDENT) {
        throw new HttpError(409, "This email already belongs to a non-student account");
      }
      const [teacher] = await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            role: UserRole.TEACHER,
            tokenVersion: { increment: 1 },
          },
          select: { id: true, name: true, email: true, role: true, createdAt: true },
        }),
        prisma.passwordResetToken.deleteMany({ where: { userId: existing.id } }),
      ]);
      res.json({ teacher });
      return;
    }

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
    include: {
      batch: {
        include: {
          course: {
            include: { teacher: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  type EnrolledBatch = (typeof enrollments)[number]["batch"];
  type EnrolledCourse = EnrolledBatch["course"] & { batch: EnrolledBatch; batches: EnrolledBatch[]; studentCount: number };
  const courses = new Map<string, EnrolledCourse>();
  for (const { batch } of enrollments) {
    const course = courses.get(batch.course.id);
    if (course) {
      course.batches.push(batch);
    } else {
      courses.set(batch.course.id, { ...batch.course, batch, batches: [batch], studentCount: 0 });
    }
  }
  const courseIds = [...courses.keys()];
  if (courseIds.length) {
    const courseEnrollments = await prisma.enrollment.findMany({
      where: { batch: { courseId: { in: courseIds } } },
      select: { studentId: true, batch: { select: { courseId: true } } },
    });
    const studentIdsByCourse = new Map<string, Set<string>>();
    for (const enrollment of courseEnrollments) {
      const students = studentIdsByCourse.get(enrollment.batch.courseId) ?? new Set<string>();
      students.add(enrollment.studentId);
      studentIdsByCourse.set(enrollment.batch.courseId, students);
    }
    for (const [courseId, course] of courses) {
      course.studentCount = studentIdsByCourse.get(courseId)?.size ?? 0;
    }
  }
  res.json({ courses: [...courses.values()] });
});

router.get("/courses/:courseId/reviews", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  const courseId = param(req as AuthenticatedRequest, "courseId");
  if (auth.role === UserRole.STUDENT) {
    await assertCourseChatAccess(courseId, auth.userId, auth.role);
  } else if (auth.role === UserRole.TEACHER) {
    await ownedCourse(courseId, auth.userId);
  } else {
    throw new HttpError(403, "Insufficient permissions");
  }

  const [reviews, summary, myReview] = await Promise.all([
    prisma.courseReview.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { student: { select: { name: true } } },
    }),
    prisma.courseReview.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.courseReview.findUnique({
      where: { courseId_studentId: { courseId, studentId: auth.userId } },
    }),
  ]);
  res.json({
    reviews,
    summary: { averageRating: summary._avg.rating ?? 0, reviewCount: summary._count._all },
    myReview,
  });
});

router.post("/courses/:courseId/reviews", ...studentOnly, validateBody(courseReviewSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const courseId = param(req as AuthenticatedRequest, "courseId");
  await assertCourseChatAccess(courseId, userId, UserRole.STUDENT);
  const { rating, content } = req.body as ReturnType<typeof courseReviewSchema.parse>;
  const review = await prisma.courseReview.upsert({
    where: { courseId_studentId: { courseId, studentId: userId } },
    create: { courseId, studentId: userId, rating, content },
    update: { rating, content },
    include: { student: { select: { name: true } } },
  });
  res.status(200).json({ review });
});

router.post("/courses", ...teacherOnly, validateBody(courseSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const course = await prisma.course.create({ data: { ...req.body, teacherId: userId } });
  res.status(201).json({ course });
});

router.delete("/courses/:courseId", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  if (auth.role !== UserRole.TEACHER && auth.role !== UserRole.SUPER_ADMIN) {
    throw new HttpError(403, "Insufficient permissions");
  }

  const courseId = param(req as AuthenticatedRequest, "courseId");
  const result = await prisma.course.deleteMany({
    where: auth.role === UserRole.TEACHER
      ? { id: courseId, teacherId: auth.userId }
      : { id: courseId },
  });
  if (result.count !== 1) throw new HttpError(404, "Course not found");
  res.status(204).end();
});

router.get("/courses/:courseId/messages", authenticate, async (req, res) => {
  const auth = authenticatedUser(req as AuthenticatedRequest);
  const courseId = param(req as AuthenticatedRequest, "courseId");
  await assertCourseChatAccess(courseId, auth.userId, auth.role);

  const afterId = req.query.after;
  let where: Prisma.CourseMessageWhereInput = { courseId };
  let orderBy: Array<{ createdAt: "asc" | "desc"; id: "asc" | "desc" }>;
  if (typeof afterId === "string") {
    const parsedId = z.string().uuid().safeParse(afterId);
    if (!parsedId.success) throw new HttpError(400, "Invalid after cursor");
    const cursor = await prisma.courseMessage.findFirst({
      where: { id: parsedId.data, courseId },
      select: { id: true, createdAt: true },
    });
    if (!cursor) throw new HttpError(400, "Invalid after cursor");
    where = {
      courseId,
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    };
    orderBy = [{ createdAt: "asc", id: "asc" }];
  } else if (afterId !== undefined) {
    throw new HttpError(400, "Invalid after cursor");
  } else {
    orderBy = [{ createdAt: "desc", id: "desc" }];
  }

  const messages = await prisma.courseMessage.findMany({
    where,
    include: { sender: { select: { id: true, name: true, role: true } } },
    orderBy,
    take: 100,
  });
  res.json({ messages: typeof afterId === "string" ? messages : messages.reverse() });
});

router.post(
  "/courses/:courseId/messages",
  authenticate,
  validateBody(courseMessageSchema),
  async (req, res) => {
    const auth = authenticatedUser(req as AuthenticatedRequest);
    const courseId = param(req as AuthenticatedRequest, "courseId");
    await assertCourseChatAccess(courseId, auth.userId, auth.role);
    const message = await prisma.courseMessage.create({
      data: { courseId, senderId: auth.userId, content: req.body.content },
      include: { sender: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ message });
  },
);

router.post("/courses/:courseId/batches", ...teacherOnly, validateBody(batchSchema), async (req, res) => {
  const { userId } = authenticatedUser(req as AuthenticatedRequest);
  const courseId = param(req as AuthenticatedRequest, "courseId");
  await ownedCourse(courseId, userId);
  const batch = await prisma.batch.create({ data: { ...req.body, courseId } });
  res.status(201).json({ batch });
});

router.post(
  "/batches/:batchId/enrollments",
  authenticate,
  validateBody(enrollmentSchema),
  async (req, res) => {
    const auth = authenticatedUser(req as AuthenticatedRequest);
    if (auth.role !== UserRole.SUPER_ADMIN && auth.role !== UserRole.TEACHER) {
      throw new HttpError(403, "Insufficient permissions");
    }

    const batchId = param(req as AuthenticatedRequest, "batchId");
    if (auth.role === UserRole.TEACHER) {
      await ownedBatch(batchId, auth.userId);
    } else {
      const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
      if (!batch) throw new HttpError(404, "Batch not found");
    }

    const enrollmentInput = req.body as ReturnType<typeof enrollmentSchema.parse>;
    const student = await prisma.user.findUnique({
      where: "studentEmail" in enrollmentInput
        ? { email: enrollmentInput.studentEmail }
        : { id: enrollmentInput.studentId },
    });
    if (!student || student.role !== UserRole.STUDENT) {
      throw new HttpError(404, "Student account not found");
    }
    const studentId = student.id;
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
      select: { id: true },
    });
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_batchId: { studentId, batchId } },
      create: { studentId, batchId },
      update: {},
    });
    res.status(existingEnrollment ? 200 : 201).json({ enrollment, alreadyEnrolled: Boolean(existingEnrollment) });
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
    res.json({ folders });
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
    res.json({ content, playback: { provider: "html5" } });
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
