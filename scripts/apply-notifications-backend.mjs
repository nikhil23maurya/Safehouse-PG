import fs from 'node:fs';

const file = 'src/server.ts';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('SAFEHOUSE_NOTIFICATIONS_BACKEND_V1')) {
  console.log('SafeHouse notification backend already applied.');
  process.exit(0);
}

function exact(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Notification backend patch failed: ${label}`);
  s = s.replace(oldText, newText);
}

exact('import { streamReceiptPdf } from "./receipts.js";', 'import { streamReceiptPdf } from "./receipts.js";\nimport { notificationRouter, ownerNotificationRouter, startNotificationScheduler, notifyPaymentCaptured } from "./notifications.js";', 'notification import');
exact('app.use(express.json({ limit: "1mb" }));', 'app.use(express.json({ limit: "1mb" }));\napp.use("/api/notifications", notificationRouter);', 'notification router mount');
exact('// SAFEHOUSE_RUNTIME_BACKEND_V1 — resilient request validation and mutation responses.', '// SAFEHOUSE_RUNTIME_BACKEND_V1 — resilient request validation and mutation responses.\n// SAFEHOUSE_NOTIFICATIONS_BACKEND_V1 — FCM devices, owner campaigns, send-now and in-process scheduling.\nowner.use("/notifications", ownerNotificationRouter);', 'owner notification router');
exact(`          });\n        }\n      }\n    }\n  } else if (event.event === "payment.failed") {`, `          });\n          void notifyPaymentCaptured(attempt.invoiceId).catch((error) => console.error("SafeHouse payment push failed", error));\n        }\n      }\n    }\n  } else if (event.event === "payment.failed") {`, 'webhook payment notification');
exact(`  });\n  res.status(201).json({ payment: paymentDto(payment) });\n});\n\nowner.get("/payments",`, `  });\n  void notifyPaymentCaptured(invoice.id).catch((error) => console.error("SafeHouse manual payment push failed", error));\n  res.status(201).json({ payment: paymentDto(payment) });\n});\n\nowner.get("/payments",`, 'manual payment notification');
exact(`await bootstrapOwner();\nconst server = app.listen(config.PORT, "0.0.0.0", () => console.log(\`SafeHouse API listening on :\${config.PORT}\`));`, `await bootstrapOwner();\nconst server = app.listen(config.PORT, "0.0.0.0", () => console.log(\`SafeHouse API listening on :\${config.PORT}\`));\nconst stopNotificationScheduler = startNotificationScheduler();`, 'scheduler startup');
exact(`    server.close(async () => {\n      await prisma.$disconnect();`, `    server.close(async () => {\n      stopNotificationScheduler();\n      await prisma.$disconnect();`, 'scheduler shutdown');

fs.writeFileSync(file, s);
console.log('SafeHouse notification backend applied.');
