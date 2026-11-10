import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = 'src/server.ts';
const patch = 'patches/safehouse2-server.patch';
const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(target, source);
if (source.includes('owner.get("/properties"') && (source.includes('CURRENT_INVOICE_UNPAID') || source.includes('SAFEHOUSE_FINANCIAL_CONTEXT_V1'))) {
  console.log('SafeHouse 2 backend patch already applied.');
  process.exit(0);
}
execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
  input: fs.readFileSync(patch, 'utf8').replace(/\r\n/g, '\n'),
  stdio: ['pipe', 'inherit', 'inherit'],
});
fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'));
console.log('SafeHouse 2 backend patch applied.');
