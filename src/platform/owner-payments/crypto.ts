import crypto from "node:crypto";
import {assert,AppError} from "../../errors.js";
import {ownerPaymentConfig} from "./config.js";

export const digest=(value:string|Buffer)=>crypto.createHash("sha256").update(value).digest("hex");
function key(){const k=ownerPaymentConfig().RAZORPAY_OWNER_TOKEN_KEY;assert(k,503,"OWNER_TOKEN_KEY_MISSING","Payment account storage is unavailable.");return Buffer.from(k,"hex");}
export function seal(value:string,context:string) {
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);cipher.setAAD(Buffer.from(`pgone-owner-v1:${context}`));
 const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
}
export function unseal(value:string,context:string) {
 const [v,iv,tag,body,extra]=value.split(".");assert(v==="v1"&&iv&&tag&&body&&!extra,503,"OWNER_TOKEN_UNAVAILABLE","Reconnect your payment account.");
 try{const cipher=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));cipher.setAAD(Buffer.from(`pgone-owner-v1:${context}`));cipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([cipher.update(Buffer.from(body,"base64url")),cipher.final()]).toString("utf8");}
 catch{throw new AppError(503,"OWNER_RECONNECT_REQUIRED","Payment account credentials could not be authenticated. Reconnect the account.");}
}
export function signed(body:Buffer,signature:string|undefined,secret:string) {
 if(!/^[a-fA-F0-9]{64}$/.test(signature||""))return false;
 const expected=crypto.createHmac("sha256",secret).update(body).digest();return crypto.timingSafeEqual(expected,Buffer.from(signature!,"hex"));
}
export const bankFingerprint=(account:string,ifsc:string)=>crypto.createHmac("sha256",key()).update(`owner-bank-v1:${ifsc}:${account}`).digest("hex");
