import fs from 'node:fs';

const file = 'src/server.ts';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('SAFEHOUSE_RUNTIME_BACKEND_V1')) {
  console.log('SafeHouse backend runtime stability already applied.');
  process.exit(0);
}

function exact(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Backend runtime stability failed: ${label}`);
  s = s.replace(oldText, newText);
}

function regex(re, replacement, label) {
  if (!re.test(s)) throw new Error(`Backend runtime stability failed: ${label}`);
  s = s.replace(re, replacement);
}

exact(
  '// SAFEHOUSE_FINANCIAL_CONTEXT_V1 — every financial read/write is scoped by owner + property + period.',
  '// SAFEHOUSE_FINANCIAL_CONTEXT_V1 — every financial read/write is scoped by owner + property + period.\n// SAFEHOUSE_RUNTIME_BACKEND_V1 — resilient request validation and mutation responses.',
  'runtime marker'
);

// Be tolerant of values arriving from Android/WebView forms while keeping the same limits.
regex(
  /const studentCreateSchema = z\.object\(\{[\s\S]*?\n\}\);\n\nowner\.post\("\/students"/,
  `const studentCreateSchema = z.object({\n  fullName: z.string().trim().min(2).max(100),\n  email: z.string().trim().email(),\n  mobile: z.string().trim().min(10).max(20),\n  roomId: z.preprocess((v) => v === "" ? null : v, z.string().min(1).nullable().optional()),\n  bedLabel: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, z.string().trim().max(30).nullable().optional()),\n  joiningDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/, "Joining date must be YYYY-MM-DD"),\n  monthlyRent: z.coerce.number().finite().positive().max(1_000_000),\n  securityDeposit: z.coerce.number().finite().min(0).max(10_000_000).default(0),\n  rentDueDay: z.coerce.number().int().min(1).max(28).default(5),\n  tempPassword: z.string().min(8).max(128),\n  notes: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, z.string().trim().max(1000).nullable().optional())\n});\n\nowner.post("/students"`,
  'student create schema'
);

regex(
  /const studentUpdateSchema = z\.object\(\{[\s\S]*?\n\}\);\n\nowner\.patch\("\/students\/:id"/,
  `const studentUpdateSchema = z.object({\n  fullName: z.string().trim().min(2).max(100).optional(),\n  email: z.string().trim().email().optional(),\n  mobile: z.string().trim().min(10).max(20).optional(),\n  roomId: z.preprocess((v) => v === "" ? null : v, z.string().min(1).nullable().optional()),\n  bedLabel: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, z.string().trim().max(30).nullable().optional()),\n  monthlyRent: z.coerce.number().finite().positive().max(1_000_000).optional(),\n  securityDeposit: z.coerce.number().finite().min(0).max(10_000_000).optional(),\n  rentDueDay: z.coerce.number().int().min(1).max(28).optional(),\n  status: z.enum(["ACTIVE", "INACTIVE", "MOVED_OUT"]).optional(),\n  notes: z.preprocess((v) => typeof v === "string" && v.trim() === "" ? null : v, z.string().trim().max(1000).nullable().optional())\n});\n\nowner.patch("/students/:id"`,
  'student update schema'
);

// Make create-student consistent with the property/month selected in the app.
exact(
  `owner.post("/students", async (req, res) => {\n  const property = await ownerPropertyOrThrow(req.authUser!.id, req);\n  const input = studentCreateSchema.parse(req.body);`,
  `owner.post("/students", async (req, res) => {\n  const property = await ownerPropertyOrThrow(req.authUser!.id, req);\n  const requestedPeriodValue = requestedPeriod(req, property.timezone);\n  const input = studentCreateSchema.parse(req.body);`,
  'student create selected period'
);

exact(
  `  await ensureInvoices(property.id);\n  res.status(201).json({ student: studentDto({ ...created, invoices: [] }) });\n});`,
  `  await ensureInvoices(property.id, requestedPeriodValue.year, requestedPeriodValue.month);\n  res.status(201).json({\n    property: propertyDto(property),\n    period: requestedPeriodValue,\n    student: studentDto({ ...created, invoices: [] })\n  });\n});`,
  'student create response context'
);

// Coercion here protects the API from string numbers from any future client as well.
exact(
  `const input = z.object({ number: z.string().trim().min(1).max(30), capacity: z.number().int().min(1).max(50) }).parse(req.body);`,
  `const input = z.object({ number: z.string().trim().min(1).max(30), capacity: z.coerce.number().int().min(1).max(50) }).parse(req.body);`,
  'room create coercion'
);
exact(
  `const input = z.object({ number: z.string().trim().min(1).max(30).optional(), capacity: z.number().int().min(1).max(50).optional(), active: z.boolean().optional() }).parse(req.body);`,
  `const input = z.object({ number: z.string().trim().min(1).max(30).optional(), capacity: z.coerce.number().int().min(1).max(50).optional(), active: z.boolean().optional() }).parse(req.body);`,
  'room update coercion'
);
exact(
  `const input = z.object({ electricity: z.number().min(0).optional(), lateFee: z.number().min(0).optional(), otherCharges: z.number().min(0).optional(), discount: z.number().min(0).optional(), notes: z.string().max(1000).nullable().optional() }).parse(req.body);`,
  `const input = z.object({ electricity: z.coerce.number().finite().min(0).optional(), lateFee: z.coerce.number().finite().min(0).optional(), otherCharges: z.coerce.number().finite().min(0).optional(), discount: z.coerce.number().finite().min(0).optional(), notes: z.string().max(1000).nullable().optional() }).parse(req.body);`,
  'invoice charge coercion'
);
exact(
  `const input = z.object({ amount: z.number().positive().optional(), method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).default("CASH") }).parse(req.body || {});`,
  `const input = z.object({ amount: z.coerce.number().finite().positive().optional(), method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]).default("CASH") }).parse(req.body || {});`,
  'manual payment coercion'
);

// Return the exact invalid field instead of an opaque "Invalid request".
exact(
  `app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));\napp.use((error: any, _req: Request, res: Response, _next: NextFunction) => {\n  if (error instanceof z.ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.flatten() } });`,
  `app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));\napp.use((error: any, _req: Request, res: Response, _next: NextFunction) => {\n  if (error instanceof z.ZodError) {\n    const details = error.flatten();\n    const fields = details.fieldErrors as Record<string, string[] | undefined>;\n    const first = Object.entries(fields).find(([, messages]) => !!messages?.length);\n    const message = first?.[1]?.[0] ? first[0] + ': ' + first[1][0] : (details.formErrors[0] || "Invalid request");\n    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message, details } });\n  }`,
  'validation diagnostics'
);

fs.writeFileSync(file, s);
console.log('SafeHouse backend runtime stability applied.');
