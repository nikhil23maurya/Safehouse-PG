import crypto from "node:crypto";

export const JOIN_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function normalizeJoinCode(value:string) {
  const code=value.toUpperCase().replace(/[\s-]/g,"");
  return /^[A-HJ-NP-Z2-9]{12}$/.test(code)?code:null;
}
export const newJoinCode=()=>[...crypto.randomBytes(12)].map(b=>JOIN_ALPHABET[b&31]).join("");
export const formatJoinCode=(code:string)=>code.match(/.{1,4}/g)!.join("-");
export const joinCodeHash=(code:string)=>crypto.createHash("sha256").update("PGONE_JOIN_V1:"+code).digest("hex");
const key=(secret:string)=>Buffer.from(crypto.hkdfSync("sha256",secret,"PGOne","property-join-code:v1",32));
export function encryptJoinCode(code:string,secret:string) {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(secret),iv);
  const body=Buffer.concat([cipher.update(code,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),body.toString("base64url")].join(".");
}
export function decryptJoinCode(value:string,secret:string) {
  const [version,iv,tag,body,extra]=value.split(".");
  if(version!=="v1"||!iv||!tag||!body||extra)throw new Error("Join code unavailable; rotate the property code.");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key(secret),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  const code=Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8");
  if(normalizeJoinCode(code)!==code)throw new Error("Join code unavailable; rotate the property code.");
  return code;
}
