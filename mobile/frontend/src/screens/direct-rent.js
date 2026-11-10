import {heading,notice,button,esc,card,badge} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";
import {money} from "../domain/finance.js";
import {requestId} from "../platform/client.js";

export async function directRentScreen(ctx) {
  const id=ctx.params.invoiceId || ctx.params.id;
  if(!id)throw new Error("Open a rent invoice first.");
  const data=await ctx.api(`/api/platform/rent/invoices/${encodeURIComponent(id)}`,{method:"POST",body:{key:requestId()}});
  const claim=data.claim,confirmed=claim.status==="OWNER_CONFIRMED";
  let opened=false;
  return {title:"Pay your owner",back:true,nav:false,
    content:heading("DIRECT OWNER PAYMENT","Your rent. Your owner's account.","This is a direct bank transfer. PGOne does not verify it through Razorpay.")+
      card(`<h2>${money(claim.amountPaise)}</h2><dl><dt>Payee supplied by owner</dt><dd>${esc(claim.payeeName)}</dd><dt>UPI address</dt><dd>${esc(claim.payeeAddress)}</dd><dt>PGOne reference</dt><dd>${esc(claim.reference)}</dd></dl>${badge(confirmed?"OWNER CONFIRMED":"PENDING OWNER CONFIRMATION")}`)+
      notice("Check the payee shown inside your UPI app before approving. Returning to PGOne or submitting a bank reference does not mark rent paid. If you already transferred rent, do not pay again.")+
      (!confirmed&&!claim.bankReference?button("Open UPI app",{action:"directUpi",kind:"primary block"}):"")+
      (!confirmed?`<form data-form="directReference" novalidate><div class="form-error" role="alert"></div>${field("reference","Bank transaction reference",{required:true,value:claim.bankReference||"",help:"Copy the UTR/reference from your bank. Never enter a UPI PIN.",attrs:'minlength="6" maxlength="40" autocomplete="off"'})}${button("Submit for owner review",{type:"submit",kind:"secondary block"})}</form>`:button("View rent history",{route:"history",kind:"primary block"})),
    async action(name){if(name!=="directUpi")return;if(opened)throw new Error("Check your bank before making another transfer.");
      if(!ctx.native.has("openDirectOwnerUpi"))throw new Error("Open PGOne on your Android phone, or use the owner's UPI address in your payment app.");
      opened=true;ctx.native.call("openDirectOwnerUpi",data.intent);},
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
