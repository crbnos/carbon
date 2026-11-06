// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operations of the service module: customer assets and service jobs.
// The building blocks they run are in `service.service.ts`.

import { postServiceJobInput } from "@carbon/api/postings";
import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import { getCompanyTimeZone, type Json } from "@carbon/database";
import { rows } from "@carbon/database/row-schemas";
import { getLogger } from "@carbon/logger";
import {
  datetime,
  isServiceJobLocked,
  round,
  suggestCoverage
} from "@carbon/utils";
import { z } from "zod";
import * as inventoryPostings from "../inventory/inventory.service";
import {
  invokePosting,
  refuseKeyWithout,
  refuseUnlessOwned
} from "../shared/shared.service";
import {
  customerAssetPatchValidator,
  customerAssetValidator,
  SERVICE_JOB_STATUS_TRANSITIONS,
  serviceJobAssignmentMoveValidator,
  serviceJobAssignmentValidator,
  serviceJobDayHoursValidator,
  serviceJobEstimateLineValidator,
  serviceJobEstimateResponseValidator,
  serviceJobEstimateSendValidator,
  serviceJobItemValidator,
  serviceJobStatusValidator,
  serviceJobTimeValidator,
  serviceJobUpdateValidator,
  serviceJobValidator,
  warrantyStatuses
} from "./service.models";
import { renderServiceJobEstimatePdf } from "./service.pdf";
import * as service from "./service.service";

const logger = getLogger("erp", "service");

/** A child row of a job: the job and the row's id. */
const childRowInput = z.object({
  serviceJobId: z.string().min(1),
  id: z.string().min(1)
});

// --- Customer assets -------------------------------------------------------------

export const getCustomerAssets = defineServiceFn({
  publish: "read",
  title: "Get customer assets",
  description: `The installed base: one row per shipped or registered serial. The warranty
status is read on the company's today.`,
  output: z
    .array(
      rows.customerAsset
        .pick({
          id: true,
          trackedEntityId: true,
          itemId: true,
          customerId: true,
          customerLocationId: true,
          status: true,
          shippedDate: true,
          laborWarrantyEndDate: true,
          partsWarrantyEndDate: true,
          shipmentId: true,
          source: true,
          createdAt: true,
          updatedAt: true
        })
        .extend({
          notes: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          trackedEntity: z.object({
            id: z.string(),
            readableId: z.string().nullable()
          }),
          item: z.object({
            id: z.string(),
            readableIdWithRevision: z.string().nullable(),
            name: z.string()
          }),
          customer: z.object({
            id: z.string(),
            name: z.string()
          }),
          customerLocation: z
            .object({
              id: z.string(),
              name: z.string()
            })
            .nullable(),
          openServiceJobs: z.array(
            z.object({
              count: z.number()
            })
          )
        })
        .meta({ table: "customerAsset" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z
      .string()
      .nullable()
      .optional()
      .describe("Part of the serial number."),
    customerId: z.string().nullable().optional(),
    itemId: z.string().nullable().optional(),
    warrantyStatus: z.enum(warrantyStatuses).nullable().optional()
  }),
  permission: { view: "service" },
  async run(ctx, input) {
    const timeZone = await getCompanyTimeZone(
      ctx.asCaller.supabase,
      ctx.company.id
    );
    return paged(
      ctx,
      await service.getCustomerAssets(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, {
          ...input,
          search: input.search ?? null,
          warrantyStatus: input.warrantyStatus ?? null,
          today: datetime.today(timeZone).toString()
        }).build() as never
      )
    );
  }
});

export const getCustomerAsset = defineServiceFn({
  publish: "read",
  title: "Get customer asset",
  output: rows.customerAsset
    .pick({
      id: true,
      trackedEntityId: true,
      itemId: true,
      customerId: true,
      customerLocationId: true,
      status: true,
      shippedDate: true,
      laborWarrantyEndDate: true,
      partsWarrantyEndDate: true,
      shipmentId: true,
      source: true,
      createdAt: true,
      updatedAt: true
    })
    .extend({
      notes: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      trackedEntity: z.object({
        id: z.string(),
        readableId: z.string().nullable()
      }),
      item: z.object({
        id: z.string(),
        readableIdWithRevision: z.string().nullable(),
        name: z.string()
      }),
      customer: z.object({
        id: z.string(),
        name: z.string()
      }),
      customerLocation: z
        .object({
          id: z.string(),
          name: z.string()
        })
        .nullable(),
      openServiceJobs: z.array(
        z.object({
          count: z.number()
        })
      ),
      shipment: z
        .object({
          id: z.string(),
          shipmentId: z.string()
        })
        .nullable()
    })
    .meta({ table: "customerAsset" }),
  input: z.object({ id: z.string() }),
  permission: { view: "service" },
  async run(ctx, { id }) {
    return unwrap(
      ctx,
      await service.getCustomerAsset(ctx.asCaller.supabase, id, ctx.company.id)
    );
  }
});

export const registerCustomerAsset = defineServiceFn({
  publish: true,
  title: "Register a customer asset for a unit sold before Carbon",
  description: `A Consumed \`trackedEntity\` for the typed serial and the customer asset
(source Manual), in one transaction. A serial Carbon already tracks for the
item, or an item that is not serialized, is a \`rule\` error.`,
  output: rows.customerAsset
    .pick({ id: true })
    .meta({ table: "customerAsset" }),
  input: customerAssetValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    const refused =
      (await refuseUnlessOwned(ctx, "customer", { id: input.customerId })) ??
      (input.customerLocationId
        ? await refuseUnlessOwned(ctx, "customerLocation", {
            id: input.customerLocationId,
            customerId: input.customerId
          })
        : null);
    if (refused) return refused;

    try {
      return await service.registerCustomerAsset(ctx.asSystem.pg, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return err instanceof service.CustomerAssetError
        ? ctx.error("rule", err.message, err)
        : ctx.error("internal", "Failed to register the customer asset", err);
    }
  }
});

