// Native checkout survives a screen replacement. This state never grants access.
// Payment contact is separate from account authentication; never invent a payer number.
export function paymentContact(value) {
  const match=String(value||"").replace(/[\s()-]/g,"").match(/^(?:\+91|91)?([6-9][0-9]{9})$/);
  return match?`+91${match[1]}`:null;
}
const messages = {
  DISCOVERING: "Finding your installed UPI apps…",
  CHOOSING_APP: "Choose a UPI app to continue.",
  SUBMITTED: "Approve payment in your UPI app. Then check payment status.",
  NO_SUPPORTED_APP: "No supported UPI app was detected. Enable a supported app, then retry. No payment was submitted.",
  APP_DISCOVERY_TIMEOUT: "UPI app discovery timed out. Check your connection, then retry.",
  CANCELLED_BEFORE_SUBMIT: "App selection was cancelled. No payment was submitted.",
  FAILED_OR_UNKNOWN_CHECK_PROVIDER: "The UPI payment was not confirmed. Check payment status before retrying.",
  RETURNED_CHECK_PROVIDER: "Checking your payment with Razorpay…",
  INTERRUPTED_CHECK_PROVIDER: "The previous checkout was interrupted. Check payment status before trying again.",
  SDK_UNAVAILABLE: "UPI checkout could not start. Check payment status, then retry.",
};
export const planCheckout = {
  orderId: null, organisationId: null, status: null, message: "", busy: false, checkedOrder:null,receipt:null,
  begin(organisationId, orderId) {
    Object.assign(this, {organisationId, orderId, status:"DISCOVERING", message:messages.DISCOVERING, busy:true,checkedOrder:null,receipt:null});
  },
  receive(orderId, status, detail = "") {
    if (this.orderId && this.orderId !== orderId) return false;
    this.orderId = orderId;
    this.status = status;
    this.message = detail || messages[status] || "Check payment status before trying again.";
    this.busy = ["DISCOVERING","CHOOSING_APP","SUBMITTED"].includes(status);
    return true;
  },
  restore(native, organisationId) {
    try {
      const saved = JSON.parse(native.call("getPlanPaymentState") || "null");
      if (saved?.orderId && saved.organisationId===organisationId && (!this.organisationId || this.organisationId === organisationId)) {
        this.organisationId = organisationId;
        this.receive(saved.orderId, saved.status, saved.message);
      }
    } catch { /* A missing native snapshot does not change server payment state. */ }
  },
  clear() { Object.assign(this,{orderId:null,organisationId:null,status:null,message:"",busy:false,checkedOrder:null,receipt:null}); },
};
