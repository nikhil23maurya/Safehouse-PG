import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = 'src/server.ts';
const patch = 'patches/safehouse2-server.patch';
const source = fs.readFileSync(target, 'utf8');
if (source.includes('owner.get("/properties"') && source.includes('CURRENT_INVOICE_UNPAID')) {
  console.log('SafeHouse 2 backend patch already applied.');
  process.exit(0);
}
execFileSync('git', ['apply', '--whitespace=nowarn', patch], { stdio: 'inherit' });
console.log('SafeHouse 2 backend patch applied.');