export const updateCustomerAsset = defineServiceFn({
  publish: true,
  title: "Save the fields a service manager edits on a customer asset",
  description: `The site, the two warranty end dates and the notes. A field left out keeps
its value; null clears the site or a date.`,
  output: rows.customerAsset
    .pick({ id: true })
    .meta({ table: "customerAsset" }),
  input: customerAssetPatchValidator,
  permission: { update: "service" },

  async run(ctx, input) {
    if (input.customerLocationId) {
      const asset = await service.companyCustomerAsset(ctx, input.id);
      if (asset instanceof Error) return asset;
      const refused = await refuseUnlessOwned(ctx, "customerLocation", {
        id: input.customerLocationId,
        customerId: asset.customerId
      });
      if (refused) return refused;
    }

    const update = await service.upsertCustomerAsset(ctx.asCaller.supabase, {
      ...input,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update the asset", update.error);
    }
    return { id: input.id };
  }
});

/** Save a customer asset's notes. */
export const updateCustomerAssetNotes = defineServiceFn({
  input: z.object({ id: z.string(), notes: z.custom<Json>() }),
  permission: { update: "service" },

  async run(ctx, { id, notes }) {
    const update = await service.updateCustomerAssetNotes(
      ctx.asCaller.supabase,
      { id, notes, companyId: ctx.company.id, updatedBy: ctx.auditUserId }
    );
    if (update.error) return ctx.error("rule", update.error.message);
    return { id };
  }
});

// --- Service jobs: reads -----------------------------------------------------

export const getServiceJobs = defineServiceFn({
  publish: "read",
  title: "Get service jobs",
  output: z
    .array(
      rows.serviceJob
        .pick({
          assignee: true,
          billingMethod: true,
          companyId: true,
          completedAt: true,
          coverage: true,
          createdAt: true,
          createdBy: true,
          customerAssetId: true,
          customerContactId: true,
          customerId: true,
          customerLocationId: true,
          dueDate: true,
          estimateRespondedAt: true,
          estimateRespondedBy: true,
          estimateSentAt: true,
          estimateStatus: true,
          fixedPrice: true,
          id: true,
          itemId: true,
          laborBillRate: true,
          locationId: true,
          priority: true,
          repairable: true,
          salesInvoiceId: true,
          salesReturnOrderLineId: true,
          serviceJobId: true,
          signaturePath: true,
          signedByName: true,
          status: true,
          trackedEntityId: true,
          updatedAt: true,
          updatedBy: true,
          workSite: true
        })
        .extend({
          customFields: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          findings: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          problem: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          resolution: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ]),
          customer: z.object({
            id: z.string(),
            name: z.string()
          }),
          customerAsset: z
            .object({
              id: z.string(),
              trackedEntity: z.object({
                id: z.string(),
                readableId: z.string().nullable()
              })
            })
            .nullable(),
          item: z
            .object({
              id: z.string(),
              readableIdWithRevision: z.string().nullable(),
              name: z.string()
            })
            .nullable(),
          assigneeUser: z
            .object({
              id: z.string(),
              fullName: z.string().nullable(),
              avatarUrl: z.string().nullable()
            })
            .nullable()
        })
        .meta({ table: "serviceJob" })
    )
    .nullable(),
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "service" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getServiceJobs(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, {
          ...input,
          search: input.search ?? null
        }).build() as never
      )
    );
  }
});

export const getServiceJob = defineServiceFn({
  publish: "read",
  title: "Get service job",
  output: rows.serviceJob
    .pick({
      assignee: true,
      billingMethod: true,
      companyId: true,
      completedAt: true,
      coverage: true,
      createdAt: true,
      createdBy: true,
      customerAssetId: true,
      customerContactId: true,
      customerId: true,
      customerLocationId: true,
      dueDate: true,
      estimateRespondedAt: true,
      estimateRespondedBy: true,
      estimateSentAt: true,
      estimateStatus: true,
      fixedPrice: true,
      id: true,
      itemId: true,
      laborBillRate: true,
      locationId: true,
      priority: true,
      repairable: true,
      salesInvoiceId: true,
      salesReturnOrderLineId: true,
      serviceJobId: true,
      signaturePath: true,
      signedByName: true,
      status: true,
      trackedEntityId: true,
      updatedAt: true,
      updatedBy: true,
      workSite: true
    })
    .extend({
      customFields: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      findings: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      problem: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      resolution: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.array(
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.record(z.string(), z.unknown()),
                z.array(z.unknown()),
                z.null()
              ])
            ),
            z.null()
          ])
        ),
        z.null()
      ]),
      customer: z.object({
        id: z.string(),
        name: z.string()
      }),
      customerAsset: z
        .object({
          id: z.string(),
          status: z.enum(["At Depot", "In Service", "Returned"]),
          laborWarrantyEndDate: z.string().nullable(),
          partsWarrantyEndDate: z.string().nullable(),
          trackedEntity: z.object({
            id: z.string(),
            readableId: z.string().nullable()
          })
        })
        .nullable(),
      item: z
        .object({
          id: z.string(),
          readableIdWithRevision: z.string().nullable(),
          name: z.string()
        })
        .nullable(),
      assigneeUser: z
        .object({
          id: z.string(),
          fullName: z.string().nullable(),
          avatarUrl: z.string().nullable()
        })
        .nullable(),
      salesReturnOrderLine: z
        .object({
          id: z.string(),
          returnType: z.enum([
            "Return for Service",
            "Return for Warranty",
            "Return to Stock"
          ]),
          salesReturnOrder: z.object({
            id: z.string(),
            salesReturnOrderId: z.string()
          })
        })
        .nullable()
    })
    .meta({ table: "serviceJob" }),
  input: z.object({ jobId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { jobId }) {
    return unwrap(
      ctx,
      await service.getServiceJob(ctx.asCaller.supabase, jobId)
    );
  }
});

export const getServiceJobTime = defineServiceFn({
  publish: "read",
  title: "Get service job time entries",
  output: z.array(
    rows.serviceJobTime
      .extend({
        employee: z.object({
          id: z.string(),
          fullName: z.string().nullable(),
          avatarUrl: z.string().nullable()
        })
      })
      .meta({ table: "serviceJobTime" })
  ),
  input: z.object({ jobId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { jobId }) {
    return unwrap(
      ctx,
      await service.getServiceJobTime(ctx.asCaller.supabase, jobId)
    );
  }
});

export const getServiceJobItems = defineServiceFn({
  publish: "read",
  title: "Get service job parts and charges",
  output: z.array(
    rows.serviceJobItem
      .extend({
        item: z.object({
          id: z.string(),
          readableIdWithRevision: z.string().nullable(),
          name: z.string(),
          itemTrackingType: z.enum([
            "Batch",
            "Inventory",
            "Non-Inventory",
            "Serial"
          ])
        }),
        reimbursementLine: z
          .object({
            id: z.string(),
            reimbursement: z.object({
              id: z.string(),
              reimbursementId: z.string()
            })
          })
          .nullable(),
        purchaseInvoiceLine: z
          .object({
            id: z.string(),
            purchaseInvoice: z.object({
              id: z.string(),
              invoiceId: z.string()
            })
          })
          .nullable()
      })
      .meta({ table: "serviceJobItem" })
  ),
  input: z.object({ jobId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { jobId }) {
    return unwrap(
      ctx,
      await service.getServiceJobItems(ctx.asCaller.supabase, jobId)
    );
  }
});

export const getServiceJobEstimateLines = defineServiceFn({
  publish: "read",
  title: "Get service job estimate lines",
  output: z.array(
    rows.serviceJobEstimateLine
      .extend({
        item: z
          .object({
            id: z.string(),
            readableIdWithRevision: z.string().nullable(),
            name: z.string(),
            type: z.enum([
              "Consumable",
              "Fixture",
              "Material",
              "Part",
              "Service",
              "Tool"
            ])
          })
          .nullable()
      })
      .meta({ table: "serviceJobEstimateLine" })
  ),
  input: z.object({ jobId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { jobId }) {
    return unwrap(
      ctx,
      await service.getServiceJobEstimateLines(ctx.asCaller.supabase, jobId)
    );
  }
});

export const getServiceJobAssignmentsRange = defineServiceFn({
  publish: "read",
  title: "Get service job assignments in a date range",
  description: `The technicians scheduled from \`startDate\` to \`endDate\` (inclusive), with
each job's number, status and customer.`,
  output: z.array(
    rows.serviceJobAssignment
      .extend({
        serviceJob: z.object({
          id: z.string(),
          serviceJobId: z.string(),
          status: z.enum([
            "Awaiting Approval",
            "Cancelled",
            "Completed",
            "In Progress",
            "Invoiced",
            "On Hold",
            "Open"
          ]),
          priority: z.enum(["Critical", "High", "Low", "Medium"]),
          locationId: z.string(),
          customer: z.object({
            id: z.string(),
            name: z.string()
          })
        })
      })
      .meta({ table: "serviceJobAssignment" })
  ),
  input: z.object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("The first day, `YYYY-MM-DD`."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("The last day, `YYYY-MM-DD`."),
    locationId: z.string().nullish().describe("Only the jobs of this location.")
  }),
  permission: { view: "service" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getServiceJobAssignmentsRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        input
      )
    );
  }
});

