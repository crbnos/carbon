import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import {
  createRampReimbursement,
  RAMP_REIMBURSEMENT_ENTITY_TYPE,
  type RampReimbursementDraft
} from "./ramp-sync-reimbursement";

/**
 * The create-only rule, against a real Postgres.
 *
 * `RUN_RAMP_DB_TESTS=true SUPABASE_DB_URL=... pnpm --filter @carbon/jobs test`
 */
describe.skipIf(process.env.RUN_RAMP_DB_TESTS !== "true")(
  "Ramp reimbursement import (Postgres)",
  () => {
    let db: Kysely<KyselyDatabase>;
    let scope: {
      companyId: string;
      currencyCode: string;
      employeeId: string;
      accountA: string;
      accountB: string;
    };
    const remoteIds: string[] = [];

    beforeAll(async () => {
      db = getJobDatabaseClient(2);
      const row = await db
        .selectFrom("company")
        .innerJoin("employee", "employee.companyId", "company.id")
        .select([
          "company.id as companyId",
          "company.baseCurrencyCode as currencyCode",
          "company.companyGroupId as companyGroupId",
          "employee.id as employeeId"
        ])
        .limit(1)
        .executeTakeFirstOrThrow();
      if (!row.currencyCode) throw new Error("Fixture currency missing");
      const accounts = await db
        .selectFrom("account")
        .select("id")
        .where("companyGroupId", "=", row.companyGroupId)
        .where("class", "=", "Expense")
        .where("active", "=", true)
        .where("isGroup", "=", false)
        .orderBy("id")
        .limit(2)
        .execute();
      if (accounts.length < 2) throw new Error("Fixture accounts missing");
      scope = {
        companyId: row.companyId,
        currencyCode: row.currencyCode,
        employeeId: row.employeeId,
        accountA: accounts[0]!.id,
        accountB: accounts[1]!.id
      };
    });

    afterAll(async () => {
      if (!scope || remoteIds.length === 0) return;
      const mappings = await db
        .selectFrom("externalIntegrationMapping")
        .select("entityId")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", RAMP_REIMBURSEMENT_ENTITY_TYPE)
        .where("externalId", "in", remoteIds)
        .execute();
      await db
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where("externalId", "in", remoteIds)
        .execute();
      if (mappings.length) {
        await db
          .deleteFrom("reimbursement")
          .where("companyId", "=", scope.companyId)
          .where(
            "id",
            "in",
            mappings.map((row) => row.entityId)
          )
          .execute();
      }
    });

    function draft(
      remoteId: string,
      overrides: Partial<RampReimbursementDraft> = {}
    ): RampReimbursementDraft {
      return {
        companyId: scope.companyId,
        actorId: "system",
        reimbursementRemoteId: remoteId,
        employeeId: scope.employeeId,
        reference: `RAMP-REIMB-${remoteId}`,
        currencyCode: scope.currencyCode,
        exchangeRate: 1,
        amount: 25,
        reimbursementDate: "2026-09-11",
        postingDate: "2026-09-12",
        lines: [
          {
            accountId: scope.accountA,
            costCenterId: null,
            projectId: null,
            amount: 25,
            description: "Reimbursement expense"
          }
        ],
        payout: null,
        ...overrides
      };
    }

    function newRemoteId() {
      const id = crypto.randomUUID();
      remoteIds.push(id);
      return id;
    }

    async function readLines(reimbursementRowId: string) {
      return db
        .selectFrom("reimbursementLine")
        .select([
          "id",
          "accountId",
          "amount",
          "description",
          "sequence",
          "costCenterId",
          "projectId"
        ])
        .where("reimbursementId", "=", reimbursementRowId)
        .where("companyId", "=", scope.companyId)
        .orderBy("sequence")
        .execute();
    }

    it("creates a Draft with its imported coding lines", async () => {
      const remoteId = newRemoteId();
      const created = await createRampReimbursement(db, draft(remoteId));
      expect(created.created).toBe(true);
      expect(created.status).toBe("Draft");
      expect(created.readableId).toMatch(/^REIMB-/);

      const header = await db
        .selectFrom("reimbursement")
        .selectAll()
        .where("id", "=", created.reimbursementRowId)
        .where("companyId", "=", scope.companyId)
        .executeTakeFirstOrThrow();
      expect(header.status).toBe("Draft");
      expect(header.integration).toBe("ramp");
      expect(header.employeeId).toBe(scope.employeeId);
      expect(header.reference).toBe(`RAMP-REIMB-${remoteId}`);
      expect(header.journalId).toBeNull();
      expect(header.postedAt).toBeNull();

      const lines = await readLines(created.reimbursementRowId);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        accountId: scope.accountA,
        amount: 25,
        sequence: 0
      });
    });

    it("records a Ramp-paid payout intent on the mapping instead of settling", async () => {
      const remoteId = newRemoteId();
      const created = await createRampReimbursement(
        db,
        draft(remoteId, {
          payout: {
            rampPaymentId: `reimbursement-payment:${remoteId}`,
            paidAt: "2026-09-12",
            bankAccountId: "bank-fixture",
            amount: 25,
            currencyCode: scope.currencyCode,
            exchangeRate: 1
          }
        })
      );
      const mapping = await db
        .selectFrom("externalIntegrationMapping")
        .select("metadata")
        .where("companyId", "=", scope.companyId)
        .where("integration", "=", "ramp")
        .where("entityType", "=", RAMP_REIMBURSEMENT_ENTITY_TYPE)
        .where("externalId", "=", remoteId)
        .executeTakeFirstOrThrow();
      expect(mapping.metadata).toMatchObject({
        rampPaymentId: `reimbursement-payment:${remoteId}`,
        paidAt: "2026-09-12",
        bankAccountId: "bank-fixture",
        exchangeRate: 1
      });
      // Still Draft: an already-paid reimbursement is not auto-posted.
      const header = await db
        .selectFrom("reimbursement")
        .select("status")
        .where("id", "=", created.reimbursementRowId)
        .where("companyId", "=", scope.companyId)
        .executeTakeFirstOrThrow();
      expect(header.status).toBe("Draft");
    });

    it("serializes concurrent imports on the tenant-scoped reimbursement key", async () => {
      const remoteId = newRemoteId();
      const [first, second] = await Promise.all([
        createRampReimbursement(db, draft(remoteId)),
        createRampReimbursement(db, draft(remoteId))
      ]);
      expect(second.reimbursementRowId).toBe(first.reimbursementRowId);
      expect([first.created, second.created].sort()).toEqual([false, true]);

      const [headers, mappings] = await Promise.all([
        db
          .selectFrom("reimbursement")
          .select("id")
          .where("companyId", "=", scope.companyId)
          .where("reference", "=", `RAMP-REIMB-${remoteId}`)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("companyId", "=", scope.companyId)
          .where("integration", "=", "ramp")
          .where("entityType", "=", RAMP_REIMBURSEMENT_ENTITY_TYPE)
          .where("externalId", "=", remoteId)
          .execute()
      ]);
      expect(headers).toHaveLength(1);
      expect(mappings).toHaveLength(1);
    });

    it("rolls back the header and the mapping on a mid-write line failure", async () => {
      const remoteId = newRemoteId();
      await expect(
        createRampReimbursement(
          db,
          draft(remoteId, {
            lines: [
              {
                accountId: `acct_missing_${crypto.randomUUID()}`,
                costCenterId: null,
                projectId: null,
                amount: 25,
                description: "Unknown account"
              }
            ]
          })
        )
      ).rejects.toThrow();

      const [headers, mappings] = await Promise.all([
        db
          .selectFrom("reimbursement")
          .select("id")
          .where("companyId", "=", scope.companyId)
          .where("reference", "=", `RAMP-REIMB-${remoteId}`)
          .execute(),
        db
          .selectFrom("externalIntegrationMapping")
          .select("id")
          .where("companyId", "=", scope.companyId)
          .where("externalId", "=", remoteId)
          .execute()
      ]);
      expect(headers).toEqual([]);
      expect(mappings).toEqual([]);
    });

    it("leaves a reviewer's edits intact when the same Ramp payload re-syncs", async () => {
      const remoteId = newRemoteId();
      const first = await createRampReimbursement(db, draft(remoteId));
      const originalLines = await readLines(first.reimbursementRowId);
      const editedLineId = originalLines[0]!.id;

      // A reviewer re-codes the imported line, changes its amount, and adds a
      // second coding line — then the hourly sweep runs again.
      await db
        .updateTable("reimbursementLine")
        .set({
          accountId: scope.accountB,
          amount: 15,
          description: "Re-coded by a human"
        })
        .where("id", "=", editedLineId)
        .where("companyId", "=", scope.companyId)
        .execute();
      const addedLine = await db
        .insertInto("reimbursementLine")
        .values({
          reimbursementId: first.reimbursementRowId,
          companyId: scope.companyId,
          accountId: scope.accountA,
          costCenterId: null,
          projectId: null,
          description: "Added by a human",
          amount: 10,
          sequence: 1,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .updateTable("reimbursement")
        .set({ reference: "Edited by a human", notes: "keep me" })
        .where("id", "=", first.reimbursementRowId)
        .where("companyId", "=", scope.companyId)
        .execute();

      const before = await readLines(first.reimbursementRowId);

      // Same Ramp id, DIFFERENT payload — the provider "corrected" its coding.
      const second = await createRampReimbursement(
        db,
        draft(remoteId, {
          amount: 99,
          reference: `RAMP-REIMB-${remoteId}`,
          lines: [
            {
              accountId: scope.accountA,
              costCenterId: null,
              projectId: null,
              amount: 99,
              description: "Provider correction"
            }
          ]
        })
      );
      expect(second.created).toBe(false);
      expect(second.reimbursementRowId).toBe(first.reimbursementRowId);

      const after = await readLines(first.reimbursementRowId);
      // Compare IDS, not only values: a delete-then-reinsert would reproduce
      // the same values under new ids and must fail here.
      expect(after).toEqual(before);
      expect(after.map((line) => line.id)).toEqual([
        editedLineId,
        addedLine.id
      ]);

      const header = await db
        .selectFrom("reimbursement")
        .select(["amount", "reference", "notes", "status"])
        .where("id", "=", first.reimbursementRowId)
        .where("companyId", "=", scope.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({
        amount: 25,
        reference: "Edited by a human",
        notes: "keep me",
        status: "Draft"
      });
    });
  }
);
