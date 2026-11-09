import pg from "pg";

// Isolated CI only: reproduce Supabase's historical public table grants before
// migrations, so the permission migration is tested against the actual risk.
const url = new URL(process.env.DATABASE_URL || "invalid:");
if (process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/pgone_test")
  throw new Error("Database permission fixture requires the isolated local pgone_test database.");
const pool = new pg.Pool({ connectionString: url.href });
try {
  for (const role of ["anon", "authenticated", "pgone_public_probe"]) {
    const exists = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (!exists.rowCount) await pool.query(`CREATE ROLE ${role} NOLOGIN`);
  }
  await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, PUBLIC");
  await pool.query('CREATE TABLE "DataApiUnrelatedProbe" (id integer)');
  console.log("Isolated public-grant fixture prepared; no hosted database is permitted.");
} finally { await pool.end(); }
