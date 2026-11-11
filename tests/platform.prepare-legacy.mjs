import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import pg from "pg";
const url=new URL(process.env.DATABASE_URL||"invalid:");
if(process.env.NODE_ENV!=="test"||url.hostname!=="127.0.0.1"||url.pathname!=="/pgone_test")throw new Error("Legacy staging requires the isolated CI database");
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"pgone-new-migrations-"));
const future=fs.readdirSync("prisma/migrations").filter(name=>/^\d{14}_/.test(name)&&name>="20261110000000");
try {
  for(const name of future)fs.renameSync(`prisma/migrations/${name}`,path.join(temporary,name));
  execFileSync(process.platform==="win32"?"npx.cmd":"npx",["prisma","migrate","deploy"],{stdio:"inherit"});
} finally {for(const name of future)if(fs.existsSync(path.join(temporary,name)))fs.renameSync(path.join(temporary,name),`prisma/migrations/${name}`);}
const client=new pg.Client({connectionString:url.href});await client.connect();
try {
  await client.query(`INSERT INTO "User" (id,"fullName",role,"updatedAt") VALUES ('migration-owner','Synthetic migration owner','OWNER',now()),('migration-resident','Synthetic migration resident','STUDENT',now());
    INSERT INTO "Property" (id,name,"ownerId","updatedAt") VALUES ('migration-property','Synthetic migration PG','migration-owner',now());
    INSERT INTO "Student" (id,"propertyId","userId",mobile,"joiningDate","monthlyRentPaise","updatedAt") VALUES ('migration-student','migration-property','migration-resident','9123456789',now(),850000,now());
    INSERT INTO "RentInvoice" (id,"propertyId","studentId",year,month,"dueDate","rentPaise","totalPaise","paidPaise","updatedAt") VALUES ('migration-invoice','migration-property','migration-student',2026,11,now(),850000,850000,100000,now());
    INSERT INTO "Payment" (id,"propertyId","studentId","invoiceId","amountPaise",source,method,"receiptNumber","paidAt") VALUES ('migration-payment','migration-property','migration-student','migration-invoice',100000,'MANUAL','BANK_TRANSFER','SYNTHETIC-MIGRATION-RECEIPT',now());`);
  await client.query(`INSERT INTO "PgAccount" (id,"legacyUserId","updatedAt") VALUES ('migration-account','migration-owner',now());
    INSERT INTO "PgOrganisation" (id,"ownerAccountId","legacyOwnerId",name,"updatedAt") VALUES ('migration-org','migration-account','migration-owner','Synthetic historical fee',now());
    INSERT INTO "PgPlanOrder" (id,"organisationId","requestKey","receiptReference","providerOrderId","providerKeyId","amountPaise","taxPaise",status,open,"updatedAt") VALUES ('migration-plan','migration-org','synthetic-migration-plan-key','synthetic-migration-plan','order_SYNTHETICOLD249','synthetic-key',24900,0,'CAPTURED',false,now());
    INSERT INTO "PgPlanReceipt" (id,"organisationId","orderId","providerPaymentId","receiptNumber","amountPaise","taxPaise","paidAt","periodStart","periodEnd","anchorDay","updatedAt") VALUES ('migration-plan-receipt','migration-org','migration-plan','pay_SYNTHETICOLD249','SYNTHETIC-OLD-249',24900,0,'2026-11-09T10:00:00Z','2026-11-09T10:00:00Z','2026-12-09T10:00:00Z',9,now());`);
  console.log("Synthetic legacy rent and historical INR249 fee baseline prepared; no live credentials or data used.");
}finally{await client.end();}