export const getServiceBacklog = defineServiceFn({
  publish: "read",
  title: "Get the service backlog",
  description: "A location's open jobs that no technician is assigned to.",
  output: z.array(
    z.object({
      id: z.string(),
      serviceJobId: z.string(),
      status: z.enum([
        "Awaiting Approval",
        "Cancelled",
        "Completed",
        "In Progress",
        "Invoiced",
        "On Hold",
        "Open"
      ]),
      priority: z.enum(["Critical", "High", "Low", "Medium"]),
      coverage: z.enum(["Billable", "Contract", "Warranty"]),
      workSite: z.enum(["Customer Site", "Depot"]),
      dueDate: z.string().nullable(),
      problem: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null()
          ])
        ),
        z.null()
      ]),
      customer: z.object({
        id: z.string(),
        name: z.string()
      }),
      serviceJobAssignment: z.array(
        z.object({
          id: z.string()
        })
      )
    })
  ),
  input: z.object({ locationId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { locationId }) {
    return unwrap(
      ctx,
      await service.getServiceBacklog(
        ctx.asCaller.supabase,
        ctx.company.id,
        locationId
      )
    );
  }
});

export const getServiceJobsByAsset = defineServiceFn({
  publish: "read",
  title: "Get the service jobs of a customer asset",
  output: z.array(
    rows.serviceJob
      .pick({
        id: true,
        serviceJobId: true,
        status: true,
        coverage: true,
        workSite: true,
        createdAt: true,
        completedAt: true
      })
      .extend({
        problem: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.array(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
              z.array(z.unknown()),
              z.null()
            ])
          ),
          z.null()
        ])
      })
      .meta({ table: "serviceJob" })
  ),
  input: z.object({ customerAssetId: z.string() }),
  permission: { view: "service" },
  async run(ctx, { customerAssetId }) {
    return unwrap(
      ctx,
      await service.getServiceJobsByAsset(
        ctx.asCaller.supabase,
        customerAssetId
      )
    );
  }
});

// --- Service jobs: the header ------------------------------------------------

