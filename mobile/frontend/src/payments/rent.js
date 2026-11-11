// Presentation only. No native return, local state or SDK result pays an invoice.
export const rentCheckout={
 invoiceId:null,orderId:null,providerOrderId:null,membershipId:null,status:null,
 begin(session,membershipId){Object.assign(this,{invoiceId:session.invoiceId,orderId:session.orderId,providerOrderId:session.providerOrderId,membershipId,status:"DISCOVERING"});},
 receive(providerOrderId,status){if(!this.providerOrderId||this.providerOrderId!==providerOrderId)return false;this.status=status;return true;},
 restore(native,membershipId){
  try{const saved=JSON.parse(native.call("getRentPaymentState")||"null");
   if(saved?.membershipId===membershipId&&saved.invoiceId&&saved.rentOrderId&&/^order_[A-Za-z0-9]+$/.test(saved.orderId||"")){Object.assign(this,{membershipId,invoiceId:saved.invoiceId,orderId:saved.rentOrderId,providerOrderId:saved.orderId,status:saved.status});return true;}
  }catch{}return false;
 },
 clear(){Object.assign(this,{invoiceId:null,orderId:null,providerOrderId:null,membershipId:null,status:null});},
};
