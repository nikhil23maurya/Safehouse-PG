import fs from 'node:fs';

const file='mobile/app/src/main/assets/index.html';
let html=fs.readFileSync(file,'utf8');
if(html.includes('SAFEHOUSE_ATELIER_V3')){console.log('SafeHouse Atelier v3 already installed');process.exit(0)}
if(!html.includes('</style>')||!html.includes('</script>'))throw new Error('SafeHouse Atelier: HTML boundaries missing');
const styles=['scripts/safehouse-atelier-v3.css','scripts/safehouse-atelier-payment-v3.css','scripts/safehouse-atelier-notifications-v3.css','scripts/safehouse-professional-v4.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const layouts=fs.readFileSync('scripts/safehouse-atelier-v3.js','utf8');
const checkout=fs.readFileSync('scripts/safehouse-atelier-payment-v3.js','utf8');
if(!layouts.includes('SAFEHOUSE_ATELIER_V3') || !checkout.includes('SAFEHOUSE_QR_CHECKOUT_V3'))throw new Error('SafeHouse Atelier: JS markers missing');
html=html.replace('</style>','\n'+styles+'\n</style>');
// The existing workflow inserted boot() before our patch. Move invocation to
// the very end so all redesigned screens and SafeHouse Pay handlers are installed first.
const bootMarker=String.fromCharCode(10)+'boot();'+String.fromCharCode(10);
if(!html.includes(bootMarker))throw new Error('SafeHouse Atelier: expected boot() entrypoint missing');
html=html.replace(bootMarker,String.fromCharCode(10));
html=html.replace('</script>', '\n/* SAFEHOUSE_ATELIER_V3 installed */\n'+layouts+'\n'+checkout+'\nboot();\n</script>');
fs.writeFileSync(file,html);
console.log('SafeHouse Atelier v3: entire app layouts and provider-verified branded payments installed');
