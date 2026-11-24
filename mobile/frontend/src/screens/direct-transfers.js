import {heading,card,button,badge,esc,month,notice,date} from "../components/ui.js";
import {money,parseRupees,rupeesInput} from "../domain/finance.js";
import {icon} from "../components/icons.js";
import {field,formValues} from "../components/forms.js";
import {uploadEvidence,evidenceImages} from "../components/evidence.js";
import {requestId} from "../platform/client.js";
import {copyPaymentDetail,manualUpiInstructions} from "../payments/manual-upi.js";
import {pendingDirect,saveDirect} from "../payments/direct-return.js";

const base="/api/platform/direct-payments";
const image=(id,label)=>id?`<figure class="evidence-photo"><figcaption>${esc(label)}</figcaption><img data-evidence-id="${esc(id)}" alt="${esc(label)}" hidden></figure>`:"";
const split=(t,showTotal=true)=>`<dl class="transfer-breakdown">${t.rentPaise?`<div><dt>Rent / invoice charges</dt><dd>${money(t.rentPaise)}</dd></div>`:""}${t.electricityPaise?`<div><dt>Electricity</dt><dd>${money(t.electricityPaise)}</dd></div>`:""}${showTotal?`<div class="transfer-total"><dt>Total</dt><dd>${money(t.amountPaise)}</dd></div>`:""}</dl>`;
const labels={READY:"Proof not uploaded",SUBMITTED:"Awaiting bank confirmation",REJECTED:"Correction requested",CONFIRMED:"Paid",CANCELLED:"Cancelled — no debit"};
const proofStatus = t => badge(labels[t.status], t.status === "CONFIRMED" ? "green" : t.status === "READY" ? "" : "amber");
const imageTypes = 'accept="image/jpeg,image/png,image/webp"';
const payee = t => `<div class="transfer-payee"><span class="transfer-icon">${icon("wallet")}</span><div><small>Pay directly to</small><strong>${esc(t.payeeName)}</strong><span class="payee-address">${esc(t.payeeAddress || t.upiAddress)}</span></div></div>`;
const charge = (label, glyph, amount, detail) => `<div class="charge-summary${glyph === "bolt" ? " charge-electricity" : ""}"><span class="transfer-icon">${icon(glyph)}</span><div><h2>${esc(label)}</h2><small>${esc(detail)}</small></div><strong>${esc(amount)}</strong></div>`;


