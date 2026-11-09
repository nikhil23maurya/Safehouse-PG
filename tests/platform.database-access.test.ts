import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL || "invalid:");
assert.equal(process.env.NODE_ENV,"test");
assert.ok(["127.0.0.1","localhost"].includes(url.hostname));
assert.equal(url.pathname,"/pgone_test","Permission tests must never run on a hosted database");
const pool = new pg.Pool({connectionString:url.href});
after(async()=>{await pool.end();});
const models = [...readFileSync("prisma/schema.prisma","utf8").matchAll(/^model (\w+) \{/gm)].map(m=>m[1]!);
const tables = [...models,"_prisma_migrations"];

test("all application tables deny direct public Data API roles while the backend owner retains access",async()=>{
  const rows=await pool.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
    pg_get_userbyid(c.relowner) AS owner_role, current_user AS backend_role
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])`,[tables]);
  assert.equal(rows.rowCount,tables.length);
  for(const table of rows.rows){
    assert.equal(table.relrowsecurity,true,`${table.relname}: RLS must be enabled`);
    assert.equal(table.relforcerowsecurity,false,`${table.relname}: do not change owner bypass`);
    assert.equal(table.owner_role,table.backend_role);
    for(const role of ["anon","authenticated","pgone_public_probe"]){
      const result=await pool.query(`SELECT bool_or(has_table_privilege($1::name,format('public.%I',$2::text),p)) AS permitted
        FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,[role,table.relname]);
      assert.equal(result.rows[0].permitted,false,`${role} must have no direct privileges on ${table.relname}`);
    }
  }
  assert.ok((await pool.query('SELECT id FROM "PgAccount" LIMIT 0')).rows);
  assert.ok((await pool.query('SELECT id FROM "RentInvoice" LIMIT 0')).rows);
});

test("anonymous, authenticated and PUBLIC-only callers cannot read or write financial/account tables",async()=>{
  for(const role of ["anon","authenticated","pgone_public_probe"]){
    for(const statement of ['SELECT id FROM "PgPlanReceipt" LIMIT 0','SELECT id FROM "User" LIMIT 0',
      'UPDATE "PgPlanReceipt" SET "amountPaise"="amountPaise" WHERE false']){
      const client=await pool.connect();
      try {
        await client.query("BEGIN");await client.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(()=>client.query(statement),(error:any)=>error.code==="42501");
      } finally {await client.query("ROLLBACK");client.release();}
    }
  }
});

test("the migration is limited to app/internal tables and does not rewrite unrelated default grants",async()=>{
  await pool.query('CREATE TABLE "DataApiUnrelatedProbe" (id integer)');
  const result=await pool.query(`SELECT c.relrowsecurity, has_table_privilege('anon',c.oid,'SELECT') AS anonymous_read
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='DataApiUnrelatedProbe'`);
  assert.equal(result.rows[0].relrowsecurity,false);
  assert.equal(result.rows[0].anonymous_read,true);
});
