import {money} from "../domain/finance.js";
import {brand} from "../components/brand.js";
import {dots,successMark} from "../components/motion.js";
import {card,button,esc,date} from "../components/ui.js";
import {rentCheckout} from "../payments/rent.js";
export const rentVerificationMarkup=()=>`<main class="verification-page"><header>${brand({dark:true})}</header><div class="verification-center">${dots("Verifying rent payment")}<h1>Verifying your payment</h1><p>We're confirming your rent payment securely.<br>Please don't pay again.</p><div data-rent-verification-result aria-live="polite"></div></div></main>`;
export function rentVerificationScreen(ctx){
 const invoice=rentCheckout.invoiceId,order=rentCheckout.orderId,member=ctx.snapshot.platform?.membershipId;let disposed=false,checking=false;
 const current=()=>!disposed&&order===rentCheckout.orderId&&invoice===rentCheckout.invoiceId&&member===rentCheckout.membershipId;
 function pending(message){document.querySelector('.verification-center > .loading-dots')?.setAttribute('hidden','');const box=document.querySelector('[data-rent-verification-result]');if(box)box.innerHTML=`<div class="verification-pending"><h2>Payment is still being verified.</h2><p>${esc(message)}</p>${button("Check again",{action:"checkRent",kind:"primary block"})}${button("View my invoices",{route:"invoices",kind:"secondary block"})}</div>`;}
 async function check(){
  if(checking||!current())return;checking=true;
  document.querySelector('.verification-center > .loading-dots')?.removeAttribute('hidden');
  try{
   if(!invoice||!order)throw new Error("Open your invoice to check its existing payment request.");
   const data=await ctx.api(`/api/platform/owner-payments/invoices/${encodeURIComponent(invoice)}/orders/${encodeURIComponent(order)}/recheck`,{method:"POST"});
   if(!current())return;
   if(data.order?.id===order&&data.order.status==="CAPTURED"&&data.receipt?.status==="CAPTURED"&&data.receipt.refundedPaise===0){return ctx.navigate("rentSuccess",{},{replace:true,force:true});}
   if(data.receipt?.refundedPaise)pending("This payment has a refund update. Review your invoice and payment history.");
   else pending(data.order?.status==="FAILED"?"This payment was not confirmed. Return to your invoice to retry the same reconciled request.":"Your payment may already be complete. Please don't pay again.");
  }catch(error){if(current())pending(error.message||"Confirmation is unavailable. Please don't pay again.");}finally{checking=false;}
 }
 return {bare:true,title:"Verifying rent payment",content:rentVerificationMarkup(),mount(){void check();},unmount(){disposed=true;},onRentResult:check,action(name){if(name==="checkRent")return check();}};
}
export async function rentSuccessScreen(ctx){
 const invoice=rentCheckout.invoiceId,order=rentCheckout.orderId;
 if(!invoice||!order||rentCheckout.membershipId!==ctx.snapshot.platform?.membershipId)return rentVerificationScreen(ctx);
 const data=await ctx.api(`/api/platform/owner-payments/invoices/${encodeURIComponent(invoice)}`);
 if(data.order?.id!==order||data.order.status!=="CAPTURED"||data.receipt?.status!=="CAPTURED"||data.receipt.refundedPaise!==0)return rentVerificationScreen(ctx);
 const receipt=data.receipt;
 return {bare:true,title:"Payment successful",content:`<main class="plan-success-page"><header>${brand()}</header><div class="success-center">${successMark("Rent payment verified")}<h1>Payment successful</h1><p>Your rent payment has been verified.</p>${card(`<div class="receipt-heading"><h2>Receipt</h2><strong>${money(receipt.amountPaise)}</strong></div><dl><div><dt>Reference</dt><dd>${esc(receipt.reference)}</dd></div><div><dt>Paid on</dt><dd>${esc(date(receipt.paidAt))}</dd></div></dl>`)}<p class="legal-copy">Bank settlement is tracked separately for your owner.</p>${button("Download receipt",{action:"rentReceipt",kind:"primary block"})}${button("Continue",{action:"continueRent",kind:"secondary block"})}</div></main>`,async action(name){if(name==="rentReceipt")return ctx.downloadAccountReceipt(`/api/receipts/${encodeURIComponent(receipt.id)}`,receipt.reference);if(name==="continueRent"){ctx.native.call("acknowledgeRentPayment",rentCheckout.providerOrderId);rentCheckout.clear();return ctx.navigate("studentHome",{},{replace:true,force:true});}}};
}
