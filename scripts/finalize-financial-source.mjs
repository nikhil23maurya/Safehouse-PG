import fs from 'node:fs';

const file = 'src/server.ts';
let s = fs.readFileSync(file, 'utf8');

const fixes = [
  ['const studentCreateSchemaconst studentCreateSchema', 'const studentCreateSchema'],
  ['const studentUpdateSchemaconst studentUpdateSchema', 'const studentUpdateSchema']
];

for (const [bad, good] of fixes) s = s.replaceAll(bad, good);

fs.writeFileSync(file, s);
console.log('SafeHouse financial generated source normalized.');
