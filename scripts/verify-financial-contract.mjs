import fs from 'node:fs';

const server = fs.readFileSync('src/server.ts', 'utf8');
const rent = fs.readFileSync('src/rent.ts', 'utf8');
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const checks = [
  [server.includes('SAFEHOUSE_FINANCIAL_CONTEXT_V1'), 'financial context backend marker'],
  [server.includes('owner.get("/students"') && server.includes('const { year, month } = requestedPeriod(req, property.timezone);'), 'students period parsing'],
  [server.includes('invoices: { where: { year, month }, take: 1 }'), 'students period invoice query'],
  [server.includes('periodInvoice:'), 'period invoice DTO'],
  [server.includes('invoice: { is: { year, month } }'), 'payment invoice-period filter'],
  [server.includes('prisma.$transaction(async (tx) =>') && server.includes('PROPERTY_CREATED'), 'transactional property creation'],
  [server.includes('tx.rentRevision.upsert'), 'rent revision write'],
  [server.includes('appliedToSelectedInvoice'), 'selected-period rent semantics'],
  [schema.includes('model RentRevision'), 'rent revision schema'],
  [rent.includes('rentRevisions:') && rent.includes('resolvedRentPaise'), 'deterministic rent resolution'],
  [rent.includes('existing.paymentAttempts.length === 0'), 'invoice mutation lock']
];

const failed = checks.filter(([ok]) => !ok);
for (const [ok, name] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (failed.length) {
  console.error(`Financial contract failed: ${failed.map(([, name]) => name).join(', ')}`);
  process.exit(1);
}
console.log('SafeHouse financial contract verified.');
