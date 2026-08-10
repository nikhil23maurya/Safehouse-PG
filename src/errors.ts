export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function assert(condition: unknown, statusCode: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message);
}
