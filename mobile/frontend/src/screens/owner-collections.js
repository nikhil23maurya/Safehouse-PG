import {money} from "../domain/finance.js";
import {heading,card,button,badge,date,esc} from "../components/ui.js";
import {organisation} from "../platform/client.js";
const statusLabel=s=>({CAPTURED:"Payment received",PARTIALLY_REFUNDED:"Partially refunded",REFUNDED:"Refunded",FAILED:"Payment failed",REVIEW_REQUIRED:"Needs review",CREATION_UNCERTAIN:"Awaiting confirmation",CREATED:"Payment started",AUTHORIZED:"Verifying payment",COMPLETED:"Bank settlement completed",PENDING:"Bank settlement pending"}[s]||"Awaiting confirmation");
export async function ownerCollectionsScreen(ctx){
 const org=organisation(ctx.snapshot);if(!org)throw new Error("Select your owner workspace.");
 const p=ctx.snapshot.period,data=await ctx.api(`/api/platform/owner-payments/organisations/${org.id}/collections?year=${p.year}&month=${p.month}`);
 const stat=(label,value)=>`<div><span>${esc(label)}</span><strong>${value}</strong></div>`;
 return {title:"Rent collection",back:true,nav:false,content:heading("","Rent collection","Your rent, refunds and bank settlements.")+
  `<div class="merchant-totals">${stat("Rent billed",money(data.totalBilledPaise))}${stat("Rent collected",money(data.totalCollectedPaise))}${stat("Outstanding",money(data.outstandingPaise))}${stat("Online refunds",money(data.onlineRefundedPaise))}</div>`+
  `<div class="merchant-summary">${badge(`${data.pendingVerification} awaiting confirmation`,"amber")}${badge(`${data.failedAttempts} failed payments`)}</div>`+
  button("Payment account",{route:"merchant",kind:"secondary block"})+button("Refresh transactions",{action:"refreshCollections",kind:"text-button block"})+
  `<h2>Online rent payments</h2>`+(data.payments?.length?data.payments.map(p=>card(`<div class="receipt-heading"><strong>${money(p.amountPaise)}</strong>${badge(statusLabel(p.status),p.status==="CAPTURED"?"green":"amber")}</div><p class="payment-reference">${esc(p.reference)}</p><p>${esc(date(p.paidAt))}</p>${p.refundedPaise?`<p>Refunded ${money(p.refundedPaise)}</p>`:""}<p>${p.settlement?.length?p.settlement.map(s=>esc(statusLabel(s.status))).join(", "):"Bank settlement not confirmed yet"}</p>${button("View invoice",{route:"invoice",params:{id:p.invoiceId},kind:"text-button"})}`)).join(""):card("<p>No online rent payments for this billing period.</p>"))+
  (data.failedPayments?.length?`<details class="disclosure"><summary>Failed payment references</summary>${data.failedPayments.map(p=>`<p class="payment-reference">${esc(p.reference)} · ${money(p.amountPaise)}</p>`).join("")}</details>`:"")+`<h2>Recent bank settlements</h2>`+(data.settlements?.length?data.settlements.map(s=>card(`<strong>${money(s.amountPaise)}</strong>${badge(statusLabel(s.status),s.status==="COMPLETED"?"green":"amber")}<p>${s.settledAt?esc(date(s.settledAt)):"Exact bank-credit time not provided"}</p>${s.utr?`<p class="payment-reference">${esc(s.utr)}</p>`:""}`)).join(""):card("<p>No bank settlements have been confirmed.</p>"))+(data.truncated?'<p class="legal-copy">Showing the latest 200 online requests. Period totals include all invoices.</p>':""),
  async action(name){if(name==="refreshCollections"){const now=new Date();await ctx.api(`/api/platform/owner-payments/organisations/${org.id}/settlements/recheck`,{method:"POST",body:{year:now.getFullYear(),month:now.getMonth()+1,day:now.getDate()}});return ctx.reload();}},
 };
}
