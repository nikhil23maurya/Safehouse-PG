const APP_LABELS = {
  any: "Choose a UPI app",
  gpay: "Google Pay", phonepe: "PhonePe", paytm: "Paytm", bhim: "BHIM",
  cred: "CRED", popclubapp: "POP", mobikwik: "MobiKwik", super_money: "super.money",
  moneyview: "Moneyview", icici: "iMobile Pay", navi: "Navi", payzapp: "PayZapp",
};

/** Official Razorpay Web Custom SDK. This file is never bundled into Android. */
export class CustomUpiPayment {
  constructor({ Razorpay, keyId, onSigned, onUncertain }) {
    this.sdk = new Razorpay({ key: keyId });
    this.busy = false;
    this.appIds = new Set();
    this.sdk.on("payment.success", (value) => {
      this.busy = false;
      onSigned(value);
    });
    this.sdk.on("payment.error", () => {
      this.busy = false;
      onUncertain(
        "The payment app could not confirm payment. Refresh status before trying again.",
      );
    });
  }
  async availableApps() {
    this.appIds.clear();
    if (typeof this.sdk.getSupportedUpiIntentApps !== "function") return [];
    let timer;
    try {
      const supported = await Promise.race([
        this.sdk.getSupportedUpiIntentApps(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("UPI availability timed out")), 8000); }),
      ]);
      if (!Array.isArray(supported)) return [];
      const valid = [...new Set(supported.filter(id => typeof id === "string" && Object.hasOwn(APP_LABELS, id)))];
      // Android's supported `any` intent delegates installed-app selection to
      // the device. A browser's supported-app list is not an installation scan.
      const shown = valid.includes("any") ? ["any"] : valid;
      this.appIds = new Set(shown);
      return shown.map(id => [id, APP_LABELS[id]]);
    } catch { return []; }
    finally { clearTimeout(timer); }
  }
  pay({ orderId, amountPaise, contact, email, app }) {
    if (this.busy) return false;
    if (
      !/^order_[a-zA-Z0-9]+$/.test(orderId) ||
      !Number.isSafeInteger(amountPaise) || ![100,24900].includes(amountPaise) ||
      (contact && !/^(\+91)?[6-9]\d{9}$/.test(contact)) ||
      !this.appIds.has(app)
    )
      throw new Error(
        "Review this one-time payment and your mobile number first.",
      );
    this.busy = true;
    try {
      this.sdk.createPayment(
        {
          amount: amountPaise,
          currency: "INR",
          order_id: orderId,
          method: "upi",
          ...(contact ? {contact} : {}),
          email,
        },
        { app },
      );
      return true;
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
}
export function loadCustomSdk() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/razorpay.js";
    script.onload = () =>
      window.Razorpay
        ? resolve(window.Razorpay)
        : reject(new Error("The custom payment SDK could not initialise."));
    script.onerror = () =>
      reject(
        new Error(
          "The payment provider could not load. Check your connection.",
        ),
      );
    document.head.append(script);
  });
}
