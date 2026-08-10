import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "./generated/prisma/enums.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { verifyToken } from "./security.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new AppError(401, "AUTH_REQUIRED", "Authentication required");
    const token = header.slice(7);
    const payload = verifyToken(token, "access");
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, fullName: true, role: true, status: true, tokenVersion: true }
    });
    if (!user || user.status !== "ACTIVE" || user.tokenVersion !== payload.ver || user.role !== payload.role) {
      throw new AppError(401, "SESSION_INVALID", "Session is no longer valid");
    }
    req.authUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tokenVersion: user.tokenVersion
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(role: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser) return next(new AppError(401, "AUTH_REQUIRED", "Authentication required"));
    if (req.authUser.role !== role) return next(new AppError(403, "FORBIDDEN", "You do not have access to this resource"));
    next();
  };
}
