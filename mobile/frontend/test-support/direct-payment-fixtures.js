// Synthetic UI contracts only. Never imported by an application entry point.
export function createDirectPaymentFixtures(){
 const f={bill:null,transfers:[],uploads:[],remainingPaise:850099,year:2026,month:11,creates:0,evidence:{},payee:{upiAddress:"owner-fixture@invalid",payeeName:"PG Owner",enabled:true}};
 f.handler=(url,method="GET",body={})=>{
  const request=new URL(url),path=request.pathname,ok=data=>({status:200,data});
  if(path==="/api/platform/config")return ok({enabled:true,directRentProof:true,ownerRent:{enabled:false},authentication:"EMAIL_PASSWORD",androidBilling:"CUSTOM_UPI_INTENT",legal:{}});
  if(path==="/api/platform/rent/owner"){
   if(method==="POST")f.payee={...body,enabled:true};return ok(method==="POST"?{payee:f.payee}:{payee:f.payee,claims:[]});
  }
  if(!path.startsWith("/api/platform/direct-payments/"))return null;
  const p=path.replace("/api/platform/direct-payments/","");
  if(p==="evidence"&&method==="POST"){const id=`evidence-${f.uploads.length+1}`;f.uploads.push({...body,id});f.evidence[id]=body.image;return ok({id});}
  if(p.startsWith("evidence/")){return {status:200,data:f.evidence[p.split("/")[1]]||"",image:true};}
  if(p==="owner")return ok({transfers:f.transfers.map(t=>({...t,resident:"Aarav Sharma"})).toReversed(),nextCursor:null});
  if(p==="owner/overview"){
   const pending=f.transfers.filter(t=>t.status==="SUBMITTED");
   const electricity=f.transfers.find(t=>t.electricityPaise>0&&["SUBMITTED","CONFIRMED","REJECTED"].includes(t.status));
   const due=request.searchParams.get("due")?.split(",")||[];
   return ok({
    summary:{proofCount:pending.length,rentSubmittedPaise:pending.reduce((n,t)=>n+t.rentPaise,0),
     electricityBilledPaise:f.bill?.amountPaise||0,electricityCollectedPaise:f.bill?.status==="PAID"?f.bill.amountPaise:0,
     electricitySubmittedPaise:electricity?.status==="SUBMITTED"?electricity.electricityPaise:0,electricityBillCount:Number(Boolean(f.bill))},
    proofs:pending.map(t=>({...t,proofId:t.proofs[0].id,evidenceId:t.proofs[0].evidenceId,bankReference:t.proofs[0].bankReference,
     meterEvidenceId:t.electricityPaise?f.bill?.meterEvidenceId:null,resident:"Aarav Sharma",room:"203",submittedAt:"2026-11-23T07:00:00Z"})),
    bills:f.bill?[{...f.bill,invoiceId:"invoice1",resident:"Aarav Sharma",room:"203",
     status:f.bill.status==="PAID"?"PAID":electricity?.status||"DUE",transferId:electricity?.id}]:[],
    rentProofInvoiceIds:pending.filter(t=>t.rentPaise&&due.includes(t.invoiceId)).map(t=>t.invoiceId),nextCursor:null,
   });
  }
  const review=(transfer,proof,input)=>{
   proof.status=input.approve?"APPROVED":"REJECTED";proof.reason=input.reason;
   transfer.status=input.approve?"CONFIRMED":"REJECTED";
   if(input.approve){
    proof.bankReference=input.bankReference??proof.bankReference; f.remainingPaise-=transfer.rentPaise;
    if(transfer.electricityPaise)f.bill.status="PAID";transfer.receiptNumber="PGT-SYNTHETIC";transfer.confirmedAt="2026-11-23T08:00:00Z";
   }
  };
  if(p==="owner/reconcile"&&method==="POST"){
   f.reconciliation=body;
   for(const payment of body.payments){
    const transfer=f.transfers.find(t=>t.id===payment.transferId);
    review(transfer,transfer.proofs.find(p=>p.id===payment.proofId),{approve:true,bankReference:payment.bankReference});
   }
   return ok({confirmedCount:body.payments.length,amountPaise:body.amountPaise});
  }
  if(p==="history")return ok({transfers:f.transfers.filter(t=>t.status==="CONFIRMED")});
  if(p==="invoices/invoice1")return ok({invoice:{id:"invoice1",year:f.year,month:f.month,rentPaise:850099,remainingPaise:f.remainingPaise,electricityIncludedPaise:0,status:f.remainingPaise?"DUE":"PAID"},bill:f.bill,payee:f.payee,transfers:f.transfers.toReversed()});
  if(p==="invoices/invoice1/electricity"){f.bill={id:"bill-one",amountPaise:body.amountPaise,meterEvidenceId:body.meterEvidenceId,status:"DUE"};return ok({bill:f.bill});}
  if(p==="invoices/invoice1/transfers"){
   let t=f.transfers.find(t=>["READY","SUBMITTED","REJECTED"].includes(t.status));
   if(!t){f.creates++;const rentPaise=body.rent?f.remainingPaise:0,electricityPaise=body.electricity?f.bill.amountPaise:0;t={id:`transfer-${f.creates}`,invoiceId:"invoice1",rentPaise,electricityPaise,amountPaise:rentPaise+electricityPaise,payeeAddress:f.payee.upiAddress,payeeName:f.payee.payeeName,status:"READY",proofs:[],createdAt:"2026-11-23T07:00:00Z"};f.transfers.push(t);}
   return ok({transferId:t.id});
  }
  const t=f.transfers.find(t=>t.id===p.split("/")[1]);if(!t)return {status:404,data:{error:{message:"Synthetic transfer not found"}}};
  if(p.endsWith("/proof")){t.proofs.unshift({id:`proof-${t.proofs.length+1}`,evidenceId:body.evidenceId,bankReference:body.bankReference??null,status:"PENDING"});t.status="SUBMITTED";return ok({proof:t.proofs[0]});}
  if(p.endsWith("/review")){review(t,t.proofs.find(p=>p.id===body.proofId),body);return ok({transfer:t});}
  if(p.endsWith("/cancel")){t.status="CANCELLED";return ok({ok:true});}
  return ok({transfer:t,bill:t.electricityPaise?f.bill:null,invoice:{year:f.year,month:f.month},resident:{name:"Aarav Sharma",room:"203"},intent:t.status==="READY"&&!f.paymentIssue?`upi://pay?pa=${encodeURIComponent(t.payeeAddress)}&pn=PG%20Owner&am=${(t.amountPaise/100).toFixed(2)}&cu=INR&tr=PGT1234567890123456`:null,issue:f.paymentIssue||null});
 };return f;
}
