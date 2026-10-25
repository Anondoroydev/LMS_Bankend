# Secure Education LMS Backend

Express 5 REST API using TypeScript, PostgreSQL, Prisma, and Zod. No frontend is included.

## Backend structure

```text
src/
├── config/
│   └── database.ts       # Prisma client
├── middleware/
│   ├── auth.ts           # JWT authentication and role checks
│   ├── errors.ts         # HTTP errors and Express error handler
│   └── validate.ts       # Zod request validation middleware
├── routes/
│   ├── api.ts            # LMS REST API endpoints
│   └── auth.ts           # Registration, login, logout, password reset
├── services/
│   └── email.ts          # SMTP password reset email
├── app.ts                # Express app factory for server and tests
├── validators/
│   └── schemas.ts        # Zod request schemas
└── server.ts             # Express app and server startup
prisma/
├── schema.prisma         # PostgreSQL data model
├── seed.ts               # Trusted legacy teacher provisioning
└── bootstrap-super-admin.ts # Idempotent super-admin provisioning from environment
tests/
└── auth.test.ts          # HTTP-level auth and access-control tests
```

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, `SUPER_ADMIN_EMAIL`, a unique `SUPER_ADMIN_PASSWORD` (12–128 characters), and the desired `CORS_ORIGIN`. SMTP credentials are only needed for password-reset emails.
3. Install dependencies with `npm install`.
4. Generate Prisma Client and apply checked-in database migrations:

   ```sh
   npm run prisma:generate
   npm run prisma:deploy
   ```

5. Set `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD` in `.env`, then start the API:

   ```sh
   npm run dev
   ```

   Bootstrap runs automatically before `npm run dev` and `npm start`. It creates the admin with the configured password once; on later starts it reports that the account already exists. If the configured password changes, startup synchronizes it and revokes old sessions. Keep `.env` private and use a unique password.

6. A super admin can create teachers and grant/revoke student batch access. Public registration creates student accounts only. Legacy teacher provisioning is restricted to existing teacher accounts and must not be used to provision admins.

   The API listens on port 4000 by default.

Run the HTTP-level API tests with `npm test`. They use a mocked Prisma client and do not require a running PostgreSQL server.

## Deploy to Render

This repository includes [`render.yaml`](./render.yaml) for a Render free-tier web service. The Blueprint intentionally does not create a PostgreSQL instance, to avoid silently provisioning a paid database. Provide a PostgreSQL `DATABASE_URL` from a provider you choose (for example, Render Postgres or another managed PostgreSQL service); verify that provider's current pricing and retention policy before creating a database.

1. Push this project to a GitHub repository and select it in Render's **New + → Blueprint** flow.
2. Before the first deploy, create/provision PostgreSQL and set the service's `DATABASE_URL` in Render. `render.yaml` marks database and SMTP settings as manually supplied secrets.
3. Set `CORS_ORIGIN` to the exact browser frontend origin and `FRONTEND_URL` to the public origin that hosts the password-reset page. Keep both values HTTPS in production.
4. Set the SMTP host, username, password, and sender in the Render service environment. Password recovery returns a service error until SMTP is configured.
5. Set `SUPER_ADMIN_EMAIL` and a unique `SUPER_ADMIN_PASSWORD` in the Render service environment. Render generates `JWT_SECRET`; the build runs the checked-in Prisma migrations and compiles the API. The startup bootstrap creates the super admin, preserves it on subsequent starts when the configured password is unchanged, and synchronizes a changed password while revoking existing sessions.
6. Replace `YOUR-RENDER-SERVICE` in the imported Postman production environment with the service hostname Render assigns. Set account credentials as Postman secret variables, then run the login requests.

The Render free web service may sleep when idle and is intended for evaluation, not guaranteed production availability. The service cannot become publicly reachable until the GitHub repository, Render service, database URL, and required provider configuration are supplied through your accounts.

## Deploy to Vercel

This repository also includes [`vercel.json`](./vercel.json) and an Express function entrypoint at [`api/index.ts`](./api/index.ts). Import the GitHub repository into Vercel and set the required environment variables in **Project Settings → Environment Variables** before deploying. The build generates Prisma Client and compiles the TypeScript server. Production builds also apply checked-in migrations and bootstrap the super-admin account; Preview builds skip those database changes.