export const createServiceJob = defineServiceFn({
  publish: true,
  title: "Create a service job",
  description: `Takes the next job number. The customer, location, contact, customer
location and assignee must be the company's; a contact or a
customer location must be the customer's, and so must the asset. A job on
an asset takes the asset's item and serial, and, when no coverage is
given, Warranty while the asset's labor or parts warranty runs today, else
Billable.`,
  output: rows.serviceJob
    .pick({ id: true, serviceJobId: true })
    .meta({ table: "serviceJob" }),
  input: serviceJobValidator,
  permission: { create: "service" },

  async run(ctx, input) {
    const customerId = input.customerId;
    const refused =
      (await refuseUnlessOwned(ctx, "customer", { id: customerId })) ??
      (await refuseUnlessOwned(ctx, "location", { id: input.locationId })) ??
      (input.customerLocationId
        ? await refuseUnlessOwned(ctx, "customerLocation", {
            id: input.customerLocationId,
            customerId
          })
        : null) ??
      (input.customerContactId
        ? await refuseUnlessOwned(ctx, "customerContact", {
            id: input.customerContactId,
            customerId
          })
        : null) ??
      (input.assignee
        ? await service.refuseUnlessEmployee(ctx, input.assignee)
        : null);
    if (refused) return refused;

    let asset: Awaited<ReturnType<typeof service.companyCustomerAsset>> | null =
      null;
    if (input.customerAssetId) {
      asset = await service.companyCustomerAsset(ctx, input.customerAssetId);
      if (asset instanceof CarbonError) return asset;
      if (asset.customerId !== customerId) {
        return ctx.error("rule", "The asset belongs to another customer");
      }
    }

    let coverage = input.coverage;
    if (!coverage) {
      coverage = asset
        ? suggestCoverage(
            asset,
            datetime
              .today(
                await getCompanyTimeZone(ctx.asSystem.supabase, ctx.company.id)
              )
              .toString()
          )
        : "Billable";
    }

    const insert = await service.insertServiceJob(ctx.asCaller.supabase, {
      customerId,
      customerLocationId: input.customerLocationId,
      customerContactId: input.customerContactId,
      customerAssetId: asset?.id ?? null,
      itemId: asset?.itemId ?? null,
      trackedEntityId: asset?.trackedEntityId ?? null,
      locationId: input.locationId,
      workSite: input.workSite,
      coverage,
      billingMethod: input.billingMethod,
      priority: input.priority,
      assignee: input.assignee,
      dueDate: input.dueDate,
      problem: service.problemDocument(input.problem),
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error || !insert.data) {
      return ctx.error(
        "internal",
        "Failed to create the service job",
        insert.error
      );
    }
    return insert.data;
  }
});

export const updateServiceJob = defineServiceFn({
  publish: true,
  title: "Set one header field on one or more service jobs",
  description: `Refused when any of the jobs is Completed, Invoiced or Cancelled. An empty
value clears the field, except the customer, location, work site, billing
method and priority. Ids must be the company's; an asset also sets the
job's item and serial. A customer location, contact or asset must be the
job's customer's; a job from a return or on an asset keeps its customer,
and a job with issued parts keeps its location. \`findings\` and
\`resolution\` take the editor's document as JSON; \`repairable\` takes \`true\`
or \`false\`. \`laborBillRate\` (per hour) also sets the price of the job's
Labor estimate lines, and is refused once the estimate is Sent or
Accepted; \`fixedPrice\` is refused unless the job is Fixed Price. The
status and the coverage are not set here.`,
  output: z.object({
    ids: z.array(z.string())
  }),
  input: serviceJobUpdateValidator,
  permission: { update: "service" },

  async run(ctx, { ids, field, value }) {
    const jobs = await ctx.asCaller.supabase
      .from("serviceJob")
      .select(
        "id, status, customerId, salesReturnOrderLineId, customerAssetId, estimateStatus, billingMethod"
      )
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (jobs.error) {
      return ctx.error(
        "internal",
        "Failed to load the service jobs",
        jobs.error
      );
    }
    if (jobs.data.length !== new Set(ids).size) {
      return ctx.error("notFound", "Service job not found");
    }
    if (jobs.data.some((job) => isServiceJobLocked(job.status))) {
      return ctx.error("rule", service.SERVICE_JOB_LOCKED);
    }

    const refused = await service.serviceJobFieldRefusal(
      ctx,
      jobs.data,
      field,
      value
    );
    if (refused) return refused;

    const values = await service.serviceJobFieldValues(ctx, field, value);
    if (values instanceof CarbonError) return values;

    if (field === "laborBillRate") {
      try {
        await service.updateServiceJobLaborBillRate(ctx.asSystem.pg, {
          ids,
          companyId: ctx.company.id,
          updatedBy: ctx.auditUserId,
          laborBillRate: values.laborBillRate ?? null
        });
      } catch (err) {
        return ctx.error("internal", "Failed to update the bill rate", err);
      }
      return { ids };
    }

    const update = await service.updateServiceJob(ctx.asCaller.supabase, {
      ids,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      values
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the service job",
        update.error
      );
    }
    return { ids };
  }
});

export const setServiceJobStatus = defineServiceFn({
  publish: true,
  title: "Start, hold, resume or cancel a service job",
  description: `Start moves an Open job to In Progress. Hold moves an Open or In Progress
job to On Hold, and Resume moves it back to In Progress. Cancel closes any
job that is not Completed, Invoiced or Cancelled, and only while it has no
time entries and no parts issued. Complete, Reopen and a coverage change
post journals and are not done here.`,
  output: rows.serviceJob
    .pick({ id: true, status: true })
    .meta({ table: "serviceJob" }),
  input: serviceJobStatusValidator,
  permission: { update: "service" },

  async run(ctx, { jobId, action }) {
    const job = await service.editableServiceJob(ctx, jobId);
    if (job instanceof CarbonError) return job;

    const transition = SERVICE_JOB_STATUS_TRANSITIONS[action];
    if (!transition.from.includes(job.status)) {
      return ctx.error("rule", `A job that is ${job.status} cannot ${action}`);
    }

    if (action === "Cancel") {
      const [time, parts] = await Promise.all([
        ctx.asCaller.supabase
          .from("serviceJobTime")
          .select("id", { count: "exact", head: true })
          .eq("serviceJobId", jobId)
          .eq("companyId", ctx.company.id),
        ctx.asCaller.supabase
          .from("serviceJobItem")
          .select("id", { count: "exact", head: true })
          .eq("serviceJobId", jobId)
          .eq("companyId", ctx.company.id)
          .eq("lineType", "Part")
      ]);
      if (time.error || parts.error) {
        return ctx.error(
          "internal",
          "Failed to load the job's time and parts",
          time.error ?? parts.error
        );
      }
      if ((time.count ?? 0) > 0 || (parts.count ?? 0) > 0) {
        return ctx.error(
          "rule",
          "A job with time entries or issued parts cannot be cancelled. Remove them first."
        );
      }
    }

    const update = await ctx.asCaller.supabase
      .from("serviceJob")
      .update({
        status: transition.to,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", jobId)
      .eq("companyId", ctx.company.id)
      .eq("status", job.status)
      .select("id");
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update the job status",
        update.error
      );
    }
    if (update.data.length === 0) {
      return ctx.error("conflict", "The job's status changed. Reload it.");
    }
    return { id: jobId, status: transition.to };
  }
});

// --- Service jobs: postings --------------------------------------------------

const [completeInput, reopenInput, setCoverageInput] =
  postServiceJobInput.options;

export const completeServiceJob = defineServiceFn({
  publish: true,
  title: "Complete a service job",
  description: `Runs \`post-service-job\`. Time posts as it is logged; Complete first posts
any time cost not yet posted (Dr the coverage account, Cost of Service or
Warranty Expense / Cr Labor Absorption at hours × the entry's cost rate)
and is refused if that fails. Refused when the job is not Open, In
Progress or On Hold, or has a clock running. A job from an RMA line
updates the RMA's status.`,
  output: z.object({
    success: z.boolean(),
    serviceJobId: z.string(),
    status: z.string(),
    journalId: z.string().nullable()
  }),
  input: completeInput.omit({ action: true }),
  permission: service.postServiceJobPermission,

  async run(ctx, input) {
    return run(ctx, "post-service-job", () =>
      service.postServiceJob(ctx, { action: "complete", ...input })
    );
  }
});

export const reopenServiceJob = defineServiceFn({
  publish: true,
  title: "Reopen a Completed service job",
  description: `Runs \`post-service-job\`: moves the job back to In Progress. It posts no
journal: the time cost stays posted. An Invoiced job cannot reopen, nor
can a job whose RMA unit was shipped back, scrapped or replaced.`,
  output: z.object({
    success: z.boolean(),
    serviceJobId: z.string(),
    status: z.string(),
    journalId: z.string().nullable()
  }),
  input: reopenInput.omit({ action: true }),
  permission: service.postServiceJobPermission,

  async run(ctx, input) {
    return run(ctx, "post-service-job", () =>
      service.postServiceJob(ctx, { action: "reopen", ...input })
    );
  }
});

export const setServiceJobCoverage = defineServiceFn({
  publish: true,
  title: "Change a service job's coverage: Billable, Warranty or Contract",
  description: `Runs \`post-service-job\`: the cost of the parts already issued moves from
the old coverage account to the new one in one journal, and the posted
time cost moves in a second. Refused once the job is Completed, Invoiced
or Cancelled.`,
  output: z.object({
    success: z.boolean(),
    serviceJobId: z.string(),
    status: z.string(),
    journalId: z.string().nullable()
  }),
  input: setCoverageInput.omit({ action: true }),
  permission: service.postServiceJobPermission,

  async run(ctx, input) {
    return run(ctx, "post-service-job", () =>
      service.postServiceJob(ctx, { action: "set-coverage", ...input })
    );
  }
});

export const createServiceInvoice = defineServiceFn({
  publish: true,
  title: "Draft the invoice of a Completed Billable service job",
  description: `Runs \`create-service-invoice\`: one Draft sales invoice. A Time and
Materials job bills its billable hours on one Labor line at the job's bill
rate (refused while the job has none), then each billable part and charge;
a Fixed Price job bills one plain line, with no item, at the fixed price.
\`fixedPrice\` sets the price of a Fixed Price job that has none, in the
same transaction; it is refused on any other job. Every line names the job, so
posting the invoice writes revenue only: the parts already left stock. The
job moves to Invoiced. Refused unless the job is Completed and Billable.
Returns the invoice.`,
  output: z.object({
    success: z.boolean(),
    salesInvoiceId: z.string(),
    invoiceId: z.string()
  }),
  input: service.createServiceInvoiceInput,
  permission: service.createServiceInvoicePermission,

  async run(ctx, input) {
    return run(ctx, "create-service-invoice", () =>
      service.createServiceInvoice(ctx, input)
    );
  }
});

// --- Service jobs: the estimate ----------------------------------------------

export const upsertServiceJobEstimateLine = defineServiceFn({
  publish: true,
  title: "Add or save a line of a service job's estimate",
  description: `With no \`itemId\` it is a Labor line: its quantity is hours and its unit
price is the job's bill rate (refused while the job has none). Otherwise a
part or a charge at \`unitPrice\`; the item must be the company's. Refused
when the job is Completed, Invoiced or Cancelled, and while the estimate is
Sent or Accepted.`,
  output: rows.serviceJobEstimateLine
    .pick({ id: true })
    .meta({ table: "serviceJobEstimateLine" }),
  input: serviceJobEstimateLineValidator,
  permission: { update: "service" },

  async run(ctx, { id, ...line }) {
    const job = await service.editableServiceJob(ctx, line.serviceJobId);
    if (job instanceof CarbonError) return job;
    if (job.estimateStatus === "Sent" || job.estimateStatus === "Accepted") {
      return ctx.error(
        "rule",
        `The estimate is ${job.estimateStatus}. Its lines cannot change.`
      );
    }
    let unitPrice: number;
    if (line.itemId) {
      const refused = await refuseUnlessOwned(ctx, "item", {
        id: line.itemId
      });
      if (refused) return refused;
      if (line.unitPrice === undefined) {
        return ctx.error("validation", "Unit price is required");
      }
      unitPrice = line.unitPrice;
    } else {
      if (job.laborBillRate === null) {
        return ctx.error("rule", "Set the job's bill rate first.");
      }
      unitPrice = job.laborBillRate;
    }

    const values = { ...line, unitPrice };
    const upsert = await service.upsertServiceJobEstimateLine(
      ctx.asCaller.supabase,
      id
        ? {
            ...values,
            id,
            companyId: ctx.company.id,
            updatedBy: ctx.auditUserId
          }
        : { ...values, companyId: ctx.company.id, createdBy: ctx.auditUserId }
    );
    return unwrap(ctx, upsert);
  }
});

export const deleteServiceJobEstimateLine = defineServiceFn({
  publish: "destructive",
  title: "Remove a line from a service job's estimate",
  description: `Refused when the job is Completed, Invoiced or Cancelled, and while the
estimate is Sent or Accepted.`,
  output: rows.serviceJobEstimateLine
    .pick({ id: true })
    .meta({ table: "serviceJobEstimateLine" }),
  input: childRowInput,
  permission: { delete: "service" },

  async run(ctx, { serviceJobId, id }) {
    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;
    if (job.estimateStatus === "Sent" || job.estimateStatus === "Accepted") {
      return ctx.error(
        "rule",
        `The estimate is ${job.estimateStatus}. Its lines cannot change.`
      );
    }
    return unwrap(
      ctx,
      await service.deleteServiceJobEstimateLine(ctx.asCaller.supabase, {
        id,
        serviceJobId,
        companyId: ctx.company.id
      })
    );
  }
});

export const sendServiceJobEstimate = defineServiceFn({
  publish: true,
  title: "Send a service job's estimate to the customer",
  description: `Only a Billable job has an estimate, and it needs at least one line. Marks
the estimate Sent now and the job Awaiting Approval. Refused when the job is
Completed, Invoiced or Cancelled, or the estimate is already Accepted. The
estimate PDF is filed in the job's files first; when it cannot be made,
nothing changes. With \`notification\` Email the PDF is then emailed to
\`customerContact\` (and \`cc\`); when that fails the estimate is still Sent and
\`warning\` says so. \`locale\` formats the PDF.`,
  output: z.union([
    z.object({
      id: z.string(),
      warning: z.null()
    }),
    z.object({
      id: z.string(),
      warning: z.string()
    }),
    z.null()
  ]),
  input: serviceJobEstimateSendValidator,
  permission: { update: "service" },

  async run(ctx, { jobId, notification, customerContact, cc, locale }) {
    if (notification === "Email" && !customerContact) {
      return ctx.error("validation", "Customer contact is required for email");
    }
    const job = await service.editableServiceJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    if (job.coverage !== "Billable") {
      return ctx.error("rule", "Only a Billable job has an estimate");
    }
    if (job.estimateStatus === "Accepted") {
      return ctx.error("rule", "The estimate was already accepted");
    }

    const lines = await ctx.asCaller.supabase
      .from("serviceJobEstimateLine")
      .select("id", { count: "exact", head: true })
      .eq("serviceJobId", jobId)
      .eq("companyId", ctx.company.id);
    if (lines.error) {
      return ctx.error("internal", "Failed to load the estimate", lines.error);
    }
    if (!lines.count) {
      return ctx.error("rule", "Add a line to the estimate before sending it");
    }

    // The PDF is filed on the job before anything changes, as a quote's is on
    // Finalize: a send that cannot produce its estimate changes nothing.
    const rendered = await renderServiceJobEstimatePdf(ctx.asCaller.supabase, {
      id: jobId,
      companyId: ctx.company.id,
      companyGroupId: ctx.company.groupId,
      locale
    }).catch((err: unknown) => {
      logger.error("Failed to render the service job estimate", {
        companyId: ctx.company.id,
        serviceJobId: jobId,
        error: err
      });
      return null;
    });
    if (!rendered) {
      return ctx.error("internal", "Failed to generate the estimate PDF");
    }
    const filed = await service.fileServiceJobEstimatePdf(ctx, {
      jobId,
      serviceJobId: rendered.estimate.serviceJobId,
      pdf: rendered.pdf
    });
    if (filed instanceof CarbonError) return filed;

    const now = datetime.timestamp();
    const update = await ctx.asCaller.supabase
      .from("serviceJob")
      .update({
        estimateStatus: "Sent",
        estimateSentAt: now,
        estimateRespondedAt: null,
        estimateRespondedBy: null,
        status: "Awaiting Approval",
        updatedBy: ctx.auditUserId,
        updatedAt: now
      })
      .eq("id", jobId)
      .eq("companyId", ctx.company.id)
      .eq("status", job.status)
      .select("id");
    if (update.error) {
      return ctx.error("internal", "Failed to send the estimate", update.error);
    }
    if (update.data.length === 0) {
      return ctx.error("conflict", "The job's status changed. Reload it.");
    }

    if (notification !== "Email" || !customerContact) {
      return { id: jobId, warning: null };
    }
    // The estimate is Sent either way; a failed email is reported, not undone.
    try {
      await service.emailServiceJobEstimate(ctx, {
        serviceJobId: rendered.estimate.serviceJobId,
        customerContactId: customerContact,
        cc,
        companyName: rendered.companyName,
        total: rendered.estimate.total,
        itemName: rendered.estimate.itemName,
        serial: rendered.estimate.serial,
        pdf: rendered.pdf,
        fileName: filed.fileName
      });
      return { id: jobId, warning: null };
    } catch (err) {
      logger.error("Failed to email the service job estimate", {
        companyId: ctx.company.id,
        serviceJobId: jobId,
        error: err
      });
      return {
        id: jobId,
        warning: "The estimate is marked Sent, but the email failed"
      };
    }
  }
});

export const reopenServiceJobEstimate = defineServiceFn({
  publish: true,
  title: "Reopen a service job's estimate, as a quote is reopened to Draft",
  description: `For an estimate that is Sent, Accepted or Declined, on a job that is not
Completed, Invoiced or Cancelled. The estimate goes back to Draft, so its
lines and the job's bill rate can change and it can be sent again; the
customer's answer is cleared. A job Awaiting Approval goes back to Open,
and a Declined estimate's "not repairable" is undone. Each send files its
own PDF, so the earlier ones stay in the job's files.`,
  output: rows.serviceJob.pick({ id: true }).meta({ table: "serviceJob" }),
  input: z.object({ jobId: z.string().min(1) }),
  permission: { update: "service" },

  async run(ctx, { jobId }) {
    const job = await service.editableServiceJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    if (
      job.estimateStatus !== "Sent" &&
      job.estimateStatus !== "Accepted" &&
      job.estimateStatus !== "Declined"
    ) {
      return ctx.error("rule", "Only a sent or answered estimate is reopened");
    }

    const now = datetime.timestamp();
    const update = await ctx.asCaller.supabase
      .from("serviceJob")
      .update({
        estimateStatus: "Draft",
        estimateRespondedAt: null,
        estimateRespondedBy: null,
        ...(job.status === "Awaiting Approval"
          ? { status: "Open" as const }
          : {}),
        ...(job.estimateStatus === "Declined" ? { repairable: null } : {}),
        updatedBy: ctx.auditUserId,
        updatedAt: now
      })
      .eq("id", jobId)
      .eq("companyId", ctx.company.id)
      .eq("status", job.status)
      .eq("estimateStatus", job.estimateStatus)
      .select("id");
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to reopen the estimate",
        update.error
      );
    }
    if (update.data.length === 0) {
      return ctx.error("conflict", "The job changed. Reload it.");
    }
    return { id: jobId };
  }
});

