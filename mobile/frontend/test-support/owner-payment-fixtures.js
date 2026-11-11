// Controlled provider UI fixtures: never imported by the application bundle.
export function createOwnerPaymentFixtures(){
 const f={enabled:true,ownerStatus:"KYC_PENDING",ready:false,captured:false,orderExists:false,pending:false,wrongOrder:false,refunded:false,creates:0,rechecks:0,checkoutCalls:0};
 const invoice={id:"invoice1",pgName:"Maple House",year:2026,month:11,dueDate:"2026-11-05T00:00:00.000Z",totalPaise:850099,remainingPaise:850099,status:"DUE"};
 f.status=()=>({invoice:{...invoice,remainingPaise:f.captured&&!f.refunded?0:850099,status:f.captured&&!f.refunded?"PAID":"DUE"},available:true,mode:"test",order:f.orderExists?{id:f.wrongOrder?"another-rent-order":"rent-synthetic",status:f.captured?"CAPTURED":f.pending?"AUTHORIZED":"CREATED",open:!f.captured,amountPaise:850099,providerOrderId:"order_SYNTHRENT"}:null,receipt:f.captured?{id:"payment-synthetic",reference:"pay_SYNTHRENT",amountPaise:850099,refundedPaise:f.refunded?850099:0,status:f.refunded?"REFUNDED":"CAPTURED",paidAt:"2026-11-11T04:00:00.000Z"}:null,settlement:[]});
 f.handler=(url,method="GET",body={})=>{
  const path=new URL(url).pathname;
  if(path==="/api/platform/config")return {enabled:true,authentication:"EMAIL_PASSWORD",phone:null,ownerRent:{enabled:true},androidBilling:"CUSTOM_UPI_INTENT",legal:{}};
  if(path==="/api/platform/organisations/org-fixture/merchant"||path==="/api/platform/owner-payments/organisations/org-fixture"||path.endsWith("/organisations/org-fixture/recheck"))return {provider:"RAZORPAY",onboardingAvailable:f.enabled,collectionEnabled:f.ready,status:f.ready?"ACTIVATED":f.ownerStatus,connected:f.ownerStatus!=="NOT_CONNECTED",mode:"test",bank:{status:f.ready?"PROVIDER_CONFIRMED":"PENDING",last4:f.ready?"9012":null},paymentAcceptance:f.ready?"ENABLED":"NOT_ENABLED",settlementReadiness:f.ready?"READY":"NOT_READY"};
  if(path.endsWith("/organisations/org-fixture/connect")){if(!body.accepted)throw new Error("Synthetic owner confirmation missing");return {url:"https://auth.razorpay.com/authorize?client_id=SYNTHETIC&response_type=code&redirect_uri=https%3A%2F%2Fexample.test%2Fcallback&scope=read_write&state=SYNTHETICSTATE"};}
  if(path.endsWith("/organisations/org-fixture/collections"))return {totalBilledPaise:850099,totalCollectedPaise:f.captured?850099:0,outstandingPaise:f.captured?0:850099,onlineRefundedPaise:0,pendingVerification:f.pending?1:0,failedAttempts:0,payments:f.captured?[{id:"rent-synthetic",invoiceId:"invoice1",status:"CAPTURED",amountPaise:850099,reference:"pay_SYNTHRENT",paidAt:"2026-11-11T04:00:00Z",refundedPaise:0,settlement:[]}]:[],settlements:[]};
  if(path==="/api/platform/owner-payments/invoices/invoice1")return f.status();
  if(path.endsWith("/invoices/invoice1/orders")){if(!f.orderExists){f.creates++;f.orderExists=true;}return {orderId:"rent-synthetic",status:"CREATED"};}
  if(path.endsWith("/orders/rent-synthetic/checkout")){f.checkoutCalls++;return {orderId:"rent-synthetic",invoiceId:"invoice1",providerOrderId:"order_SYNTHRENT",publicToken:"rzp_test_oauth_SYNTHRENT",amountPaise:850099,currency:"INR",mode:"test",pgName:"Maple House"};}
  if(path.endsWith("/orders/rent-synthetic/recheck")){f.rechecks++;return f.status();}
  if(path.endsWith("/settlements/recheck"))return {checked:true};
  return null;
 };return f;
}
