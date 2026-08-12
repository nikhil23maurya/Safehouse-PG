import fs from 'node:fs';

const file = process.env.SAFEHOUSE_MOBILE_HTML || 'mobile/app/src/main/assets/index.html';
const s = fs.readFileSync(file, 'utf8');
const required = [
  'SAFEHOUSE_RUNTIME_STABILITY_V1',
  '.search-wrap{',
  '.filter-chip{',
  "formControl(form,name)",
  "formValue(form,'name')",
  "formValue(form,'method')",
  "'/api/owner/students?'+contextQuery()",
  "S.roomsLoaded=false",
  "[data-student-filter].active",
  "details?.fieldErrors"
];
const missing = required.filter((x) => !s.includes(x));
if (missing.length) throw new Error(`Missing mobile runtime contract: ${missing.join(', ')}`);

const forbidden = [
  'form.name.value',
  'form.method.value',
  "$('.chip.active')?.dataset.studentFilter",
  "async function ensureRooms(){if(!S.rooms.length)"
];
const present = forbidden.filter((x) => s.includes(x));
if (present.length) throw new Error(`Unsafe mobile patterns still present: ${present.join(', ')}`);

console.log('SafeHouse mobile runtime contract verified.');
