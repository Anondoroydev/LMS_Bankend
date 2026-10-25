import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { prisma } from "../config/database.js";
import { HttpError } from "./errors.js";

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; role: UserRole; tokenVersion: number };
}

export async function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return next(new HttpError(401, "Authentication required"));

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");
    const payload = jwt.verify(token, secret);
    if (
      typeof payload === "string"
      || !payload.sub
      || !payload.role
      || typeof payload.tokenVersion !== "number"
    ) {
      throw new HttpError(401, "Invalid authentication token");
    }
    if (
      payload.role !== UserRole.SUPER_ADMIN
      && payload.role !== UserRole.TEACHER
      && payload.role !== UserRole.STUDENT
    ) {
      throw new HttpError(401, "Invalid authentication token");
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new HttpError(401, "Invalid or revoked authentication token");
    }
    req.auth = {
      userId: payload.sub,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    next();
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return next(new HttpError(401, "Invalid or expired authentication token"));
    }
    return next(error);
  }
}

export function requireRole(role: UserRole) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, "Authentication required"));
    if (req.auth.role !== role) return next(new HttpError(403, "Insufficient permissions"));
    next();
  };
}

export function authenticatedUser(req: AuthenticatedRequest) {
  if (!req.auth) throw new HttpError(401, "Authentication required");
  return req.auth;
}
