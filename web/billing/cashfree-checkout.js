// Official Cashfree hosted checkout: checkout result is not a payment receipt.
// PGOne always asks its backend to re-fetch the order and captured payment.
let sdkPromise;
export function launchCashfreeCheckout(paymentSessionId, environment = "production") {
  if (typeof paymentSessionId !== "string" || !/^session_[a-zA-Z0-9_-]{20,}$/.test(paymentSessionId))
    throw new Error("Cashfree did not provide a valid payment session.");
  if (!["production", "sandbox"].includes(environment))
    throw new Error("Invalid Cashfree environment.");
  sdkPromise ||= new Promise((resolve, reject) => {
    if (typeof window.Cashfree === "function") return resolve(window.Cashfree);
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.onload = () => typeof window.Cashfree === "function"
      ? resolve(window.Cashfree)
      : reject(new Error("Cashfree checkout could not initialise."));
    script.onerror = () => reject(new Error("Cashfree checkout is unreachable. Check the connection."));
    document.head.appendChild(script);
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise.then(factory => factory({ mode: environment }).checkout({
    paymentSessionId, redirectTarget: "_modal",
  }));
}
