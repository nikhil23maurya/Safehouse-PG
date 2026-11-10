import {heading,notice,button,esc,card,badge} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";
import {money} from "../domain/finance.js";
import {requestId} from "../platform/client.js";

export async function directRentScreen(ctx) {
  const id=ctx.params.invoiceId || ctx.params.id;
  if(!id)throw new Error("Open a rent invoice first.");
  const data=await ctx.api(`/api/platform/rent/invoices/${encodeURIComponent(id)}`);
  const claim=data.claim,confirmed=claim?.status==="OWNER_CONFIRMED";
  const canPay=data.canPrepare || data.payable;
  let opening=false,opened=false;
  const qr=data.intent?ctx.native.call("directRentQrImageUrl",data.intent):"";
  const status=(message)=>{const el=document.querySelector('[data-direct-upi-status]');if(el)el.textContent=message;};
  const prepare=async()=>{
    const fresh=await ctx.api(`/api/platform/rent/invoices/${encodeURIComponent(id)}`,{method:"POST",body:{key:requestId()}});
    if(!fresh.payable||!fresh.intent)throw new Error(fresh.issue||"This request is not payable. Refresh its status.");
    return fresh;
  };
  return {title:"Pay your owner",back:true,nav:false,
    content:heading("RENT PAYMENT","Pay your PG owner.","Approve payment securely in your UPI app. Your owner confirms the bank credit.")+
      card(`<h2>${money(data.remainingPaise)}</h2>${claim?`<dl><dt>Payee supplied by owner</dt><dd>${esc(claim.payeeName)}</dd><dt>UPI address</dt><dd>${esc(claim.payeeAddress)}</dd><dt>Payment reference</dt><dd>${esc(claim.reference)}</dd></dl>${badge(confirmed?"OWNER CONFIRMED":"OWNER CONFIRMATION REQUIRED")}`:""}`)+
      (data.issue?notice(data.issue):!data.ownerConfigured&&!data.settled?notice("Your owner has not set up rent collection yet. Ask your owner to add their rent-receiving UPI address."):"")+
      (data.settled?notice(confirmed?"Your owner confirmed this rent payment.":"This invoice has no outstanding balance."):notice("Check the payee and amount in your UPI app. Returning here does not mark rent paid. If money was debited, do not pay again."))+
      (canPay?button("Pay with UPI app",{action:"directUpi",kind:"primary block"}):"")+
      `<p data-direct-upi-status role="status" aria-live="polite"></p>`+
      (canPay?button("Pay from another phone · show QR",{action:"directQr",kind:"text-button block"}):"")+
      `<section data-direct-qr ${ctx.params.qr&&qr?"":"hidden"}>${qr?`<img src="${esc(qr)}" alt="Rent QR for your owner's UPI address" style="display:block;width:min(100%,280px);aspect-ratio:1;margin:16px auto;background:white"><p class="subtitle">Owner UPI transfer · bank confirmation required</p>${button("Save QR",{action:"saveDirectQr",kind:"secondary block"})}`:""}</section>`+
      (claim&&!confirmed?`<form data-form="directReference" novalidate><div class="form-error" role="alert"></div>${field("reference","Bank transaction reference",{required:true,value:claim.bankReference||"",help:"After paying, copy the bank UTR/reference. Never enter a UPI PIN.",attrs:'minlength="6" maxlength="40" autocomplete="off"'})}${button("Submit for owner review",{type:"submit",kind:"secondary block"})}</form>`:"")+
      button("Refresh payment status",{action:"refreshDirect",kind:"secondary block"})+
      (data.settled?button("View rent history",{route:"history",kind:"secondary block"}):""),
    directUpiResult(success,message){opening=false;opened=success;status(message||(success?"UPI app opened. If money was debited, submit the bank reference below; do not pay again.":"The UPI app did not open. Retry or use the optional QR."));},
    async action(name){
      if(name==="refreshDirect")return ctx.reload();
      if(name==="saveDirectQr")return ctx.native.call("saveDirectRentQr",data.intent);
      if(name!=="directUpi"&&name!=="directQr")return;
      if(opening)return;
      if(opened && !(await ctx.confirm({title:"Check your bank first",message:"Continue only if the earlier UPI attempt was cancelled and no money was debited. A pending debit must be checked with your owner.",confirmLabel:"No debit — retry"})))return;
      opening=true;
      try {
        document.querySelector('[data-direct-qr]')?.setAttribute("hidden","");
        const fresh=await prepare();
        if(name==="directQr")return ctx.navigate("payment",{invoiceId:id,qr:true},{replace:true,force:true});
        if(!ctx.native.has("openDirectOwnerUpi"))throw new Error("Open PGOne on your Android phone to pay with a UPI app.");
        if(!claim)await ctx.reload();
        ctx.native.call("openDirectOwnerUpi",fresh.intent);
      } catch(error) {opening=false;throw error;}
    },
    async submit(_name,form){await ctx.api(`/api/platform/rent/claims/${claim.id}/reference`,{method:"POST",body:{reference:formValues(form).reference.trim()}});
      ctx.markSaved();ctx.toast("Reference submitted. Your owner must verify the bank credit.");await ctx.reload();},
  };
}
export async function ownerDirectRentScreen(ctx) {
  const data=await ctx.api("/api/platform/rent/owner");
  return {title:"Direct rent payments",back:true,nav:false,
    content:heading("OWNER BANK PAYMENTS","Your payment details.","Use your own genuine UPI address. This is separate from the PGOne monthly fee and Razorpay settlement approval.")+
      `<form data-form="ownerUpi" novalidate><div class="form-error" role="alert"></div>${field("upiAddress","Your UPI address",{required:true,value:data.payee?.upiAddress||"",attrs:'maxlength="192" autocapitalize="none" spellcheck="false"'})}${field("payeeName","Payee name",{required:true,value:data.payee?.payeeName||ctx.snapshot.user.fullName,attrs:'minlength="2" maxlength="100"'})}${field("password","Confirm your PGOne password",{type:"password",required:true,attrs:'autocomplete="current-password" maxlength="128"'})}<label class="merchant-consent"><input name="accepted" type="checkbox" required>I confirm this is my rent-receiving account. I will verify payments in my bank before recording them.</label>${button("Save payment details",{type:"submit",kind:"primary block"})}</form>`+
      notice("Review every bank credit. First record the received bank transfer through Rent Dues, then link its PGOne payment reference below. Linking a receipt never credits rent again.")+
      data.claims.map(c=>card(`<strong>${money(c.amountPaise)}</strong><p>${esc(c.reference)}</p><p>Bank reference: ${esc(c.bankReference||"Not submitted")}</p>${badge(c.status)}${c.status==="PENDING_OWNER_CONFIRMATION"&&c.bankReference?`<form data-form="confirmDirect" data-id="${esc(c.id)}" novalidate><div class="form-error" role="alert"></div>${field("paymentId","Recorded receipt number",{required:true,help:"Use the matching bank-transfer receipt number from payment history."})}<label><input name="bankChecked" type="checkbox" required>I checked my bank and this receipt is the same transfer.</label>${button("Link verified bank receipt",{type:"submit",kind:"secondary block"})}</form>`:""}`)).join("")+button("Record rent received",{route:"dues",kind:"secondary block"}),
    async submit(name,form){const v=formValues(form);if(name==="ownerUpi")await ctx.api("/api/platform/rent/owner",{method:"POST",body:{upiAddress:v.upiAddress,payeeName:v.payeeName,password:v.password,accepted:v.accepted==="on",enabled:true}});
      if(name==="confirmDirect")await ctx.api(`/api/platform/rent/claims/${form.dataset.id}/confirm`,{method:"POST",body:{paymentId:v.paymentId,bankChecked:v.bankChecked==="on"}});
      ctx.markSaved();ctx.toast("Saved.");await ctx.reload();},
  };
}
