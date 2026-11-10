import { prisma } from "../db.js";
import { config } from "../config.js";
import { AppError, assert } from "../errors.js";
import { platformPair, hash, randomCode } from "./tokens.js";
import { accountSession, atomic, audit } from "./service.js";

export async function issueSession(account: {id:string; tokenVersion:number}, membershipId: string | null = null, upgradeHash?: string) {
  const nonce = randomCode();
  const session = await atomic(async tx => {
    const current = await tx.pgAccount.findUnique({where:{id:account.id}});
    assert(current?.status === "ACTIVE" && current.tokenVersion === account.tokenVersion,401,"SESSION_INVALID","Your account changed. Sign in again.");
    return tx.pgSession.create({data: {accountId:account.id, refreshHash:hash(nonce), upgradeHash,
      expiresAt:new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000)}});
  });
  return platformPair(account, membershipId, {id:session.id, nonce});
}
export async function rotateSession(refreshToken: string) {
  const {account, membership, claims} = await accountSession(refreshToken, "refresh", true);
  // Existing authenticated installations can upgrade once. No phone login is invoked.
  if (!claims.sid) {
    assert(!account.passwordHash, 401, "SESSION_INVALID", "Sign in with your email and password.");
    try { return await issueSession(account, membership?.id || null, hash(refreshToken)); }
    catch (error:any) {
      if (error.code !== "P2002") throw error;
      throw new AppError(401,"SESSION_REPLAY","This session was already refreshed. Sign in again.");
    }
  }
  const nonce = randomCode();
  const rotated = await atomic(async tx => {
    const changed = await tx.pgSession.updateMany({where:{id:claims.sid, accountId:account.id, revokedAt:null,
      expiresAt:{gt:new Date()}, refreshHash:hash(claims.nonce || "")},data:{refreshHash:hash(nonce)}});
    if (changed.count === 1) return true;
    await tx.pgSession.updateMany({where:{id:claims.sid, accountId:account.id},data:{revokedAt:new Date()}});
    await audit(tx,account.id,null,"SESSION_REPLAY_REVOKED",claims.sid!);
    return false;
  });
  assert(rotated,401,"SESSION_REPLAY","This session was already refreshed. Sign in again.");
  return platformPair(account,membership?.id || null,{id:claims.sid,nonce});
}