Set `DATABASE_URL` to a reachable PostgreSQL connection string; `JWT_SECRET` to a random secret of at least 32 characters; `SUPER_ADMIN_EMAIL` and a unique `SUPER_ADMIN_PASSWORD` (12–128 characters); and `CORS_ORIGIN` to the exact frontend origin. Also configure `SUPER_ADMIN_NAME`, `JWT_EXPIRES_IN_SECONDS`, `FRONTEND_URL`, and the SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`) for password-reset emails. Never add these values to source control. Set them separately for Production and Preview if both environments need access.

After deployment, verify the public `/health` endpoint. Use a managed PostgreSQL provider that allows connections from Vercel; the deployment build needs database access to apply migrations and bootstrap the admin. Vercel runs the API as serverless functions, so the local `npm start` listener is not used.

## Postman

Import [`postman/LMS-Backend.postman_collection.json`](./postman/LMS-Backend.postman_collection.json) and use the collection variables (select **No environment** in Postman). Set `email` and `password`, then send the single **Login** request; the token is saved automatically. All API routes are grouped in the collection, with each route included once and protected routes using the saved token. For a deployed API, update `baseUrl` and `serverUrl` in the collection variables.

## API overview

All API routes use the `/api` prefix. Authenticated routes require `Authorization: Bearer <token>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a student |
| POST | `/auth/login` | Public | Login and receive a short-lived JWT |
| POST | `/auth/logout` | Authenticated | Revoke all current account JWTs |
| GET | `/auth/me` | Authenticated | Get current account |
| POST | `/auth/forgot-password` | Public | Email a 10-minute password reset OTP |
| POST | `/auth/reset-password` | Public | Verify email + OTP and set a new password |
| POST | `/admin/teachers` | Super admin | Create a teacher account |
| GET, POST | `/courses` | Authenticated / teacher | List accessible courses or create a course |
| POST | `/courses/:courseId/batches` | Teacher | Create a batch |
| POST | `/batches/:batchId/enrollments` | Super admin | Grant a student access to a batch |
| DELETE | `/batches/:batchId/enrollments/:studentId` | Super admin | Revoke a student's batch access |
| GET | `/batches/:batchId/folders` | Enrolled student / owning teacher | List batch folders and contents |
| POST | `/folders` | Teacher | Create a batch folder or subfolder |
| POST | `/content` | Teacher | Add video, live link, or document content |
| GET | `/content/:contentId` | Enrolled student / owning teacher | Get content metadata |
| POST | `/homework` | Teacher | Create an assignment |
| GET | `/batches/:batchId/homework` | Enrolled student / owning teacher | List assignments and permitted submissions |
| POST | `/homework/:homeworkId/submissions` | Enrolled student | Submit or update homework |
| PATCH | `/submissions/:submissionId/grade` | Owning teacher | Grade a submission |
| POST | `/progress/heartbeat` | Enrolled student | Record a video heartbeat (0–15 seconds) |
| GET | `/progress/me` | Student | Get per-batch and per-course video completion percentages |
| GET | `/progress/batches/:batchId` | Owning teacher | Inspect student progress |
| GET | `/progress/batches/:batchId/students/:studentId` | Owning teacher | Inspect an enrolled student's progress and watch logs |
| GET | `/health` | Public | Health check |

## Important deployment notes

- Student access is checked against batch enrollment on the server; only a super admin can grant or revoke enrollment. Teacher access is scoped to courses they own.
- Progress percentages count completed videos over available videos; documents and live links are not included in the video completion denominator.
- Passwords are stored as bcrypt hashes. Keep `.env` private and rotate production JWT secrets.
- Logout and password reset revoke all existing JWTs for that account. Reset OTPs are stored as HMAC hashes, are single-use, expire after 10 minutes, and are locked after 5 failed attempts.
- Student content responses do not expose the stored video source URL. Configure a DRM provider and add its playback-token integration before enabling student playback; disabling browser controls alone cannot prevent recording.
- Submission records currently accept a file URL. In production, connect this to private object storage with short-lived upload/download URLs, file type/size validation, and malware scanning.
- Live-session visibility is batch-scoped through content access. Real-time push notifications require a separately configured delivery service.
