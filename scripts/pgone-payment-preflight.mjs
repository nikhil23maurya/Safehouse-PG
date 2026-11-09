import "dotenv/config";

// Optional CLI. Render Free users receive the same redacted report in Logs.
try {
  const { configuredPaymentPreflight } = await import("../src/platform/payment-preflight.ts");
  console.log(JSON.stringify(await configuredPaymentPreflight(), null, 2));
} catch {
  console.log(JSON.stringify({ configurationAvailable: false, note: "Run this command in the configured backend environment. No credentials were printed." }, null, 2));
  process.exitCode = 1;
}
