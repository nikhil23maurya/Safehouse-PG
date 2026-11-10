import crypto from "node:crypto";
import { config } from "../config.js";
import { AppError } from "../errors.js";

type Claims = {
  sub: string;
  ver: number;
  membershipId: string | null;
  typ: "access" | "refresh";
  exp: number;
  aud: "pgone-platform-v1";
  sid?: string;
  nonce?: string;
};
export function platformPair(
  account: { id: string; tokenVersion: number },
  membershipId: string | null = null,
  session?: { id: string; nonce: string },
) {
  const issue = (typ: Claims["typ"], ttl: number) => {
    const claims: Claims = {
      sub: account.id,
      ver: account.tokenVersion,
      membershipId,
      typ,
      exp: Math.floor(Date.now() / 1000) + ttl,
      aud: "pgone-platform-v1",
      ...(session ? { sid: session.id, ...(typ === "refresh" ? { nonce: session.nonce } : {}) } : {}),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = crypto
      .createHmac(
        "sha256",
        typ === "access" ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET,
      )
      .update(`pgone-platform-v1|${typ}|${payload}`)
      .digest("base64url");
    return `pg1.${typ}.${payload}.${signature}`;
  };
  return {
    kind: "PLATFORM",
    accessToken: issue("access", config.ACCESS_TOKEN_TTL_SECONDS),
    refreshToken: issue("refresh", config.REFRESH_TOKEN_TTL_SECONDS),
    accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  };
}
export function platformClaims(
  token: string,
  typ: Claims["typ"] = "access",
): Claims {
  const [prefix, type, payload, signature, extra] = token.split(".");
  if (
    token.length > 8192 ||
    prefix !== "pg1" ||
    type !== typ ||
    !payload ||
    !signature ||
    extra !== undefined
  )
    throw new AppError(401, "INVALID_TOKEN", "Sign in again to continue.");
  const expected = crypto
    .createHmac(
      "sha256",
      typ === "access" ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET,
    )
    .update(`pgone-platform-v1|${typ}|${payload}`)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  )
    throw new AppError(401, "INVALID_TOKEN", "Sign in again to continue.");
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Sign in again to continue.");
  }
  if (
    claims.aud !== "pgone-platform-v1" ||
    claims.typ !== typ ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    !Number.isSafeInteger(claims.ver) ||
    claims.ver < 0 ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= Date.now() / 1000 ||
    (claims.membershipId !== null &&
      (typeof claims.membershipId !== "string" || !claims.membershipId))
  )
    throw new AppError(401, "TOKEN_EXPIRED", "Sign in again to continue.");
  return claims;
}
export const hash = (value: string | Buffer) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const randomCode = () => crypto.randomBytes(32).toString("base64url");