export const recordServiceJobEstimateResponse = defineServiceFn({
  publish: true,
  title: "Record the customer's answer to a sent estimate",
  description: `Accepted: the repair starts, so the job goes to In Progress, and a Fixed
Price job's price becomes the estimate total (each line's quantity × unit
price). Declined: the unit
is not repaired (\`repairable\` false) and the job goes back to Open, where
Complete closes it and bills the evaluation time. Either way the
response time is stored, and \`estimateRespondedBy\` (who gave the answer)
when given. Refused unless the estimate is Sent.`,
  output: rows.serviceJob.pick({ id: true }).meta({ table: "serviceJob" }),
  input: serviceJobEstimateResponseValidator,
  permission: { update: "service" },

  async run(ctx, { jobId, response, estimateRespondedBy }) {
    const job = await service.editableServiceJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    if (job.estimateStatus !== "Sent") {
      return ctx.error("rule", "Send the estimate before recording a response");
    }

    let fixedPrice: number | undefined;
    if (response === "Accepted" && job.billingMethod === "Fixed Price") {
      const lines = await ctx.asCaller.supabase
        .from("serviceJobEstimateLine")
        .select("quantity, unitPrice")
        .eq("serviceJobId", jobId)
        .eq("companyId", ctx.company.id);
      if (lines.error) {
        return ctx.error(
          "internal",
          "Failed to load the estimate",
          lines.error
        );
      }
      fixedPrice = round(
        lines.data.reduce(
          (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
          0
        )
      );
    }

    const now = datetime.timestamp();
    const update = await ctx.asCaller.supabase
      .from("serviceJob")
      .update({
        estimateStatus: response,
        estimateRespondedAt: now,
        estimateRespondedBy: estimateRespondedBy || null,
        ...(response === "Accepted"
          ? { status: "In Progress" as const, fixedPrice }
          : { status: "Open" as const, repairable: false }),
        updatedBy: ctx.auditUserId,
        updatedAt: now
      })
      .eq("id", jobId)
      .eq("companyId", ctx.company.id)
      .eq("estimateStatus", "Sent")
      .select("id");
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to record the response",
        update.error
      );
    }
    if (update.data.length === 0) {
      return ctx.error("conflict", "The estimate changed. Reload it.");
    }
    return { id: jobId };
  }
});