export async function directPaymentScreen(ctx){
 const invoiceId=ctx.params.invoiceId||ctx.params.id;if(!invoiceId)throw new Error("Choose your billing month first.");
 const data=await ctx.api(`${base}/invoices/${encodeURIComponent(invoiceId)}`),i=data.invoice,b=data.bill;
 const open=data.transfers.filter(t=>["READY","SUBMITTED","REJECTED"].includes(t.status)),electricityPending=open.some(t=>t.electricityPaise>0);
 const rent=i.remainingPaise>0&&i.status==="DUE"&&!open.some(t=>t.rentPaise>0),electricity=b?.status==="DUE"&&!electricityPending,images=evidenceImages(ctx);
 return {title:"Rent & electricity",back:true,nav:false,guardForm:true,contentClass:"direct-payment",
 content:heading("","Rent & electricity",month(i.year,i.month))+
  card(charge("Rent","invoice",money(i.remainingPaise),i.remainingPaise?"Outstanding balance":"No rent outstanding")+
    (i.electricityIncludedPaise?`<p class="transfer-note">Includes ${money(i.electricityIncludedPaise)} electricity billed by your owner.</p>`:""),"transfer-card")+
  card(charge("Electricity","bolt",b?money(b.amountPaise):"—",b?.status==="PAID"?"Owner confirmed":b?"Meter bill saved":i.electricityIncludedPaise?"Included in rent":"Add your meter bill")+
    (b?`<details class="disclosure"><summary>View meter photo</summary>${image(b.meterEvidenceId,"Meter photo")}</details>`:"")+
    (!i.electricityIncludedPaise&&!electricityPending&&b?.status!=="PAID"?`<details class="disclosure" ${b?"":"open"}><summary>${b?"Edit electricity bill":"Add your electricity bill"}</summary><form data-form="electricityBill" novalidate><div class="form-error" role="alert"></div>${field("amount","Electricity amount (₹)",{required:true,value:b?rupeesInput(b.amountPaise):"",attrs:'inputmode="decimal" autocomplete="off"'})}${field("meter","Meter photo",{type:"file",required:true,attrs:imageTypes,help:"Choose a clear photo of your meter reading."})}${button("Save electricity bill",{type:"submit",kind:"secondary block"})}</form></details>`:""),"transfer-card")+
  (open.length?`<h2 class="transfer-section-title">In progress</h2>${open.map(t=>card(`${proofStatus(t)}${split(t)}${button(t.status==="READY"?"Continue payment":"View submitted payment",{route:"transferProof",params:{id:t.id,invoiceId},kind:"secondary block",glyph:"arrow"})}`,"transfer-card")).join("")}`:"")+
  (!data.payee?notice("Your owner needs to add their rent-receiving UPI ID first."):
    data.payee&&(rent||electricity)?card(`<h2>Make a payment</h2>${payee(data.payee)}<form data-form="chooseTransfer" novalidate><div class="form-error" role="alert"></div>${field("charges","Choose what to pay",{options:[...(rent?[["RENT",`Rent only · ${money(i.remainingPaise)}`]]:[]),...(electricity?[["ELECTRICITY",`Electricity only · ${money(b.amountPaise)}`]]:[]),...(rent&&electricity?[["BOTH",`Rent + electricity · ${money(i.remainingPaise+b.amountPaise)}`]]:[])]})}${button("Continue to payment",{type:"submit",kind:"primary block",glyph:"arrow"})}</form>`,"transfer-card"):
    "")+
  data.transfers.filter(t=>t.status==="CONFIRMED").map(t=>card(`${proofStatus(t)}${split(t)}${button("View receipt",{route:"transferProof",params:{id:t.id,invoiceId},kind:"secondary block"})}`,"transfer-card")).join(""),
 mount(){void images.mount();},unmount(){images.unmount();},
 async submit(name,form){const v=formValues(form);
  if(name==="electricityBill"){const amount=parseRupees(v.amount,{min:.01,max:100000});const saved=await uploadEvidence(ctx,form.elements.meter.files[0],"METER");await ctx.api(`${base}/invoices/${invoiceId}/electricity`,{method:"POST",body:{amountPaise:Math.round(amount*100),meterEvidenceId:saved.id}});ctx.markSaved();ctx.invalidate();return ctx.reload();}
  if(name==="chooseTransfer"){const result=await ctx.api(`${base}/invoices/${invoiceId}/transfers`,{method:"POST",body:{rent:["RENT","BOTH"].includes(v.charges),electricity:["ELECTRICITY","BOTH"].includes(v.charges),key:requestId()}});saveDirect(ctx.snapshot,ctx.native,{transferId:result.transferId,invoiceId});ctx.markSaved();return ctx.navigate("transferProof",{id:result.transferId,invoiceId});}
 }
 };
}
export async function transferProofScreen(ctx){
 const {transfer:t,invoice,issue,intent}=await ctx.api(`${base}/transfers/${encodeURIComponent(ctx.params.id)}`);
 const images=evidenceImages(ctx),proof=t.proofs[0];
 const pending=pendingDirect(ctx.snapshot,ctx.native);
 const returned=pending?.transferId===t.id&&["LAUNCHED","PROOF"].includes(pending.stage);
 const proofKey=requestId();

 function setProof() {
  saveDirect(ctx.snapshot,ctx.native,{transferId:t.id,invoiceId:t.invoiceId,stage:"PROOF"});
  const title=document.querySelector("#main h1");
  if(title)title.textContent="Attach payment proof";
  document.querySelector("[data-payment-launch]")?.setAttribute("hidden","");
  document.querySelector("[data-proof-upload]")?.removeAttribute("hidden");
  document.querySelector("[data-proof-title]")?.focus();
 }

 const pageTitle = t.status==="CONFIRMED"?"Payment confirmed":t.status==="SUBMITTED"?"Payment submitted":returned||t.status==="REJECTED"?"Attach payment proof":"Rent payment";
 const amountLabel = t.status==="READY"&&intent&&!returned?"Amount due":"Payment amount";
 return {title:"Rent payment",back:true,nav:false,guardForm:true,contentClass:"direct-payment rent-payment-review",
 content:`<section class="rent-payment-hero">
    <img src="illustration-royal-residence.webp" alt="">
    <h1>${pageTitle}</h1>
    <span class="rent-amount-label">${amountLabel}</span>
    <strong class="rent-amount">${money(t.amountPaise)}</strong>
    <div class="rent-payment-meta"><span>${icon("calendar")} ${month(invoice.year,invoice.month)}</span>${proofStatus(t)}</div>
  </section>`+
  card(`<h2>Bill details</h2>${split(t,false)}`,"transfer-card rent-bill-details")+
  (issue?notice(issue):"")+
  (t.status==="READY"?`<div data-payment-launch ${returned?"hidden":""}>
    ${intent?card(manualUpiInstructions(t,ctx.native.has("chooseUpiApp")),"transfer-card rent-upi-card"):""}
    <section class="card transfer-card rent-upload-action">
      <span class="transfer-icon">${icon("image")}</span>
      <div><h2>Already paid?</h2><p>Payment screenshot</p></div>
      ${button("Upload payment proof",{action:"attachTransferProof",kind:"primary block",glyph:"arrow"})}
    </section>
  </div>`:"")+
  (["READY","REJECTED"].includes(t.status)?`<section class="card transfer-card proof-card" data-proof-upload ${t.status==="READY"&&!returned?"hidden":""}>
    <span class="transfer-icon">${icon("image")}</span><h2 data-proof-title tabindex="-1">Attach your payment proof</h2>
    ${proof?.reason?notice(proof.reason):""}
    <form data-form="transferProof" novalidate><div class="form-error" role="alert"></div>
      ${field("proof","Payment screenshot",{type:"file",required:true,attrs:imageTypes,help:"Attach the completed payment from your UPI app."})}
      ${button("Submit payment proof",{type:"submit",kind:"primary block",glyph:"send"})}
    </form>
    ${t.status==="READY"&&intent?button("View payment instructions",{action:"showPaymentInstructions",kind:"text-button block"}):""}
  </section>`:"")+
  (t.status==="SUBMITTED"?notice("Your owner will check the bank credit before confirming payment."):"")+
  (proof?card(`<h2>Submitted evidence</h2>${proof.bankReference?`<p class="transfer-note">Bank reference: ${esc(proof.bankReference)}</p>`:""}${image(proof.evidenceId,"Payment screenshot")}`,"transfer-card"):"")+
  (t.status==="CONFIRMED"?button("Download receipt",{action:"transferReceipt",kind:"primary block",glyph:"download"}):"")+
  `<details class="disclosure rent-payment-help"><summary>${icon("shield")} Payment help</summary>
    <p>If money was debited or the transaction is pending, check its status in your UPI app before taking any further action.</p>
    ${t.status==="READY"?button("No debit — change payment selection",{action:"cancelTransfer",kind:"secondary block"}):""}
  </details>
  <div class="rent-payment-footer">
    ${button("Refresh payment status",{action:"refreshTransfer",kind:"text-button",glyph:"refresh"})}
    ${button("Rent & electricity",{action:"returnToCharges",kind:"text-button"})}
  </div>`,
 mount(){
  void images.mount();
  if(returned&&t.status==="READY")saveDirect(ctx.snapshot,ctx.native,{transferId:t.id,invoiceId:t.invoiceId,stage:"PROOF"});
  if(["CONFIRMED","SUBMITTED","CANCELLED"].includes(t.status)&&pending?.transferId===t.id)saveDirect(ctx.snapshot,ctx.native,null);
 },
 unmount(){images.unmount();},
 directReturned(){ if (t.status === "READY") setProof(); },
 async action(name, element){
  if(name==="refreshTransfer")return ctx.reload();
  if(name==="returnToCharges")return ctx.navigate("payment",{invoiceId:t.invoiceId},{replace:true});
  if(name==="attachTransferProof")return setProof();
  if(name==="showPaymentInstructions"){
   const launch=document.querySelector("[data-payment-launch]");
   launch?.removeAttribute("hidden");
   launch?.querySelector("button")?.focus();
   return;
  }
  if(name==="transferReceipt")return ctx.downloadAccountReceipt(`${base}/transfers/${t.id}/receipt.pdf`,t.receiptNumber);
  if(name==="cancelTransfer"){
   if(!await ctx.confirm({title:"No money debited?",message:"Check your bank first. Do not clear a debited or uncertain transfer.",confirmLabel:"Confirmed — no debit"}))return;
   await ctx.api(`${base}/transfers/${t.id}/cancel`,{method:"POST",body:{noDebit:true}});
   saveDirect(ctx.snapshot,ctx.native,null);
   ctx.markSaved();
   return ctx.navigate("payment",{invoiceId:t.invoiceId},{replace:true,force:true});
  }
  if (name === "copyPayee" || name === "copyAmount" || name === "chooseUpiApp") {
   const fresh = await ctx.api(`${base}/transfers/${t.id}`);
   if (name === "chooseUpiApp" && (!element?.isConnected || element.closest("[hidden]"))) return;
   if (!fresh.intent) throw new Error(fresh.issue || "Payment status changed. Refresh before paying.");
   return copyPaymentDetail(ctx, name, fresh.transfer);
  }
 },
 async submit(name,form){if(name!=="transferProof")return;const saved=await uploadEvidence(ctx,form.elements.proof.files[0],"PAYMENT");await ctx.api(`${base}/transfers/${t.id}/proof`,{method:"POST",body:{evidenceId:saved.id,key:proofKey}});ctx.markSaved();ctx.invalidate();return ctx.reload();}
 };
}
export async function ownerTransferReviewScreen(ctx){
 const {transfer:t,bill,invoice,resident}=await ctx.api(`${base}/transfers/${encodeURIComponent(ctx.params.id)}`),proof=t.proofs.find(p=>p.status==="PENDING"),images=evidenceImages(ctx);
 return {title:"Review payment",back:true,nav:false,guardForm:true,financialMutation:true,contentClass:"direct-payment",
 content:heading("",resident.name,`${resident.room?`Room ${resident.room} · `:""}${month(invoice.year,invoice.month)}`)+card(`${proofStatus(t)}${split(t)}${payee(t)}`,"transfer-card transfer-receipt")+
  (bill?card(`<h2>Electricity bill</h2><p class="transfer-note">Resident-entered amount: ${money(bill.amountPaise)}</p>${image(bill.meterEvidenceId,"Meter photo")}`):"")+
  t.proofs.map(p=>card(`<h2>Payment proof</h2>${p.bankReference?`<p>Bank reference: ${esc(p.bankReference)}</p>`:""}${badge(p.status)}${p.reason?`<p>${esc(p.reason)}</p>`:""}${image(p.evidenceId,"Payment screenshot")}`)).join("")+
  (proof?`<form class="card transfer-card" data-form="reviewTransfer" novalidate>
    <h2>Confirm bank credit</h2><div class="form-error" role="alert"></div>
    ${proof.bankReference?"":field("bankReference","Bank transaction reference",{required:true,attrs:'minlength="6" maxlength="40" autocomplete="off"'})}
    <label class="bank-check"><input name="bankChecked" type="checkbox" required>I checked the bank credit, payee and full amount${t.electricityPaise?", and reviewed the electricity bill":""}.</label>
    ${t.rentPaise?`<details class="disclosure"><summary>Already recorded this rent?</summary>${field("existingRentReceipt","Existing rent receipt number",{help:"Only if this exact rent portion was already recorded manually. It will be linked without another credit.",attrs:'maxlength="100"'})}</details>`:""}
    ${button("Confirm received payment",{type:"submit",kind:"primary block"})}</form>
    <details class="disclosure"><summary>Request a correction</summary><form data-form="rejectTransfer" novalidate><div class="form-error" role="alert"></div>${field("reason","What needs correcting?",{type:"textarea",required:true,attrs:'maxlength="500"'})}${button("Return proof for correction",{type:"submit",kind:"secondary block"})}</form></details>`:"")+
  (t.status==="CONFIRMED"?button("Download receipt",{action:"transferReceipt",kind:"primary block"}):""),
 mount(){void images.mount();},unmount(){images.unmount();},
 async action(name){if(name==="transferReceipt")return ctx.downloadAccountReceipt(`${base}/transfers/${t.id}/receipt.pdf`,t.receiptNumber);},
 async submit(name,form){
  if(name!=="reviewTransfer"&&name!=="rejectTransfer")return;
  const v=formValues(form),approve=name==="reviewTransfer";
  if(approve&&v.bankChecked!=="on")throw new Error("Check the bank credit before confirming this payment.");
  await ctx.api(`${base}/transfers/${t.id}/review`,{method:"POST",body:{proofId:proof.id,approve,...(approve?{bankChecked:true,
    ...(v.bankReference?.trim()?{bankReference:v.bankReference.trim()}:{}),
    ...(v.existingRentReceipt?.trim()?{existingRentReceipt:v.existingRentReceipt.trim()}:{})}:{reason:v.reason.trim()})}});
  ctx.markSaved();ctx.invalidate();
  ctx.toast(approve?"Payment confirmed. Receipt created.":"Correction requested.");
  return ctx.reload();
 }
 };
}
export function transferList(rows,owner=false){return rows.map(t=>card(`<div class="campaign-head"><div><h3>${esc(owner?t.resident||"Resident":t.electricityPaise?"Rent & electricity":"Rent payment")}</h3><p>${date(t.confirmedAt||t.createdAt)}</p></div>${badge(labels[t.status]||"Owner confirmed",t.status==="CONFIRMED"?"green":"amber")}</div>${split(t)}${button(owner?"Review payment":"View payment",{route:owner?"ownerTransferReview":"transferProof",params:{id:t.id,invoiceId:t.invoiceId},kind:"secondary block"})}`)).join("");}
