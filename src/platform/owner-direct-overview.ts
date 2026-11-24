import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";

export type OwnerOverviewView = "overview" | "proofs" | "electricity";

type ProofRow = {
  id: string;
  proofId: string;
  evidenceId: string;
  bankReference: string | null;
  meterEvidenceId: string | null;
  invoiceId: string;
  resident: string;
  room: string | null;
  rentPaise: number;
  electricityPaise: number;
  amountPaise: number;
  submittedAt: string;
};

type ElectricityRow = {
  id: string;
  resident: string;
  room: string | null;
  invoiceId: string;
  meterEvidenceId: string;
  amountPaise: number;
  status: "DUE" | "SUBMITTED" | "REJECTED" | "PAID";
  transferId: string | null;
};

type Overview = {
  summary: {
    proofCount: number;
    rentSubmittedPaise: number;
    electricityBilledPaise: number;
    electricityCollectedPaise: number;
    electricitySubmittedPaise: number;
    electricityBillCount: number;
  };
  proofs: ProofRow[];
  bills: ElectricityRow[];
  rentProofInvoiceIds: string[];
};

// The caller resolves ownership before reaching this read. Use the invoice's
// billing month so a late proof or confirmation stays with the correct bill.
export async function readOwnerDirectOverview(
  propertyId: string,
  period: { year: number; month: number },
  view: OwnerOverviewView,
  cursor?: string,
  dueInvoiceIds: string[] = [],
) {
  const limit = view === "overview" ? 3 : 20;
  const dueFilter = dueInvoiceIds.length
    ? Prisma.sql`p."invoiceId" IN (${Prisma.join(dueInvoiceIds)})`
    : Prisma.sql`false`;

  // A single statement gives the queue and totals the same snapshot. Each
  // electricity bill appears once, regardless of proof retries.
  const [data] = await prisma.$queryRaw<Overview[]>(Prisma.sql`
    WITH period_invoices AS (
      SELECT id, "studentId" FROM "RentInvoice"
      WHERE "propertyId" = ${propertyId} AND year = ${period.year} AND month = ${period.month}
    ), pending_proofs AS (
      SELECT t.id, p.id AS "proofId", p."evidenceId", p."bankReference", b."meterEvidenceId",
             t."invoiceId", t."rentPaise", t."electricityPaise",
             t."amountPaise", p."createdAt" AT TIME ZONE 'UTC' AS "submittedAt",
             u."fullName" AS resident, r.number AS room
      FROM period_invoices i
      JOIN "PgDirectTransfer" t ON t."invoiceId" = i.id AND t."studentId" = i."studentId"
      JOIN "PgTransferProof" p ON p."transferId" = t.id AND p.status = 'PENDING'
      LEFT JOIN "PgElectricityBill" b ON b.id = t."billId" AND b."invoiceId" = i.id
        AND b."studentId" = i."studentId" AND b."propertyId" = ${propertyId}
      JOIN "Student" s ON s.id = i."studentId" AND s."propertyId" = ${propertyId}
      JOIN "User" u ON u.id = s."userId"
      LEFT JOIN "Room" r ON r.id = s."roomId" AND r."propertyId" = ${propertyId}
      WHERE t."propertyId" = ${propertyId} AND t.status = 'SUBMITTED'
    ), electricity_bills AS (
      SELECT b.id, b."invoiceId", b."meterEvidenceId", b."amountPaise",
             u."fullName" AS resident, r.number AS room, transfer.id AS "transferId",
             CASE WHEN b.status = 'PAID' THEN 'PAID' ELSE COALESCE(transfer.status, 'DUE') END AS status
      FROM period_invoices i
      JOIN "PgElectricityBill" b ON b."invoiceId" = i.id AND b."studentId" = i."studentId"
      JOIN "Student" s ON s.id = i."studentId" AND s."propertyId" = ${propertyId}
      JOIN "User" u ON u.id = s."userId"
      LEFT JOIN "Room" r ON r.id = s."roomId" AND r."propertyId" = ${propertyId}
      LEFT JOIN LATERAL (
        SELECT t.id, t.status FROM "PgDirectTransfer" t
        WHERE t."billId" = b.id AND t."invoiceId" = i.id AND t."studentId" = i."studentId"
          AND t."propertyId" = ${propertyId}
          AND ((b.status = 'PAID' AND t.status = 'CONFIRMED')
            OR (b.status = 'DUE' AND t.status IN ('SUBMITTED', 'REJECTED')))
        ORDER BY t.id DESC
        LIMIT 1
      ) transfer ON true
      WHERE b."propertyId" = ${propertyId}
    )
    SELECT json_build_object(
      'proofCount', (SELECT count(*) FROM pending_proofs),
      'rentSubmittedPaise', (SELECT COALESCE(sum("rentPaise"), 0) FROM pending_proofs),
      'electricityBilledPaise', COALESCE(sum("amountPaise"), 0),
      'electricityCollectedPaise', COALESCE(sum("amountPaise") FILTER (WHERE status = 'PAID'), 0),
      'electricitySubmittedPaise', COALESCE(sum("amountPaise") FILTER (WHERE status = 'SUBMITTED'), 0),
      'electricityBillCount', count(*)
    ) AS summary,
    (SELECT COALESCE(json_agg(p ORDER BY p."proofId" DESC), '[]'::json) FROM (
      SELECT * FROM pending_proofs
      WHERE ${view !== "electricity"} AND (${cursor ?? null}::text IS NULL OR "proofId" < ${cursor ?? null})
      ORDER BY "proofId" DESC LIMIT ${limit + 1}
    ) p) AS proofs,
    (SELECT COALESCE(json_agg(b ORDER BY b.id DESC), '[]'::json) FROM (
      SELECT * FROM electricity_bills
      WHERE ${view === "electricity"} AND (${cursor ?? null}::text IS NULL OR id < ${cursor ?? null})
      ORDER BY id DESC LIMIT ${limit + 1}
    ) b) AS bills,
    (SELECT COALESCE(json_agg(DISTINCT p."invoiceId"), '[]'::json)
      FROM pending_proofs p WHERE p."rentPaise" > 0 AND ${dueFilter}) AS "rentProofInvoiceIds"
    FROM electricity_bills
  `);
  const rows = view === "electricity" ? data!.bills : data!.proofs;
  return {
    ...data!,
    proofs: data!.proofs.slice(0, limit),
    bills: data!.bills.slice(0, limit),
    nextCursor: rows.length > limit
      ? (view === "electricity" ? data!.bills[limit - 1]!.id : data!.proofs[limit - 1]!.proofId)
      : null,
  };
}
