CREATE TABLE "CourseMessage" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseMessage_courseId_createdAt_idx" ON "CourseMessage"("courseId", "createdAt");
CREATE INDEX "CourseMessage_senderId_idx" ON "CourseMessage"("senderId");

ALTER TABLE "CourseMessage"
ADD CONSTRAINT "CourseMessage_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseMessage"
ADD CONSTRAINT "CourseMessage_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
