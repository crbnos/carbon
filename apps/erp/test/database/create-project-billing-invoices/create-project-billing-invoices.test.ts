// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { createProjectBillingInvoices } from "../../../app/modules/sales/sales.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { projectBillingTestFixture } from "../fixtures/project-billing";

// A Monthly / Calendar / Arrears contract from 2026-01-01: on 2026-03-05 the
// latest ended period is February.
const AS_OF = "2026-03-05";

databaseTest(
  "drafts one invoice for the period's items and stamps them Billed, once",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const project = await f.addProject("inv", "IN");
      const { contractId, lineId } = await f.addContract({
        key: "tm",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Labor",
          quantity: 6,
          amount: 600,
          laborCategoryId: f.laborCategoryId,
          postingDate: "2026-02-10"
        },
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 200,
          postingDate: "2026-02-12"
        },
        // March is not over yet: this item waits for the next invoice.
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 50,
          postingDate: "2026-03-02"
        }
      ]);

      const first = await invokePosting(
        handlesOf(f.ctx),
        "create-project-billing-invoices",
        { asOf: AS_OF },
        createProjectBillingInvoices
      );
      expect(first.error).toBeNull();
      expect(first.data?.failures).toEqual([]);
      expect(first.data?.invoices).toHaveLength(1);
      const invoiceId = first.data!.invoiceIds[0]!;

      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["status", "customerContractId", "subtotal"])
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(invoice.status).toBe("Draft");
      expect(invoice.customerContractId).toBe(contractId);
      expect(Number(invoice.subtotal)).toBe(1120);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "id",
          "description",
          "quantity",
          "unitPrice",
          "customerContractLineId",
          "customerContractInvoiceLineId"
        ])
        .where("invoiceId", "=", invoiceId)
        .orderBy("sortOrder")
        .execute();
      expect(
        lines.map((line) => [
          line.description,
          Number(line.quantity),
          Number(line.unitPrice),
          line.customerContractLineId,
          line.customerContractInvoiceLineId
        ])
      ).toEqual([
        ["Engineer II", 6, 150, lineId, null],
        ["Material", 1, 220, lineId, null]
      ]);

      const items = await f.items(project.projectId);
      const billed = items.filter((item) => item.status === "Billed");
      expect(billed.map((item) => Number(item.amount)).sort()).toEqual([
        220, 900
      ]);
      expect(
        billed.every((item) =>
          lines.some((line) => line.id === item.salesInvoiceLineId)
        )
      ).toBe(true);
      expect(
        items
          .filter((item) => item.status === "Unbilled")
          .map((item) => Number(item.amount))
      ).toEqual([55]);

      const second = await invokePosting(
        handlesOf(f.ctx),
        "create-project-billing-invoices",
        {
          asOf: AS_OF
        },
        createProjectBillingInvoices
      );
      expect(second.error).toBeNull();
      expect(second.data?.invoices).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "stops at the funded amount and holds the rest with Funding limit",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const project = await f.addProject("fund", "FU");
      await f.addContract({
        key: "tm",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0,
        fundedAmount: 10_000
      });
      await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 6000,
          postingDate: "2026-02-10"
        },
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 5000,
          postingDate: "2026-02-11"
        }
      ]);

      const result = await invokePosting(
        handlesOf(f.ctx),
        "create-project-billing-invoices",
        {
          asOf: AS_OF
        },
        createProjectBillingInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data?.invoices).toHaveLength(1);

      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select("subtotal")
        .where("id", "=", result.data!.invoiceIds[0]!)
        .executeTakeFirstOrThrow();
      expect(Number(invoice.subtotal)).toBe(6000);

      const items = await f.items(project.projectId);
      const byAmount = new Map(
        items.map((item) => [Number(item.amount), item])
      );
      expect(byAmount.get(6000)?.status).toBe("Billed");
      expect(byAmount.get(5000)?.status).toBe("Unbilled");
      expect(byAmount.get(5000)?.statusReason).toBe("Funding limit");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "bills a row written without the posting hook, as the job-completion SQL does",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const project = await f.addProject("sql", "SQ");
      await f.addContract({
        key: "tm",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0.1
      });
      // A direct insert, as `backflush_job_materials` writes it: no item.
      await f.db
        .insertInto("projectLedger")
        .values({
          companyId: f.companyId,
          projectId: project.projectId,
          projectElementId: project.childId,
          postingDate: "2026-02-20",
          costType: "Material",
          documentType: "Job Consumption",
          documentId: "job-1",
          quantity: 2,
          amount: 100,
          createdBy: f.userId
        })
        .execute();
      expect(await f.items(project.projectId)).toEqual([]);

      const result = await invokePosting(
        handlesOf(f.ctx),
        "create-project-billing-invoices",
        {
          asOf: AS_OF
        },
        createProjectBillingInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data?.invoices).toHaveLength(1);
      const items = await f.items(project.projectId);
      expect(items.map((item) => [Number(item.amount), item.status])).toEqual([
        [110, "Billed"]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "heads a CLIN's lines with a comment line and allocates it to the ACRNs",
  async () => {
    const f = await projectBillingTestFixture();
    try {
      const project = await f.addProject("clin", "CL");
      const { lineId } = await f.addContract({
        key: "tm",
        projectId: project.projectId,
        projectElementId: project.rootId,
        materialHandlingPercent: 0
      });
      await f.db
        .updateTable("customerContractLine")
        .set({ lineItemNumber: "0001" })
        .where("id", "=", lineId)
        .execute();
      await f.db
        .insertInto("customerContractFunding")
        .values({
          customerContractLineId: lineId,
          modificationNumber: "P00001",
          fundedDate: "2026-01-01",
          acrn: "AA",
          fundedCost: 500,
          fundedFee: 0,
          companyId: f.companyId,
          createdBy: f.userId
        })
        .execute();
      await f.post([
        {
          projectId: project.projectId,
          projectElementId: project.childId,
          costType: "Material",
          amount: 1000,
          postingDate: "2026-02-10"
        }
      ]);

      const result = await invokePosting(
        handlesOf(f.ctx),
        "create-project-billing-invoices",
        {
          asOf: AS_OF
        },
        createProjectBillingInvoices
      );
      expect(result.error).toBeNull();
      expect(result.data?.failures).toEqual([]);
      const invoiceId = result.data!.invoiceIds[0]!;

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select([
          "invoiceLineType",
          "description",
          "quantity",
          "unitPrice",
          "customerContractLineId"
        ])
        .where("invoiceId", "=", invoiceId)
        .orderBy("sortOrder")
        .execute();
      expect(lines.map((line) => line.invoiceLineType)).toEqual([
        "Comment",
        "Service"
      ]);
      expect(lines[0]!.description).toMatch(
        /^CLIN 0001 — .+: 1,000\.00 \(ACRN AA 500\.00; Unallocated 500\.00\)$/
      );
      expect(lines[0]!.customerContractLineId).toBeNull();
      expect(Number(lines[1]!.unitPrice)).toBe(1000);

      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select("subtotal")
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(Number(invoice.subtotal)).toBe(1000);

      const allocations = await f.db
        .selectFrom("salesInvoiceFundingAllocation")
        .select(["customerContractLineId", "acrn", "amount"])
        .where("salesInvoiceId", "=", invoiceId)
        .execute();
      expect(
        allocations.map((row) => [
          row.customerContractLineId,
          row.acrn,
          Number(row.amount)
        ])
      ).toEqual([[lineId, "AA", 500]]);
    } finally {
      await f.cleanup();
    }
  }
);
