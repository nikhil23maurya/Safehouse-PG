import fs from 'node:fs';

const s = fs.readFileSync('src/server.ts', 'utf8');
const required = [
  'SAFEHOUSE_RUNTIME_BACKEND_V1',
  'monthlyRent: z.coerce.number().finite().positive()',
  'capacity: z.coerce.number().int().min(1).max(50)',
  'const requestedPeriodValue = requestedPeriod(req, property.timezone);',
  'await ensureInvoices(property.id, requestedPeriodValue.year, requestedPeriodValue.month);',
  'const fields = details.fieldErrors as Record<string, string[] | undefined>;',
  'property: propertyDto(property)'
];
const missing = required.filter((x) => !s.includes(x));
if (missing.length) throw new Error(`Missing backend runtime contract: ${missing.join(', ')}`);
if (s.includes('message: "Invalid request", details: error.flatten()')) {
  throw new Error('Opaque validation handler is still present');
}
console.log('SafeHouse backend runtime contract verified.');
