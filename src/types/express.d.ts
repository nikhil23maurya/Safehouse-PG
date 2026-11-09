import type { UserRole } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string | null;
        fullName: string;
        role: UserRole;
        tokenVersion: number;
      };
    }
  }
}

export {};
