import {heading,card,button,badge,esc,month,notice,date} from "../components/ui.js";
import {money,parseRupees,rupeesInput} from "../domain/finance.js";
import {field,formValues} from "../components/forms.js";
import {uploadEvidence,evidenceImages} from "../components/evidence.js";
import {requestId} from "../platform/client.js";
import {pendingDirect,saveDirect} from "../payments/direct-return.js";

const base="/api/platform/direct-payments";
const image=(id,label)=>id?`<figure class="evidence-photo"><figcaption>${esc(label)}</figcaption><img data-evidence-id="${esc(id)}" alt="${esc(label)}" hidden></figure>`:"";
const split=t=>`<dl class="transfer-breakdown">${t.rentPaise?`<div><dt>Rent / invoice charges</dt><dd>${money(t.rentPaise)}</dd></div>`:""}${t.electricityPaise?`<div><dt>Electricity</dt><dd>${money(t.electricityPaise)}</dd></div>`:""}<div class="transfer-total"><dt>Total</dt><dd>${money(t.amountPaise)}</dd></div></dl>`;
const labels={READY:"Not submitted",SUBMITTED:"Owner confirmation pending",REJECTED:"Correction requested",CONFIRMED:"Owner confirmed",CANCELLED:"Cancelled — no debit"};

