import { spawnSync } from "node:child_process";

const migrations = [
  "20260810180000_init",
  "20260811201500_financial_context_hardening",
  "20260812174500_notifications_v1"
];

for (const migration of migrations) {
  const result = spawnSync(
    "npx",
    ["prisma", "migrate", "resolve", "--applied", migration],
    {
      encoding: "utf8",
      env: process.env
    }
  );

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  if (result.status === 0) {
    console.log(`[prisma-repair] marked ${migration} as applied`);
    continue;
  }

  if (/P3008|already recorded as applied/i.test(output)) {
    console.log(`[prisma-repair] ${migration} already applied; skipping`);
    continue;
  }

  console.error(`[prisma-repair] failed while resolving ${migration}`);
  if (output) console.error(output);
  process.exit(result.status ?? 1);
}

console.log("[prisma-repair] migration history reconciliation complete");
