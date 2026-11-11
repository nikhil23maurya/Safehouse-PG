import {planCheckout} from "../payments/plan.js";
import {money} from "../domain/finance.js";
import {organisation} from "../platform/client.js";
import {brand} from "../components/brand.js";
import {dots,successMark} from "../components/motion.js";
import {button,esc,date,card} from "../components/ui.js";

export const verificationMarkup=()=>`<main class="verification-page"><header>${button("Go back",{action:"back",kind:"royal-back",glyph:"back"})}${brand()}</header><div class="verification-center">${dots("Verifying payment")}<h1>Verifying your payment</h1><p>We're confirming your payment securely.<br>Please don't pay again.</p><div data-verification-result aria-live="polite"></div></div></main>`;
export function planVerificationScreen(ctx){
 const org=organisation(ctx.snapshot),order=planCheckout.orderId;
 let disposed=false,checking=false;
 const current=()=>!disposed&&org?.id===planCheckout.organisationId&&order===planCheckout.orderId;
 async function check(){
   if(!org||!order){showPending("Open your plan to check the current payment request.");return;}
   if(checking||!current())return;
   checking=true;
   const result=document.querySelector("[data-verification-result]");if(result)result.innerHTML="";
   document.querySelector(".verification-center > .loading-dots")?.removeAttribute("hidden");
   try{
     if(!org||!order)throw new Error("Open your plan to check the current payment request.");
     await ctx.api(`/api/platform/organisations/${org.id}/subscription/recheck`,{method:"POST"});
     const state=await ctx.api(`/api/platform/organisations/${org.id}/plan/orders/${encodeURIComponent(order)}/state`);
     if(!current())return;
     planCheckout.checkedOrder=order;planCheckout.busy=false;
     if(state.captured&&state.receipt){planCheckout.receipt=state.receipt;planCheckout.busy=false;await ctx.refreshPlatform();if(current())await ctx.navigate("planSuccess",{},{replace:true,force:true});return;}
     showPending(state.status==="FAILED"?"Payment was not confirmed. Check your bank before retrying.":"Confirmation is still pending. If money was debited, please don't pay again.");
   }catch(error){if(current())showPending(error.message||"Unable to check payment. Your payment status has not been confirmed.");}
   finally{checking=false;}
 }
 function showPending(message){
   document.querySelector(".verification-center > .loading-dots")?.setAttribute("hidden","");
   const result=document.querySelector("[data-verification-result]");if(!result)return;
   result.innerHTML=`<div class="verification-pending"><h2>Payment not confirmed yet</h2><p>${esc(message)}</p>${button("Check again",{action:"checkPlan",kind:"primary block"})}${button("Back to my plan",{route:"subscription",kind:"secondary block"})}</div>`;
 }
 return {bare:true,title:"Verifying payment",content:verificationMarkup(),mount(){void check();},unmount(){disposed=true;},onPlanResult:check,action(name){if(name==="checkPlan")return check();}};
}
export async function planSuccessScreen(ctx){
 const org=organisation(ctx.snapshot),order=planCheckout.orderId;
 if(!org||!order)return planVerificationScreen(ctx);
 const data=await ctx.api(`/api/platform/organisations/${org.id}/plan/orders/${encodeURIComponent(order)}/state`);
 if(!data.captured||!data.receipt)return planVerificationScreen(ctx);
 const r=data.receipt;
 return {bare:true,title:"Payment successful",content:`<main class="plan-success-page"><header>${button("Go back",{action:"back",kind:"royal-back",glyph:"back"})}${brand()}</header><div class="success-center">${successMark("Payment verified")}<h1>Payment successful</h1><p>${data.entitled===false?"Payment verified. Review your current plan.":"Your PGOne plan is active."}</p>${card(`<div class="receipt-heading"><h2>Receipt</h2><span>${money(r.amountPaise)}</span></div><dl><div><dt>Reference</dt><dd>${esc(r.number)}</dd></div><div><dt>Paid on</dt><dd>${esc(date(r.paidAt))}</dd></div><div><dt>Access until</dt><dd>${esc(date(r.periodEnd))}</dd></div></dl>`)}${button("Continue",{action:"continuePlan",kind:"primary block",glyph:"arrow"})}${button("Download receipt",{action:"successReceipt",kind:"text-button block"})}</div></main>`,async action(name){if(name==="successReceipt")return ctx.downloadAccountReceipt(`/api/platform/organisations/${org.id}/plan/receipts/${r.id}.pdf`,r.number);if(name==="continuePlan"){ctx.native.call("acknowledgePlanPayment",order);planCheckout.clear();return ctx.navigate("pgCode",{},{replace:true,force:true});}}};
}