export async function directPaymentScreen(ctx){
 const invoiceId=ctx.params.invoiceId||ctx.params.id;if(!invoiceId)throw new Error("Choose your billing month first.");
 const data=await ctx.api(`${base}/invoices/${encodeURIComponent(invoiceId)}`),i=data.invoice,b=data.bill;
 const open=data.transfers.filter(t=>["READY","SUBMITTED","REJECTED"].includes(t.status)),electricityPending=open.some(t=>t.electricityPaise>0);
 const rent=i.remainingPaise>0&&i.status==="DUE"&&!open.some(t=>t.rentPaise>0),electricity=b?.status==="DUE"&&!electricityPending,images=evidenceImages(ctx);
 return {title:"Rent & electricity",back:true,nav:false,guardForm:true,
 content:heading("",month(i.year,i.month),"Pay your PG owner directly")+
  open.map(t=>card(`${badge(labels[t.status])}${split(t)}${button(t.status==="READY"?"Continue payment":"View submitted payment",{route:"transferProof",params:{id:t.id,invoiceId},kind:"primary block"})}`)).join("")+
  card(`<div class="charge-summary"><div><h2>Rent</h2><strong>${money(i.remainingPaise)}</strong></div><span>${i.remainingPaise?"Fixed by your owner":"No rent outstanding"}</span></div>${i.electricityIncludedPaise?`<p>Includes ${money(i.electricityIncludedPaise)} electricity already billed by your owner.</p>`:""}`)+
  card(`<div class="charge-summary"><div><h2>Electricity</h2><strong>${b?money(b.amountPaise):"Add bill"}</strong></div><span>${b?.status==="PAID"?"Owner confirmed":"Your amount + meter photo"}</span></div>${b?image(b.meterEvidenceId,"Meter photo"):""}${!i.electricityIncludedPaise&&!electricityPending&&b?.status!=="PAID"?`<details class="disclosure" ${b?"":"open"}><summary>${b?"Edit electricity bill":"Add your electricity bill"}</summary><form data-form="electricityBill" novalidate><div class="form-error" role="alert"></div>${field("amount","Electricity amount (₹)",{required:true,value:b?rupeesInput(b.amountPaise):"",attrs:'inputmode="decimal" autocomplete="off"'})}${field("meter","Meter photo",{type:"file",required:true,attrs:'accept="image/jpeg,image/png,image/webp"'})}<p class="field-help">Upload a clear meter photo. You can pay this bill together with rent or later.</p>${button("Save electricity bill",{type:"submit",kind:"secondary block"})}</form></details>`:""}`)+
  (!data.payee?notice("Your owner needs to add their rent-receiving UPI ID first."):card(`<span class="eyebrow">Paying directly to</span><h2>${esc(data.payee.payeeName)}</h2><p class="payee-address">${esc(data.payee.upiAddress)}</p>`))+
  (data.payee&&(rent||electricity)?`<form data-form="chooseTransfer" novalidate><div class="form-error" role="alert"></div>${field("charges","Choose what to pay",{options:[...(rent?[["RENT",`Rent only · ${money(i.remainingPaise)}`]]:[]),...(electricity?[["ELECTRICITY",`Electricity only · ${money(b.amountPaise)}`]]:[]),...(rent&&electricity?[["BOTH",`Rent + electricity · ${money(i.remainingPaise+b.amountPaise)}`]]:[])]})}${button("Continue to payment",{type:"submit",kind:"primary block",glyph:"arrow"})}</form>`:"")+
  data.transfers.filter(t=>t.status==="CONFIRMED").map(t=>card(`${badge("Owner confirmed","green")}${split(t)}${button("View receipt",{route:"transferProof",params:{id:t.id,invoiceId},kind:"secondary block"})}`)).join(""),
 mount(){void images.mount();},unmount(){images.unmount();},
 async submit(name,form){const v=formValues(form);
  if(name==="electricityBill"){const amount=parseRupees(v.amount,{min:.01,max:100000});const saved=await uploadEvidence(ctx,form.elements.meter.files[0],"METER");await ctx.api(`${base}/invoices/${invoiceId}/electricity`,{method:"POST",body:{amountPaise:Math.round(amount*100),meterEvidenceId:saved.id}});ctx.markSaved();ctx.invalidate();return ctx.reload();}
  if(name==="chooseTransfer"){const result=await ctx.api(`${base}/invoices/${invoiceId}/transfers`,{method:"POST",body:{rent:["RENT","BOTH"].includes(v.charges),electricity:["ELECTRICITY","BOTH"].includes(v.charges),key:requestId()}});saveDirect(ctx.snapshot,ctx.native,{transferId:result.transferId,invoiceId});ctx.markSaved();return ctx.navigate("transferProof",{id:result.transferId,invoiceId});}
 }
 };
}
export async function transferProofScreen(ctx){
 const {transfer:t,bill,invoice,issue,intent}=await ctx.api(`${base}/transfers/${encodeURIComponent(ctx.params.id)}`),images=evidenceImages(ctx),proof=t.proofs[0];
 const pending=pendingDirect(ctx.snapshot,ctx.native),returned=pending?.transferId===t.id&&pending.stage==="PROOF";
 let launched=false,proofKey=requestId();
 const setProof=()=>{saveDirect(ctx.snapshot,ctx.native,{transferId:t.id,invoiceId:t.invoiceId,stage:"PROOF"});document.querySelector("[data-payment-launch]")?.setAttribute("hidden","");document.querySelector("[data-proof-upload]")?.removeAttribute("hidden");document.querySelector("[data-proof-title]")?.focus();};
 return {title:"Payment proof",back:true,nav:false,guardForm:true,
 content:heading("",t.status==="CONFIRMED"?"Payment confirmed":t.status==="SUBMITTED"?"Proof submitted":returned||t.status==="REJECTED"?"Attach payment proof":"Pay your PG owner",month(invoice.year,invoice.month))+
  card(`${badge(labels[t.status],t.status==="CONFIRMED"?"green":"amber")}${split(t)}<p class="payee">${esc(t.payeeName)}</p><p class="payee-address">${esc(t.payeeAddress)}</p>`)+
  (issue?notice(issue):"")+
  (t.status==="READY"?`<section data-payment-launch ${returned?"hidden":""}>${intent?button("Pay with UPI app",{action:"openTransferUpi",kind:"primary block"}):""}${button("Copy UPI ID",{action:"copyPayee",kind:"secondary block"})}${button("Copy amount",{action:"copyAmount",kind:"text-button block"})}${button("I have paid — attach proof",{action:"attachTransferProof",kind:"text-button block"})}<p data-direct-launch-error role="status"></p></section>`:"")+
  (["READY","REJECTED"].includes(t.status)?`<section data-proof-upload ${t.status==="READY"&&!returned?"hidden":""}><h2 data-proof-title tabindex="-1">Attach your payment proof</h2>${proof?.reason?notice(proof.reason):""}<p class="subtitle">If money was debited, don't pay again. Upload the payment screenshot and bank reference.</p><form data-form="transferProof" novalidate><div class="form-error" role="alert"></div>${field("reference","UTR / transaction reference",{required:true,value:proof?.bankReference||"",attrs:'minlength="6" maxlength="40" autocomplete="off"'})}${field("proof","Payment screenshot",{type:"file",required:true,attrs:'accept="image/jpeg,image/png,image/webp"'})}${button("Submit payment proof",{type:"submit",kind:"primary block"})}</form></section>`:"")+
  (t.status==="SUBMITTED"?notice("Your payment proof was submitted. Your owner will check the bank credit before confirming payment."):"")+
  (proof?card(`<p>Bank reference: ${esc(proof.bankReference)}</p>${image(proof.evidenceId,"Payment screenshot")}`):"")+
  (t.status==="CONFIRMED"?button("Download receipt",{action:"transferReceipt",kind:"primary block"}):"")+
  (t.status==="READY"?`<details class="disclosure"><summary>Payment cancelled or no debit?</summary><p>Only clear this request if you checked your bank and no money was debited.</p>${button("No debit — change payment selection",{action:"cancelTransfer",kind:"secondary block"})}</details>`:"")+
  button("Refresh payment status",{action:"refreshTransfer",kind:"text-button block"})+
  button("Rent & electricity",{route:"payment",params:{invoiceId:t.invoiceId},kind:"secondary block"}),
 mount(){void images.mount();if(t.status==="CONFIRMED"&&pending?.transferId===t.id)saveDirect(ctx.snapshot,ctx.native,null);},unmount(){images.unmount();},
 directUpiResult(opened,message){if(!opened){launched=false;const el=document.querySelector("[data-direct-launch-error]");if(el)el.textContent=message||"UPI app did not open. Copy your owner's UPI ID and pay in your UPI app.";}},
 directReturned(){if(t.status==="READY")setProof();},
 async action(name){
  if(name==="refreshTransfer")return ctx.reload();
  if(name==="attachTransferProof")return setProof();
  if(name==="copyPayee"||name==="copyAmount"){const text=name==="copyPayee"?t.payeeAddress:(t.amountPaise/100).toFixed(2);if(ctx.native.has("copyText"))ctx.native.call("copyText",text);else await navigator.clipboard.writeText(text);return ctx.toast("Copied.");}
  if(name==="transferReceipt")return ctx.downloadAccountReceipt(`${base}/transfers/${t.id}/receipt.pdf`,t.receiptNumber);
  if(name==="cancelTransfer"){if(!await ctx.confirm({title:"No money debited?",message:"Check your bank first. Do not clear a debited or uncertain transfer.",confirmLabel:"Confirmed — no debit"}))return;await ctx.api(`${base}/transfers/${t.id}/cancel`,{method:"POST",body:{noDebit:true}});saveDirect(ctx.snapshot,ctx.native,null);ctx.markSaved();return ctx.navigate("payment",{invoiceId:t.invoiceId},{replace:true,force:true});}
  if(name!=="openTransferUpi")return;
  if(!intent)throw new Error(issue||"This request cannot be paid. Refresh before continuing.");
  if(launched)return;if(!ctx.native.has("openDirectOwnerUpi"))throw new Error("Copy the UPI ID and amount to pay in your UPI app, then attach proof here.");
  saveDirect(ctx.snapshot,ctx.native,{transferId:t.id,invoiceId:t.invoiceId,stage:"PROOF"});launched=true;ctx.markSaved();ctx.native.call("openDirectOwnerUpi",intent);
 },
 async submit(name,form){if(name!=="transferProof")return;const v=formValues(form),saved=await uploadEvidence(ctx,form.elements.proof.files[0],"PAYMENT");await ctx.api(`${base}/transfers/${t.id}/proof`,{method:"POST",body:{evidenceId:saved.id,bankReference:v.reference.trim(),key:proofKey}});ctx.markSaved();ctx.invalidate();return ctx.reload();}
 };
}
export async function ownerTransferReviewScreen(ctx){
 const {transfer:t,bill,invoice,resident}=await ctx.api(`${base}/transfers/${encodeURIComponent(ctx.params.id)}`),proof=t.proofs.find(p=>p.status==="PENDING"),images=evidenceImages(ctx);
 return {title:"Review payment",back:true,nav:false,guardForm:true,financialMutation:true,
 content:heading("",resident.name,`${resident.room?`Room ${resident.room} · `:""}${month(invoice.year,invoice.month)}`)+card(`${badge(labels[t.status])}${split(t)}<p>Paid to: ${esc(t.payeeAddress)}</p>`)+
  (bill?card(`<h2>Electricity bill</h2><p>Resident-entered amount: ${money(bill.amountPaise)}</p>${image(bill.meterEvidenceId,"Meter photo")}`):"")+
  t.proofs.map(p=>card(`<h2>Payment proof</h2><p>UTR: ${esc(p.bankReference)}</p>${badge(p.status)}${p.reason?`<p>${esc(p.reason)}</p>`:""}${image(p.evidenceId,"Payment screenshot")}`)).join("")+
  (proof?`<form data-form="reviewTransfer" novalidate><div class="form-error" role="alert"></div><label class="bank-check"><input name="bankChecked" type="checkbox" required>I checked the bank credit, payee and full amount${t.electricityPaise?", and reviewed the electricity amount and meter photo":""}.</label>${t.rentPaise?`<details class="disclosure"><summary>Already recorded this rent?</summary>${field("existingRentReceipt","Existing rent receipt number",{help:"Only if this exact rent portion was already recorded manually. It will be linked without another credit.",attrs:'maxlength="100"'})}</details>`:""}${button("Confirm received payment",{type:"submit",kind:"primary block"})}</form><details class="disclosure"><summary>Request a correction</summary><form data-form="rejectTransfer" novalidate><div class="form-error" role="alert"></div>${field("reason","What needs correcting?",{type:"textarea",required:true,attrs:'maxlength="500"'})}${button("Return proof for correction",{type:"submit",kind:"secondary block"})}</form></details>`:"")+
  (t.status==="CONFIRMED"?button("Download receipt",{action:"transferReceipt",kind:"primary block"}):""),
 mount(){void images.mount();},unmount(){images.unmount();},
 async action(name){if(name==="transferReceipt")return ctx.downloadAccountReceipt(`${base}/transfers/${t.id}/receipt.pdf`,t.receiptNumber);},
 async submit(name,form){const v=formValues(form),approve=name==="reviewTransfer";if(approve&&!await ctx.confirm({title:"Confirm bank credit?",message:`Record ${money(t.amountPaise)} received from ${resident.name}. Rent ${money(t.rentPaise)}; electricity ${money(t.electricityPaise)}.`,confirmLabel:"Confirm received"}))return;await ctx.api(`${base}/transfers/${t.id}/review`,{method:"POST",body:{proofId:proof.id,approve,...(approve?{bankChecked:v.bankChecked==="on",...(v.existingRentReceipt?.trim()?{existingRentReceipt:v.existingRentReceipt.trim()}:{})}:{reason:v.reason.trim()})}});ctx.markSaved();ctx.invalidate();ctx.toast(approve?"Payment confirmed. Receipt created.":"Correction requested. No money was credited.");return ctx.reload();}
 };
}
export function transferList(rows,owner=false){return rows.map(t=>card(`<div class="campaign-head"><div><h3>${esc(owner?t.resident||"Resident":t.electricityPaise?"Rent & electricity":"Rent payment")}</h3><p>${date(t.confirmedAt||t.createdAt)}</p></div>${badge(labels[t.status]||"Owner confirmed",t.status==="CONFIRMED"?"green":"amber")}</div>${split(t)}${button(owner?"Review payment":"View payment",{route:owner?"ownerTransferReview":"transferProof",params:{id:t.id,invoiceId:t.invoiceId},kind:"secondary block"})}`)).join("");}
