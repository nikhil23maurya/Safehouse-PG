import crypto from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "./errors.js";
import { config } from "./config.js";

const scryptAsync = promisify(crypto.scrypt);

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, saltText, hashText] = stored.split("$");
  if (algo !== "scrypt" || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

type TokenType = "access" | "refresh";
type TokenPayload = {
  sub: string;
  role: "OWNER" | "STUDENT";
  ver: number;
  typ: TokenType;
  iat: number;
  exp: number;
};

function b64(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function secretFor(type: TokenType) {
  return type === "access" ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET;
}

export function signToken(input: Omit<TokenPayload, "iat" | "exp">, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ ...input, iat: now, exp: now + ttlSeconds }));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secretFor(input.typ)).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyToken(token: string, expectedType: TokenType): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppError(401, "INVALID_TOKEN", "Invalid token");
  const [header, payload, signature] = parts as [string, string, string];
  const data = `${header}.${payload}`;
  const expected = crypto.createHmac("sha256", secretFor(expectedType)).update(data).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new AppError(401, "INVALID_TOKEN", "Invalid token");
  }
  let decoded: TokenPayload;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Invalid token");
  }
  const now = Math.floor(Date.now() / 1000);
  if (decoded.typ !== expectedType || !decoded.sub || !decoded.role || decoded.exp <= now) {
    throw new AppError(401, "TOKEN_EXPIRED", "Token expired or invalid");
  }
  return decoded;
}

export function createTokenPair(user: { id: string; role: "OWNER" | "STUDENT"; tokenVersion: number }) {
  return {
    accessToken: signToken({ sub: user.id, role: user.role, ver: user.tokenVersion, typ: "access" }, config.ACCESS_TOKEN_TTL_SECONDS),
    refreshToken: signToken({ sub: user.id, role: user.role, ver: user.tokenVersion, typ: "refresh" }, config.REFRESH_TOKEN_TTL_SECONDS),
    accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresIn: config.REFRESH_TOKEN_TTL_SECONDS
  };
}

export function verifyRazorpayCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  if (!config.RAZORPAY_KEY_SECRET) throw new AppError(503, "PAYMENTS_NOT_CONFIGURED", "Razorpay is not configured");
  const expected = crypto.createHmac("sha256", config.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string) {
  if (!config.RAZORPAY_WEBHOOK_SECRET) throw new AppError(503, "WEBHOOK_NOT_CONFIGURED", "Razorpay webhook is not configured");
  const expected = crypto.createHmac("sha256", config.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
