import {AppError,assert} from "../../errors.js";
import {ownerPaymentConfig} from "./config.js";

export type MerchantToken={access_token:string;refresh_token:string;public_token:string;razorpay_account_id:string;expires_in:number;token_type:string};
export interface OwnerProvider {
 exchange(code:string):Promise<MerchantToken>;
 refresh(token:string):Promise<MerchantToken>;
 revoke(token:string):Promise<void>;
 account(token:string,id:string):Promise<any>;
 product(token:string,account:string,id:string):Promise<any>;
 createOrder(token:string,input:{amount:number;receipt:string;notes:Record<string,string>}):Promise<any>;
 findOrder(token:string,reference:string,from:number):Promise<any|null>;
 order(token:string,id:string):Promise<any>;
 payments(token:string,id:string):Promise<any[]>;
 refunds(token:string,payment:string):Promise<any[]>;
 settlement(token:string,id:string):Promise<any>;
 recon(token:string,year:number,month:number,day:number):Promise<any[]>;
}
const encoded=(id:string,prefix:string)=>{assert(new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id),400,"INVALID_PROVIDER_REFERENCE","Invalid payment reference.");return encodeURIComponent(id);};
async function call(path:string,token:string|undefined,body?:unknown,auth=false) {
 let response:Response;
 try{response=await fetch((auth?"https://auth.razorpay.com":"https://api.razorpay.com")+path,{method:body===undefined?"GET":"POST",headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000),redirect:"error"});}
 catch{throw new AppError(503,"OWNER_PROVIDER_UNCERTAIN","Razorpay confirmation is unavailable. Check the existing payment before trying again.");}
 if(!response.ok)throw new AppError(response.status===401||response.status===403?503:502,response.status===401||response.status===403?"OWNER_PROVIDER_ACCESS_REQUIRED":response.status>=400&&response.status<500?"OWNER_PROVIDER_REJECTED":"OWNER_PROVIDER_REQUEST_FAILED","Razorpay could not complete this request. Reconnect or check your merchant account. No payment has been confirmed.");
 try{return await response.json() as any;}catch{throw new AppError(502,"OWNER_PROVIDER_INVALID_RESPONSE","Razorpay returned an unreadable response. Check the current status before retrying.");}
}
async function collection(path:string,token:string) {
 const items:any[]=[];
 for(let page=0;page<20;page++){
  const data=await call(path+(path.includes("?")?"&":"?")+`count=100&skip=${page*100}`,token);
  assert(Array.isArray(data.items),502,"OWNER_PROVIDER_INVALID_RESPONSE","Unable to read the payment history.");
  items.push(...data.items);if(data.items.length<100)return items;
 }
 throw new AppError(503,"OWNER_PROVIDER_HISTORY_INCOMPLETE","Payment history is still being reconciled. Do not pay again.");
}
function tokenInput(extra:Record<string,string>) {
 const c=ownerPaymentConfig();assert(c.RAZORPAY_OWNER_CLIENT_ID&&c.RAZORPAY_OWNER_CLIENT_SECRET,503,"OWNER_PROVIDER_ACCESS_REQUIRED","Merchant connection is not activated.");
 return {client_id:c.RAZORPAY_OWNER_CLIENT_ID,client_secret:c.RAZORPAY_OWNER_CLIENT_SECRET,...extra};
}
export const razorpayOwnerProvider:OwnerProvider={
 exchange:code=>call("/token",undefined,tokenInput({grant_type:"authorization_code",redirect_uri:ownerPaymentConfig().RAZORPAY_OWNER_REDIRECT_URI!,code,mode:ownerPaymentConfig().RAZORPAY_OWNER_MODE}),true),
 refresh:refresh_token=>call("/token",undefined,tokenInput({grant_type:"refresh_token",refresh_token}),true),
 async revoke(token){await call("/revoke",undefined,tokenInput({token_type_hint:"access_token",token}),true);},
 account:(token,id)=>call(`/v2/accounts/${encoded(id,"acc")}`,token),
 product:(token,account,id)=>call(`/v2/accounts/${encoded(account,"acc")}/products/${encoded(id,"acc_prd")}`,token),
 createOrder:(token,input)=>call("/v1/orders",token,{...input,currency:"INR",partial_payment:false}),
 async findOrder(token,reference,from){const list=await collection(`/v1/orders?from=${Math.floor(from)}`,token);const matches=list.filter(o=>o.receipt===reference);assert(matches.length<2,409,"OWNER_ORDER_REVIEW_REQUIRED","Razorpay returned multiple orders for this payment reference. Contact your owner before paying.");return matches[0]||null;},
 order:(token,id)=>call(`/v1/orders/${encoded(id,"order")}`,token),
 async payments(token,id){const data=await call(`/v1/orders/${encoded(id,"order")}/payments`,token);assert(Array.isArray(data.items),502,"OWNER_PROVIDER_INVALID_RESPONSE","Payment confirmation is unavailable.");return data.items;},
 refunds:(token,id)=>collection(`/v1/payments/${encoded(id,"pay")}/refunds`,token),
 settlement:(token,id)=>call(`/v1/settlements/${encoded(id,"setl")}`,token),
 recon:(token,year,month,day)=>collection(`/v1/settlements/recon/combined?year=${year}&month=${month}&day=${day}`,token),
};
export function authorizationUrl(state:string) {
 const c=ownerPaymentConfig();const url=new URL("https://auth.razorpay.com/authorize");
 url.search=new URLSearchParams({client_id:c.RAZORPAY_OWNER_CLIENT_ID!,response_type:"code",redirect_uri:c.RAZORPAY_OWNER_REDIRECT_URI!,scope:"read_write",state}).toString();
 return url.toString();
}
