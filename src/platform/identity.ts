// Historical Firebase IDs are retained for recovery evidence, never login.
import { AppError } from "../errors.js";
export const phoneConfig = (_packageId:string) => null;
export async function verifyPhoneIdentity(_token:string):Promise<never> {
  throw new AppError(410,"PHONE_AUTH_RETIRED","Use email and password to sign in.");
}