// --- Service jobs: time ------------------------------------------------------

export const upsertServiceJobTime = defineServiceFn({
  publish: true,
  title: "Add or save a time entry on a service job",
  description: `Hours one employee worked on one day. The employee must be an active
employee of the company. Refused when the job is Completed, Invoiced or
Cancelled, or when the company has no labor cost rate (Settings →
Service). Then the job's time cost posts: a closed entry costs hours × the
cost rate, Dr the coverage account / Cr Labor Absorption. When that fails,
the entry is still saved and \`warning\` says so.`,
  output: z.object({
    warning: z.string().nullable(),
    id: z.string().nullable().optional()
  }),
  input: serviceJobTimeValidator,
  permission: { update: "service" },

  async run(ctx, { id, ...time }) {
    const job = await service.editableServiceJob(ctx, time.serviceJobId);
    if (job instanceof CarbonError) return job;
    const refused =
      (await service.refuseUnlessEmployee(ctx, time.employeeId)) ??
      (await service.refuseWithoutLaborCostRate(ctx));
    if (refused) return refused;

    const upsert = await service.upsertServiceJobTime(
      ctx.asCaller.supabase,
      id
        ? { ...time, id, companyId: ctx.company.id, updatedBy: ctx.auditUserId }
        : { ...time, companyId: ctx.company.id, createdBy: ctx.auditUserId }
    );
    const saved = unwrap(ctx, upsert);
    if (saved instanceof CarbonError) return saved;

    const postingError = await service.postServiceJobTime(
      ctx,
      time.serviceJobId
    );
    return {
      ...saved,
      warning: postingError
        ? `Time entry saved, but its cost did not post: ${postingError}`
        : null
    };
  }
});

export const deleteServiceJobTime = defineServiceFn({
  publish: "destructive",
  title: "Remove a time entry from a service job",
  description: `Refused when the job is Completed, Invoiced or Cancelled, or when the
company has no labor cost rate (Settings → Service). Then the job's time
cost posts again, which reverses the entry's cost; when that fails, the
entry is still removed and \`warning\` says so.`,
  output: z.object({
    warning: z.string().nullable(),
    id: z.string().nullable().optional()
  }),
  input: childRowInput,
  permission: { delete: "service" },

  async run(ctx, { serviceJobId, id }) {
    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;
    const refused = await service.refuseWithoutLaborCostRate(ctx);
    if (refused) return refused;

    const removed = unwrap(
      ctx,
      await service.deleteServiceJobTime(ctx.asCaller.supabase, {
        id,
        serviceJobId,
        companyId: ctx.company.id
      })
    );
    if (removed instanceof CarbonError) return removed;

    const postingError = await service.postServiceJobTime(ctx, serviceJobId);
    return {
      ...removed,
      warning: postingError
        ? `Time entry removed, but its cost was not reversed: ${postingError}`
        : null
    };
  }
});

