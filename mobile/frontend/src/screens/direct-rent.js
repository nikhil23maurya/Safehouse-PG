import {heading,notice,button,esc,card,badge} from "../components/ui.js";
import {field,formValues} from "../components/forms.js";
import {money} from "../domain/finance.js";
import {requestId,platformConfig} from "../platform/client.js";
import {copyPaymentDetail,manualUpiInstructions} from "../payments/manual-upi.js";
import {transferList} from "./direct-transfers.js";

export async function directRentScreen(ctx) {
  const id=ctx.params.invoiceId || ctx.params.id;
  if(!id)throw new Error("Open a rent invoice first.");
  const path = `/api/platform/rent/invoices/${encodeURIComponent(id)}`;
  const data = await ctx.api(path);
  const claim=data.claim,confirmed=claim?.status==="OWNER_CONFIRMED";
  return {title:"Pay your owner",back:true,nav:false,guardForm:true,contentClass:"direct-payment",
    content:heading("","Pay your PG owner")+
      card(`<h2>${money(data.remainingPaise)}</h2>${claim?`<p class="payee">${esc(claim.payeeName)}</p><p class="payee-address">${esc(claim.payeeAddress)}</p>${badge(confirmed?"OWNER CONFIRMED":"AWAITING OWNER CONFIRMATION")}`:""}`,"payment-summary")+
      (data.issue?notice(data.issue):!data.ownerConfigured&&!data.settled?notice("Your owner has not set up rent collection yet. Ask your owner to add their rent-receiving UPI address."):"")+
      (data.settled?notice(confirmed?"Your owner confirmed this rent payment.":"This invoice has no outstanding balance."):`<p class="payment-safety">If a previous payment was debited or is pending, check your bank before retrying.</p>`)+
      (data.payable&&claim?card(manualUpiInstructions(null,ctx.native.has("openPaytm")),"transfer-card"):"")+
      (data.canPrepare?button("Get UPI details",{action:"prepareDirect",kind:"primary block"}):"")+
      (claim&&!confirmed?`<details class="disclosure" data-bank-reference ${claim.bankReference?"open":""}><summary>Already paid? Submit bank reference</summary><p>PGOne reference: ${esc(claim.reference)}</p><form data-form="directReference" novalidate><div class="form-error" role="alert"></div>${field("reference","Bank transaction reference",{required:true,value:claim.bankReference||"",help:"Copy the bank UTR after payment. Never enter a UPI PIN.",attrs:'minlength="6" maxlength="40" autocomplete="off"'})}${button("Submit for owner review",{type:"submit",kind:"secondary block"})}</form></details>`:"")+
      button("Refresh payment status",{action:"refreshDirect",kind:"text-button block"})+
      (data.settled?button("View rent history",{route:"history",kind:"secondary block"}):""),
    async action(name, element){
      if (name === "refreshDirect") return ctx.reload();
      if (name === "prepareDirect") {
        const fresh = await ctx.api(path,{method:"POST",body:{key:requestId()}});
        if (!fresh.payable) throw new Error(fresh.issue || "This request is unavailable. Refresh its status.");
        return ctx.reload();
      }
      if (name === "copyPayee" || name === "copyAmount" || name === "openPaytm") {
        const fresh = await ctx.api(path);
        if (name === "openPaytm" && !element?.isConnected) return;
        if (!fresh.payable || !fresh.claim) throw new Error(fresh.issue || "Payment status changed. Refresh before paying.");
        return copyPaymentDetail(ctx, name, fresh.claim);
      }
    },
    async submit(_name,form){await ctx.api(`/api/platform/rent/claims/${claim.id}/reference`,{method:"POST",body:{reference:formValues(form).reference.trim()}});
      ctx.markSaved();ctx.toast("Reference submitted. Your owner must verify the bank credit.");await ctx.reload();},
  };
}
export async function ownerDirectRentScreen(ctx) {
  const data=await ctx.api("/api/platform/rent/owner");
  const cfg=await platformConfig(ctx);
  const queue=cfg.directRentProof===true?await ctx.api(`/api/platform/direct-payments/owner${ctx.params.cursor?`?cursor=${encodeURIComponent(ctx.params.cursor)}`:""}`):{transfers:[],nextCursor:null};
  return {title:"Direct rent payments",back:true,nav:false,contentClass:"direct-payment",
    content:heading("","Rent collection","Residents pay directly to your UPI account.")+
      (data.payee?.enabled?card(`${badge("Details saved","green")}<p class="payee">${esc(data.payee.payeeName)}</p><p class="payee-address">${esc(data.payee.upiAddress)}</p><p class="payment-safety">Bank confirmation required for each payment.</p>`):"")+
      `${data.payee?.enabled?'<details class="disclosure"><summary>Edit UPI details</summary>':""}<form data-form="ownerUpi" novalidate><div class="form-error" role="alert"></div>${field("upiAddress","Your UPI address",{required:true,value:data.payee?.upiAddress||"",attrs:'maxlength="192" autocapitalize="none" spellcheck="false"'})}${field("payeeName","Payee name",{required:true,value:data.payee?.payeeName||ctx.snapshot.user.fullName,attrs:'minlength="2" maxlength="100"'})}${field("password","Confirm your PGOne password",{type:"password",required:true,attrs:'autocomplete="current-password" maxlength="128"'})}<label class="merchant-consent"><input name="accepted" type="checkbox" required>I confirm this is my rent-receiving account. I will verify payments in my bank before recording them.</label>${button("Save payment details",{type:"submit",kind:"primary block"})}</form>${data.payee?.enabled?"</details>":""}`+
      `<h2 class="transfer-section-title">Rent & electricity payments</h2>${transferList(queue.transfers,true)||'<p class="compact-empty">Payment proofs will appear here for bank confirmation.</p>'}${queue.nextCursor?button("More payments",{route:"ownerDirectRent",params:{cursor:queue.nextCursor},kind:"secondary block"}):""}`+
      `<details class="disclosure"><summary>Earlier bank-reference submissions</summary><p>For older references, record the bank transfer in Rent Dues and link its receipt. New screenshot submissions are reviewed above.</p>`+
      data.claims.filter(c=>c.bankReference).map(c=>card(`<strong>${money(c.amountPaise)}</strong><p>${esc(c.reference)}</p><p>Bank reference: ${esc(c.bankReference||"Not submitted")}</p>${badge(c.status)}${c.status==="PENDING_OWNER_CONFIRMATION"&&c.bankReference?`<form data-form="confirmDirect" data-id="${esc(c.id)}" novalidate><div class="form-error" role="alert"></div>${field("paymentId","Recorded receipt number",{required:true,help:"Use the matching bank-transfer receipt number from payment history."})}<label><input name="bankChecked" type="checkbox" required>I checked my bank and this receipt is the same transfer.</label>${button("Link verified bank receipt",{type:"submit",kind:"secondary block"})}</form>`:""}`)).join("")+`</details>`+button("Record rent received",{route:"dues",kind:"secondary block"}),
    async submit(name,form){const v=formValues(form);if(name==="ownerUpi"){const result=await ctx.api("/api/platform/rent/owner",{method:"POST",body:{upiAddress:v.upiAddress,payeeName:v.payeeName,password:v.password,accepted:v.accepted==="on",enabled:true}});const saved=await ctx.api("/api/platform/rent/owner");if(!saved.payee?.enabled||saved.payee.upiAddress!==result.payee?.upiAddress||saved.payee.payeeName!==result.payee?.payeeName)throw new Error("Payment details could not be confirmed. Refresh before retrying.");}
      if(name==="confirmDirect")await ctx.api(`/api/platform/rent/claims/${form.dataset.id}/confirm`,{method:"POST",body:{paymentId:v.paymentId,bankChecked:v.bankChecked==="on"}});
      ctx.markSaved();ctx.toast("Saved.");await ctx.reload();},
  };
}
