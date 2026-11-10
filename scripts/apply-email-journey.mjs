import fs from 'node:fs';
const path='src/server.ts';
let source=fs.readFileSync(path,'utf8');
if(source.includes('PGONE_EMAIL_JOURNEY_V1')) process.exit(0);
function between(start,end,replacement){const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw new Error(`Missing email integration boundary: ${start}`);source=source.slice(0,a)+replacement+source.slice(b);}
source=source.replace('import { processMerchantWebhook } from "./platform/cashfree-merchant.js";',
  'import { emailLoginHandler, legacyRefreshHandler } from "./platform/email-auth.js";\nimport { accountWebRouter } from "./platform/account-web.js";\n// PGONE_EMAIL_JOURNEY_V1');
between('app.post("/api/platform-webhooks/merchant"','app.use(express.json',
  'app.post("/api/platform-webhooks/merchant", (_req,_res)=>{throw new AppError(410,"PROVIDER_RETIRED","Merchant provider retired; historical records remain preserved.");});\n');
source=source.replace('app.use("/billing", billingWebRouter);','app.use("/billing", billingWebRouter);\napp.use("/account", accountWebRouter);');
source=source.replaceAll('Cashfree','provider');
between('app.post("/api/auth/login",','app.post("/api/auth/refresh"',
  'app.post("/api/auth/login", loginLimiter, (_req,_res)=>{throw new AppError(426,"APP_UPDATE_REQUIRED","Install the current PGOne app and sign in with email and password.");});\n\n');
between('app.post("/api/auth/refresh"','app.get("/api/auth/me"',
  'app.post("/api/auth/refresh", loginLimiter, legacyRefreshHandler);\n\n');
source=source.replace('tempPassword: z.string().min(8).max(128),','tempPassword: z.string().min(8).max(128).optional(),');
source=source.replace('const passwordHash = await hashPassword(input.tempPassword);',
  'const passwordHash = null; // Residents choose credentials privately through email registration.');
source=source.replace('role: "STUDENT", mustChangePassword: true','role: "STUDENT", mustChangePassword: false');
between('owner.post("/students/:id/reset-password"','owner.get("/rooms"',
  'owner.post("/students/:id/reset-password", (_req,_res) => { throw new AppError(410,"PRIVATE_ACCOUNT_RECOVERY","Residents control their passwords. Use an email invitation or Forgot Password."); });\n\n');
source=source.replace('await bootstrapOwner();','if (process.env.PGONE_PLATFORM_ENABLED !== \"true\") await bootstrapOwner(); // Fresh platform signup never creates a fixed bootstrap owner.');
fs.writeFileSync(path,source);
