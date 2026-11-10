import test,{after} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
const url=new URL(process.env.DATABASE_URL||"invalid:");
assert.equal(process.env.NODE_ENV,"test");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/pgone_test");
const pool=new pg.Pool({connectionString:url.href});after(async()=>{await pool.end();});
test("migration preserves the legacy financial baseline and its foreign keys exactly",async()=>{
  const {rows}=await pool.query(`SELECT i.id,i."propertyId",i."studentId",i."totalPaise",i."paidPaise",p."amountPaise",p."receiptNumber",p.source,p.method FROM "RentInvoice" i JOIN "Payment" p ON p."invoiceId"=i.id WHERE i.id='migration-invoice'`);
  assert.equal(rows.length,1);assert.deepEqual(rows[0],{id:"migration-invoice",propertyId:"migration-property",studentId:"migration-student",totalPaise:850000,paidPaise:100000,amountPaise:100000,receiptNumber:"SYNTHETIC-MIGRATION-RECEIPT",source:"MANUAL",method:"BANK_TRANSFER"});
});
