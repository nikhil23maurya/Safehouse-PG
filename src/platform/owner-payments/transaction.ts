import type {Prisma} from "../../generated/prisma/client.js";
import {atomic as existingAtomic} from "../service.js";

// Prisma surfaces SELECT FOR UPDATE serialization conflicts as P2010/meta.code
// on some adapter versions. Extend retries only for this new payment service;
// provider network calls must remain outside the callback.
export async function ownerAtomic<T>(action:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
 for(let attempt=0;;attempt++)try{return await existingAtomic(action);}catch(error:any){
  const code=error?.meta?.code||error?.meta?.driverAdapterError?.cause?.originalCode;
  if(attempt>=3||!["40001","40P01"].includes(code))throw error;
  await new Promise(resolve=>setTimeout(resolve,(attempt+1)*20));
 }
}
