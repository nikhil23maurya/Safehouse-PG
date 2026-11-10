import crypto from "node:crypto";
import { verifyPassword as verifyLegacyPassword } from "../security.js";

const scrypt = (password:string,salt:Buffer,length:number,options:crypto.ScryptOptions) =>
  new Promise<Buffer>((resolve,reject)=>crypto.scrypt(password,salt,length,options,(error,value)=>error?reject(error):resolve(value)));
// OWASP's scrypt N=2^15, r=8, p=3 profile. Parameters are stored with each hash.
export async function passwordHash(password: string) {
  const salt = crypto.randomBytes(16);
  const digest = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return `scrypt-v2$32768$8$3$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}
export async function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) return verifyLegacyPassword(password, stored);
  const [kind, n, r, p, salt, digest, extra] = stored.split("$");
  if (kind !== "scrypt-v2" || n !== "32768" || r !== "8" || p !== "3" || !salt || !digest || extra) return false;
  const expected = Buffer.from(digest, "base64url");
  if (expected.length !== 64 || Buffer.from(salt, "base64url").length !== 16) return false;
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return crypto.timingSafeEqual(expected, actual);
}
export const normalizedEmail = (email: string) => email.trim().toLowerCase();
