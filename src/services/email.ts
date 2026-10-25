import nodemailer from "nodemailer";
import { HttpError } from "../middleware/errors.js";

export function assertPasswordResetEmailConfigured() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    throw new HttpError(503, "Password reset email service is not configured");
  }
  if (
    SMTP_HOST.includes("example.com")
    || SMTP_USER.startsWith("your-")
    || SMTP_PASSWORD.startsWith("your-")
    || SMTP_FROM.includes("example.com")
  ) {
    throw new HttpError(503, "Replace the example SMTP settings before using password reset");
  }

  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number");
  }
  return { SMTP_HOST, port, SMTP_USER, SMTP_PASSWORD, SMTP_FROM };
}

export async function sendPasswordResetEmail(email: string, name: string, code: string) {
  const { SMTP_HOST, port, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = assertPasswordResetEmailConfigured();
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: "Your LMS password reset code",
      text: `Hello ${name},\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes and can only be used once. You have 5 attempts. If you did not request this, you can ignore this email.`,
    });
  } finally {
    transporter.close();
  }
}