export const stopServiceJobClock = defineServiceFn({
  publish: true,
  title: "Stop every clock running on a service job",
  description: `Each running entry ends now. Its hours are the time since it started, and
its day is the company's day it started on. Then the job's time cost
posts; when that fails, the clocks are still stopped and \`warning\` says
so. Refused when the job is Completed, Invoiced or Cancelled. A job with no
running clock stops nothing.`,
  output: z.object({
    ids: z.array(z.string()),
    warning: z.string().nullable()
  }),
  input: z.object({ serviceJobId: z.string().min(1) }),
  permission: { update: "service" },

  async run(ctx, { serviceJobId }) {
    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;

    let stopped: string[];
    try {
      stopped = await service.stopServiceJobClocks(ctx.asSystem.pg, {
        serviceJobId,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to stop the clock", err);
    }

    const postingError =
      stopped.length > 0
        ? await service.postServiceJobTime(ctx, serviceJobId)
        : null;
    return {
      ids: stopped,
      warning: postingError
        ? `Clock stopped, but its cost did not post: ${postingError}`
        : null
    };
  }
});

export const setServiceJobDayHours = defineServiceFn({
  publish: true,
  title:
    "Set the caller's total hours on a service job for one day, from My Time",
  description: `The difference from the day's clock entries is written to the day's one
manual entry (no clock): saved, added, or removed at 0. The job's time
cost posts in the same transaction. A total below the clock entries writes
nothing and comes back as \`warning\`: clock time is edited on the job.
Refused when the job is Completed, Invoiced or Cancelled, or when the
company has no labor cost rate (Settings → Service). Like My Time and the
MES clock it needs only company membership: any employee may log time on
any open job, since more than one person works on a job. Service time
never goes through timesheet submit or approval. An API key needs
\`update: service\`.`,
  output: z.object({
    saved: z.boolean(),
    warning: z.string().nullable()
  }),
  input: serviceJobDayHoursValidator,
  // Your own time, on any open job.
  permission: {},

  async run(ctx, input) {
    const refused =
      refuseKeyWithout(ctx, { update: "service" }) ??
      (await service.refuseWithoutLaborCostRate(ctx));
    if (refused) return refused;
    return run(ctx, "setServiceJobDayHours", () =>
      service.setServiceJobDayHours(ctx.asSystem.pg, {
        ...input,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        employeeId: ctx.auditUserId
      })
    );
  }
});

// --- Service jobs: charges ---------------------------------------------------

export const upsertServiceJobCharge = defineServiceFn({
  publish: true,
  title: "Add or save a charge on a service job",
  description: `A Service item with a price, such as a trip fee. The item must be a Service
item of the company. Refused when the job is Completed, Invoiced or
Cancelled. A part is issued from stock instead, through the \`issue\`
posting.

A charge that was a real cost (a hotel, a part bought on site) names the
line that paid it: \`reimbursementLineId\` (a Posted reimbursement) or
\`purchaseInvoiceLineId\` (a posted supplier invoice line with an account),
never both. Its unit cost is then that line's base amount ÷ the quantity;
with no link it is 0. The linked document already posted the journal, so
the job posts nothing. A line that already pays another charge is refused.`,
  output: rows.serviceJob.pick({ id: true }).meta({ table: "serviceJob" }),
  input: serviceJobItemValidator,
  permission: { update: "service" },

  async run(ctx, { id, ...charge }) {
    const job = await service.editableServiceJob(ctx, charge.serviceJobId);
    if (job instanceof CarbonError) return job;
    const refused = await service.refuseUnlessServiceItem(
      ctx,
      charge.itemId,
      "A charge"
    );
    if (refused) return refused;
    const cost = await service.chargeCost(ctx, { id, ...charge });
    if (cost instanceof CarbonError) return cost;

    const upsert = await service.upsertServiceJobItem(
      ctx.asCaller.supabase,
      id
        ? {
            ...charge,
            ...cost,
            id,
            companyId: ctx.company.id,
            updatedBy: ctx.auditUserId
          }
        : {
            ...charge,
            ...cost,
            companyId: ctx.company.id,
            createdBy: ctx.auditUserId
          }
    );
    if (service.isChargeCostLinkTaken(upsert.error)) {
      return ctx.error("rule", service.CHARGE_COST_LINE_TAKEN);
    }
    return unwrap(ctx, upsert);
  }
});

export const getLinkableCostLines = defineServiceFn({
  publish: "read",
  title: "Get the posted lines a service job charge's cost can be linked to",
  description: `Lines of Posted reimbursements and of posted supplier invoices that post to
an account, newest first, at most 100 of each, with their document number,
description, base-currency amount and account. Lines that already pay
another charge are left out; the line \`serviceJobItemId\` is linked to is
always listed. \`employeeId\` and \`supplierId\` narrow the reimbursements and
the invoices. \`coverageAccount\` is the account the job's cost goes to, to
compare each line's account with.`,
  output: z.object({
    lines: z.array(
      z.object({
        source: z.enum(["purchaseInvoice", "reimbursement"]),
        id: z.string(),
        documentId: z.string(),
        documentReadableId: z.string(),
        description: z.string().nullable(),
        amount: z.number(),
        accountId: z.string().nullable(),
        accountName: z.string().nullable(),
        accountNumber: z.string().nullable()
      })
    ),
    coverageAccount: z
      .object({
        id: z.string(),
        name: z.string(),
        number: z.string().nullable()
      })
      .nullable()
  }),
  input: z.object({
    serviceJobId: z.string().min(1),
    serviceJobItemId: z.string().optional(),
    employeeId: z.string().optional(),
    supplierId: z.string().optional()
  }),
  permission: { view: "service" },

  async run(ctx, { serviceJobId, ...args }) {
    const client = ctx.asCaller.supabase;
    const [lines, coverageAccount] = await Promise.all([
      service.getLinkableCostLines(client, ctx.company.id, args),
      service.getServiceJobCoverageAccount(client, ctx.company.id, serviceJobId)
    ]);
    const result = unwrap(ctx, lines, coverageAccount);
    if (result instanceof CarbonError) return result;
    return { lines: result[0] ?? [], coverageAccount: result[1] };
  }
});

export const deleteServiceJobCharge = defineServiceFn({
  publish: "destructive",
  title: "Remove a charge from a service job",
  description: `Charges only: a part goes back to stock through the \`issue\` posting.
Refused when the job is Completed, Invoiced or Cancelled.`,
  output: rows.serviceJob.pick({ id: true }).meta({ table: "serviceJob" }),
  input: childRowInput,
  permission: { delete: "service" },

  async run(ctx, { serviceJobId, id }) {
    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;
    return unwrap(
      ctx,
      await service.deleteServiceJobItem(ctx.asCaller.supabase, {
        id,
        serviceJobId,
        companyId: ctx.company.id
      })
    );
  }
});

// --- Service jobs: parts -----------------------------------------------------

export const issueServiceJobPart = defineServiceFn({
  publish: true,
  title: "Issue a part from stock to a service job",
  description: `Refused when the job is Completed, Invoiced or Cancelled, or the item is
not the company's. A serial or batch part names the tracked entities it
takes in \`children\`, each with a quantity more than 0; any other part takes
\`quantity\` (more than 0) from inventory at the job's location. The stock
leaves inventory through the \`issue\` posting, which posts its cost to the
job's coverage account; its refusal is returned as it is.`,
  output: z.object({
    serviceJobId: z.string(),
    itemId: z.string()
  }),
  input: z.object({
    serviceJobId: z.string().min(1),
    itemId: z.string().min(1),
    unitOfMeasureCode: z.string().min(1),
    quantity: z.number().optional(),
    children: z
      .array(
        z.object({
          trackedEntityId: z.string(),
          quantity: z.number().positive()
        })
      )
      .optional()
  }),
  permission: { update: "service" },

  async run(
    ctx,
    { serviceJobId, itemId, unitOfMeasureCode, quantity, children }
  ) {
    const total = children
      ? children.reduce((sum, child) => sum + child.quantity, 0)
      : (quantity ?? 0);
    if (total <= 0) {
      return ctx.error("validation", "Quantity must be greater than 0");
    }

    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;
    const owned = await refuseUnlessOwned(ctx, "item", { id: itemId });
    if (owned) return owned;

    const tracked = !!children && children.length > 0;
    const issued = await invokePosting(
      ctx,
      "issue",
      tracked
        ? {
            type: "serviceJobTrackedEntities" as const,
            serviceJobId,
            itemId,
            unitOfMeasureCode,
            children
          }
        : {
            type: "serviceJobInventory" as const,
            serviceJobId,
            itemId,
            unitOfMeasureCode,
            quantity: total
          },
      inventoryPostings.issueMaterial
    );
    if (issued.error) return unwrap(ctx, issued) as CarbonError;
    return { serviceJobId, itemId };
  }
});

export const unissueServiceJobPart = defineServiceFn({
  publish: "destructive",
  title: "Remove a part from a service job and return it to stock",
  description: `The part must be the job's, and the job not Completed, Invoiced or
Cancelled. Everything still issued on the line goes back to inventory
through the \`issue\` posting, which reverses its cost from the coverage
account, and the line is removed. A charge is removed with
\`deleteServiceJobCharge\` instead.`,
  output: rows.serviceJob.pick({ id: true }).meta({ table: "serviceJob" }),
  input: childRowInput,
  permission: { delete: "service" },

  async run(ctx, { serviceJobId, id }) {
    const job = await service.editableServiceJob(ctx, serviceJobId);
    if (job instanceof CarbonError) return job;

    const item = await ctx.asCaller.supabase
      .from("serviceJobItem")
      .select("id")
      .eq("id", id)
      .eq("serviceJobId", serviceJobId)
      .eq("companyId", ctx.company.id)
      .eq("lineType", "Part")
      .maybeSingle();
    if (item.error) {
      return ctx.error("internal", "Failed to remove the part", item.error);
    }
    if (!item.data) return ctx.error("notFound", "Part not found");

    const returned = await invokePosting(
      ctx,
      "issue",
      { type: "serviceJobUnconsume" as const, serviceJobItemId: id },
      inventoryPostings.issueMaterial
    );
    if (returned.error) return unwrap(ctx, returned) as CarbonError;
    return { id };
  }
});

// --- Service jobs: assignments -----------------------------------------------

export const upsertServiceJobAssignment = defineServiceFn({
  publish: true,
  title:
    "Schedule a technician on a service job for a day, or save the assignment",
  description: `The employee must be an active employee of the company. A job has one
assignment per technician per day. Refused when the job is Completed,
Invoiced or Cancelled.`,
  output: rows.serviceJobAssignment
    .pick({ id: true })
    .meta({ table: "serviceJobAssignment" }),
  input: serviceJobAssignmentValidator,
  permission: { update: "service" },

  async run(ctx, { id, ...assignment }) {
    const job = await service.editableServiceJob(ctx, assignment.serviceJobId);
    if (job instanceof CarbonError) return job;
    const refused = await service.refuseUnlessEmployee(
      ctx,
      assignment.employeeId
    );
    if (refused) return refused;

    const upsert = await service.upsertServiceJobAssignment(
      ctx.asCaller.supabase,
      id
        ? {
            ...assignment,
            id,
            companyId: ctx.company.id,
            updatedBy: ctx.auditUserId
          }
        : {
            ...assignment,
            companyId: ctx.company.id,
            createdBy: ctx.auditUserId
          }
    );
    if (upsert.error?.code === "23505") {
      return ctx.error(
        "conflict",
        "The job is already scheduled for this technician on this day"
      );
    }
    return unwrap(ctx, upsert);
  }
});

export const moveServiceJobAssignment = defineServiceFn({
  publish: true,
  title: "Move a service job assignment to another technician or day",
  description: `When the job is already scheduled for that technician on that day, the two
merge and their planned hours add. The employee must be an active employee
of the company. Refused when the job is Completed, Invoiced or Cancelled.`,
  output: rows.serviceJobAssignment
    .pick({ id: true, serviceJobId: true })
    .meta({ table: "serviceJobAssignment" }),
  input: serviceJobAssignmentMoveValidator,
  permission: { update: "service" },

  async run(ctx, { id, employeeId, scheduledDate }) {
    const assignment = await ctx.asCaller.supabase
      .from("serviceJobAssignment")
      .select("id, serviceJobId")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (assignment.error) {
      return ctx.error(
        "internal",
        "Failed to load the assignment",
        assignment.error
      );
    }
    if (!assignment.data) return ctx.error("notFound", "Assignment not found");

    const job = await service.editableServiceJob(
      ctx,
      assignment.data.serviceJobId
    );
    if (job instanceof CarbonError) return job;
    const refused = await service.refuseUnlessEmployee(ctx, employeeId);
    if (refused) return refused;

    return service.moveServiceJobAssignment(ctx.asSystem.pg, {
      id,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      employeeId,
      scheduledDate
    });
  }
});

export const deleteServiceJobAssignment = defineServiceFn({
  publish: "destructive",
  title: "Remove a technician's assignment from a service job",
  description: "Refused when the job is Completed, Invoiced or Cancelled.",
  output: rows.serviceJobAssignment
    .pick({ id: true })
    .meta({ table: "serviceJobAssignment" }),
  input: z.object({ id: z.string().min(1) }),
  permission: { delete: "service" },

  async run(ctx, { id }) {
    const assignment = await ctx.asCaller.supabase
      .from("serviceJobAssignment")
      .select("id, serviceJobId")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (assignment.error) {
      return ctx.error(
        "internal",
        "Failed to load the assignment",
        assignment.error
      );
    }
    if (!assignment.data) return ctx.error("notFound", "Assignment not found");

    const job = await service.editableServiceJob(
      ctx,
      assignment.data.serviceJobId
    );
    if (job instanceof CarbonError) return job;

    return unwrap(
      ctx,
      await service.deleteServiceJobAssignment(ctx.asCaller.supabase, {
        id,
        companyId: ctx.company.id
      })
    );
  }
});
