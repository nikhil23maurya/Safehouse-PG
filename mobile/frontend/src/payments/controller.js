import { trustedQr, verifiedCapture } from "../domain/finance.js";

// The controller has no rendering or native dependencies. Every success is derived
// from the existing backend's captured-payment and matching invoice/payment record.
export class PaymentController {
  constructor({
    api,
    getPending,
    setPending,
    onSettled = () => {},
    now = () => Date.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
  }) {
    Object.assign(this, {
      api,
      getPending,
      setPending,
      onSettled,
      now,
      schedule,
      cancel,
    });
    this.generation = 0;
    this.timer = null;
    this.listeners = new Set();
    this.checkFlight = null;
    this.value = {
      phase: "preparing",
      qr: null,
      invoice: null,
      payment: null,
      imageReady: false,
      checking: false,
      message: "",
    };
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.value);
    return () => this.listeners.delete(listener);
  }
  emit(patch) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener(this.value);
  }
  stop() {
    this.generation++;
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
    this.checkFlight = null;
  }
  async open(invoice) {
    this.stop();
    const generation = this.generation;
    this.startedAt = this.now();
    this.value = {
      phase: "preparing",
      qr: null,
      invoice,
      payment: null,
      imageReady: false,
      checking: false,
      message: "",
    };
    this.emit({});
    const saved = this.getPending();
    if (saved?.invoiceId === invoice.id && trustedQr(saved.qr)) {
      this.emit({ qr: saved.qr, phase: "verifying" });
      await this.check();
      return;
    }
    await this.create(generation);
  }
  async create(generation = this.generation) {
    if (this.createGeneration === generation) return;
    this.createGeneration = generation;
    this.emit({ phase: "preparing", message: "", imageReady: false });
    try {
      const result = await this.api("/api/student/payments/upi-qr", {
        method: "POST",
        body: { invoiceId: this.value.invoice.id },
      });
      if (generation !== this.generation) return;
      if (!trustedQr(result.qr))
        throw new Error(
          "The server did not return a trusted, fixed-amount payment QR.",
        );
      await this.setPending({
        invoiceId: this.value.invoice.id,
        qr: result.qr,
      });
      if (generation !== this.generation) return;
      this.emit({ qr: result.qr, phase: "awaiting", imageReady: false });
      // Reconcile immediately, including an existing QR reused by the backend.
      await this.check();
    } catch (error) {
      if (generation !== this.generation) return;
      this.emit({
        phase: "unavailable",
        message:
          error.code === "UPI_QR_NOT_ENABLED"
            ? "UPI QR payments are not enabled for this property. Contact your owner."
            : error.message,
      });
    } finally {
      if (this.createGeneration === generation) this.createGeneration = null;
    }
  }
  imageLoaded(qrId) {
    if (this.value.qr?.id === qrId && !this.value.imageReady)
      this.emit({ imageReady: true, imageError: false });
  }
  imageFailed(qrId) {
    if (this.value.qr?.id === qrId && !this.value.imageError)
      this.emit({ imageReady: false, imageError: true });
  }
  retryImage() {
    this.emit({ imageReady: false, imageError: false });
  }
  async check() {
    if (!this.value.qr || ["success", "settled"].includes(this.value.phase))
      return;
    if (this.checkFlight) return this.checkFlight;
    if (this.timer) this.cancel(this.timer);
    const generation = this.generation,
      qr = this.value.qr,
      invoiceId = this.value.invoice.id;
    const run = async () => {
      this.emit({ checking: true });
      try {
        const status = await this.api(
          `/api/student/payments/orders/${encodeURIComponent(qr.id)}/status`,
        );
        if (generation !== this.generation || this.value.qr?.id !== qr.id)
          return;
        if (verifiedCapture(status, invoiceId)) {
          const history = await this.api("/api/student/invoices");
          if (generation !== this.generation || this.value.qr?.id !== qr.id)
            return;
          const invoice = history.invoices?.find(
            (i) =>
              i.id === invoiceId &&
              i.status === "PAID" &&
              i.remainingPaise === 0,
          );
          const payment = invoice?.payments?.find(
            (p) =>
              p.providerOrderId === qr.id &&
              p.source === "RAZORPAY" &&
              p.amountPaise === qr.amountPaise &&
              p.id &&
              p.paidAt &&
              p.receiptNumber,
          );
          if (!payment) {
            this.emit({
              phase: "verifying",
              message:
                "Payment capture is confirmed. Your payment record and receipt are being refreshed.",
            });
          } else {
            await this.setPending(null);
            if (generation !== this.generation) return;
            this.emit({
              phase: "success",
              payment: {
                ...payment,
                invoice: {
                  id: invoice.id,
                  year: invoice.year,
                  month: invoice.month,
                },
              },
              invoice,
              message: "",
            });
            this.onSettled();
            return;
          }
        } else if (
          status.paid === true &&
          status.invoiceStatus === "PAID" &&
          status.invoice?.id === invoiceId
        ) {
          await this.setPending(null);
          if (generation !== this.generation) return;
          this.emit({
            phase: "settled",
            message:
              "This invoice has been settled through another payment. Refresh your payment history for its receipt.",
          });
          this.onSettled();
          return;
        } else if (status.attemptStatus === "FAILED") {
          this.emit({
            phase: "failed",
            message:
              "The provider reports this payment attempt as failed. Check your bank before trying again.",
          });
        } else if (this.now() >= qr.expiresAt * 1000) {
          this.emit({
            phase: "expired",
            message:
              "This QR has expired. We will check the earlier payment before requesting another QR.",
          });
        } else {
          this.emit({
            phase:
              this.now() - this.startedAt > 90_000 ? "delayed" : "awaiting",
            message: "",
          });
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.emit({
          phase: "unavailable",
          message:
            "Payment status is temporarily unavailable. If money was debited, do not pay again. Check confirmation shortly.",
        });
      } finally {
        if (generation === this.generation) {
          this.emit({ checking: false });
          if (
            !["success", "settled", "expired", "failed"].includes(
              this.value.phase,
            )
          )
            this.timer = this.schedule(
              () => void this.check(),
              this.value.phase === "awaiting" ? 5000 : 10000,
            );
        }
      }
    };
    const flight = run();
    this.checkFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.checkFlight === flight) this.checkFlight = null;
    }
  }
  async retry() {
    if (this.createGeneration === this.generation || this.value.checking)
      return;
    if (this.value.qr) {
      await this.check();
      if (!["expired", "failed"].includes(this.value.phase)) return;
    }
    // The same existing backend endpoint must reconcile/reuse an earlier attempt.
    // It refuses a new QR if previous provider state cannot be established.
    await this.create();
  }
  async resume() {
    if (!["success", "settled"].includes(this.value.phase) && this.value.qr)
      await this.check();
  }
}
