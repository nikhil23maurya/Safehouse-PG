/** Official Razorpay Web Custom SDK. This file is never bundled into Android. */
export class CustomUpiPayment {
  constructor({ Razorpay, keyId, onSigned, onUncertain }) {
    this.sdk = new Razorpay({ key: keyId });
    this.busy = false;
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
    if (typeof this.sdk.checkPaymentAdapter !== "function") return [];
    const apps = [
      ["gpay", "Google Pay"],
      ["phonepe", "PhonePe"],
      ["paytm", "Paytm"],
      ["bhim", "BHIM"],
    ];
    const results = await Promise.allSettled(
      apps.map(async (app) => {
        let timer;
        try {
          await Promise.race([
            this.sdk.checkPaymentAdapter(app[0]),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("App check timed out")),
                8000,
              );
            }),
          ]);
          return app;
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  }
  pay({ orderId, contact, email, app }) {
    if (this.busy) return false;
    if (
      !/^order_[a-zA-Z0-9]+$/.test(orderId) ||
      !/^[6-9]\d{9}$/.test(contact) ||
      !["gpay", "phonepe", "paytm", "bhim"].includes(app)
    )
      throw new Error(
        "Review this one-time payment and your mobile number first.",
      );
    this.busy = true;
    try {
      this.sdk.createPayment(
        {
          amount: 24900,
          currency: "INR",
          order_id: orderId,
          method: "upi",
          contact,
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
