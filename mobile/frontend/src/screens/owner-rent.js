import {money} from "../domain/finance.js";
import {heading,card,button,badge,date,esc} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";
import {platformConfig,requestId} from "../platform/client.js";
import {paymentContact} from "../payments/plan.js";
import {rentCheckout} from "../payments/rent.js";
import {directRentScreen} from "./direct-rent.js";
import {paymentScreen} from "./payment.js";

export async function rentPaymentEntry(ctx){
 if(ctx.snapshot.tokens?.kind!=="PLATFORM")return paymentScreen(ctx);
 const member=ctx.snapshot.platform?.memberships?.find(m=>m.id===ctx.snapshot.platform.membershipId);
 const cfg=await platformConfig(ctx,{force:true});
 if(cfg.ownerRent?.enabled)return ownerRentScreen(ctx);
 return member?.organisation?.legacyAccess?paymentScreen(ctx):directRentScreen(ctx);
}
export async function ownerRentScreen(ctx){
 const id=ctx.snapshot.route.params.invoiceId||rentCheckout.invoiceId;if(!id)throw new Error("Choose your rent invoice first.");
 const data=await ctx.api(`/api/platform/owner-payments/invoices/${encodeURIComponent(id)}`),i=data.invoice,order=data.order;
 const pending=order?.open&&!['CREATED','FAILED'].includes(order.status),paid=i.remainingPaise===0;
 return {title:"Pay rent",back:true,nav:false,content:heading("",i.pgName,"Your monthly rent")+
  card(`<div class="rent-invoice-summary"><span>Billing month</span><strong>${String(i.month).padStart(2,"0")} / ${i.year}</strong><span>Due date</span><strong>${esc(date(i.dueDate))}</strong><span>Outstanding</span><strong>${money(i.remainingPaise)}</strong></div>`)+
  (paid?card(`${badge("No pending rent","green")}<p>This invoice has no outstanding balance.</p>`):!data.available?card(`<p>${esc(data.requiredAction||"Your owner must finish merchant verification.")}</p>`):pending?card(`<h2>Check your existing payment</h2><p>Confirmation is pending. Please don't pay again.</p>${button("Check payment status",{action:"checkOwnerRent",kind:"primary block"})}`):
   `<form data-form="payOwnerRent" novalidate><div class="form-error" role="alert"></div>${field("contact","Mobile number for payment",{required:true,value:ctx.snapshot.platform?.account?.contactPhone||"",attrs:'type="tel" inputmode="tel" autocomplete="tel" maxlength="16"'})}${button(order?.status==="FAILED"?"Retry UPI payment":"Pay rent with UPI",{type:"submit",kind:"primary block",glyph:"arrow"})}</form><p class="legal-copy">Razorpay processes this payment for your PG owner.</p>`)+
  (!paid&&!order?.open?`<details class="disclosure"><summary>Other payment arrangement</summary><p>Direct UPI transfers require your owner's bank confirmation.</p>${button("Direct owner UPI",{route:"directOwnerPayment",params:{invoiceId:id},kind:"secondary block"})}</details>`:"")+
  button("View payment history",{route:"history",kind:"text-button block"}),
  async action(name){if(name==="checkOwnerRent"){rentCheckout.invoiceId=id;rentCheckout.orderId=order.id;rentCheckout.providerOrderId=order.providerOrderId;rentCheckout.membershipId=ctx.snapshot.platform.membershipId;return ctx.navigate("rentVerification",{},{replace:true,force:true});}},
  async submit(name,form){
   if(name!=="payOwnerRent")return;const contact=paymentContact(formValues(form).contact);if(!contact)throw new Error("Enter a valid mobile number for payment.");
   if(!ctx.native.has("openOwnerRentUpi"))throw new Error("Open the latest PGOne Android app to pay with UPI.");
   const result=await ctx.api(`/api/platform/owner-payments/invoices/${encodeURIComponent(id)}/orders`,{method:"POST",body:{requestKey:requestId()}});
   const session=await ctx.api(`/api/platform/owner-payments/invoices/${encodeURIComponent(id)}/orders/${encodeURIComponent(result.orderId)}/checkout`,{method:"POST"});
   if(session.invoiceId!==id||!/^order_[A-Za-z0-9]+$/.test(session.providerOrderId||"")||!/^rzp_(test|live)_oauth_[A-Za-z0-9]+$/.test(session.publicToken||"")||!Number.isInteger(session.amountPaise)||session.amountPaise<100||session.currency!=="INR")throw new Error("The payment session did not match your rent invoice.");
   rentCheckout.begin(session,ctx.snapshot.platform.membershipId);ctx.markSaved();
   ctx.native.call("openOwnerRentUpi",JSON.stringify({key:session.publicToken,order_id:session.providerOrderId,amount:session.amountPaise,currency:"INR",invoiceId:id,rentOrderId:session.orderId,membershipId:ctx.snapshot.platform.membershipId,email:ctx.snapshot.platform.account.email,contact}));
  },
 };
}
