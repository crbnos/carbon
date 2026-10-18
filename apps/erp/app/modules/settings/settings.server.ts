// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import {
  blockSchema,
  type DocumentBlock,
  type DocumentSettings,
  type DocumentTheme,
  documentSectionPlacementSchema,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  sectionConfigSchema,
  themeSchema
} from "@carbon/documents/template";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  getUnmappedRequiredAccounts,
  JOURNAL_ENTRY_SOURCE_TYPES,
  POSTING_POLICY,
  suggestAccountMatchesWithAI,
  upsertAccountMappings,
  upsertDimensionValueMapping,
  validateDimensionSlots
} from "@carbon/ee/accounting";
import { deleteApiKey, upsertApiKey } from "@carbon/ee/api-keys.server";
import {
  disableAuditLog,
  enableAuditLog,
  getArchiveDownloadUrl
} from "@carbon/ee/audit.server";
import { updateConsoleSetting } from "@carbon/ee/console.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { getIntegrationServerHooks } from "@carbon/ee/hooks.server";
import type { OeeDevice } from "@carbon/ee/oee";
import {
  deleteWorkCenterDevice,
  upsertWorkCenterDevice
} from "@carbon/ee/oee.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape";
import { isIntegrationWhitelisted } from "@carbon/ee/plan";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { updateRequireMfaSetting } from "@carbon/ee/two-factor.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import {
  createPrintJob,
  deletePrinterRoute,
  getPrintingSettings,
  getPrintJob,
  getPrintJobContent,
  type PrintingSettings,
  printerRouteValidator,
  reprintValidator,
  setContextAssignment,
  updateAssignmentValidator,
  updatePrintingSettings,
  upsertPrinterRoute
} from "@carbon/printing";
import { invalidatePrinterCache } from "@carbon/printing/printing.server";
import type { JSONContent } from "@carbon/react";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import { getBillingPortalRedirectUrl } from "@carbon/stripe/stripe.server";
import { datetime, unchecked } from "@carbon/utils";
import { parseTime } from "@internationalized/date";
import { nanoid } from "nanoid";
import { z } from "zod";
import { plmReleaseControl } from "~/modules/items/items.models";
import {
  invalidateCompanyTimeZone,
  invokePosting,
  isActiveCompanyEmployee
} from "~/modules/shared/shared.service";
import { sendMfaRequiredEmails } from "~/services/mfa-email.server";
import * as accountingPostings from "../accounting/accounting.service";
import { fromServerFn } from "../shared/shared.service";
import {
  accountMappingEntrySchema,
  apiKeyValidator,
  calculatedShelfLifeInputScopes,
  companyValidator,
  dimensionSlotEntrySchema,
  dimensionValueMappingEntrySchema,
  expiredEntityPolicies,
  incompletePickingListPolicies,
  invoiceAutomations,
  kanbanOutputTypes,
  purchasePriceUpdateTimingTypes,
  returnPickedMaterialTimings,
  subsidiaryValidator
} from "./settings.models";
import * as service from "./settings.service";

const logger = getLogger("erp", "settings");
// ─── Operations (`defineServiceFn`) ─────────────────────────────────────────
// What the routes, the API and MCP all run. A settings page has ONE update
// operation: it takes the page's fields, all optional, and writes the ones
// sent. An absent field keeps its stored value, so one form never blanks a
// neighbouring setting.
const notificationGroup = z.array(z.string().min(1));

const billingAddressInput = z.object({
  name: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  email: z.string().email().nullable().optional()
});
/**
 * Update the accounting settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether money shows its
 * trailing zeros, the fixed-asset tax depreciation (on or off, its rate, and
 * the deferred tax liability and expense accounts on the company's account
 * defaults), and the ASC 842 lease policy (the classification thresholds,
 * the default lessor discount rate and lessee incremental borrowing rate in
 * percentage points, the short-term lease expedient, and how many days ahead
 * a lease's owner is reminded). The lease policy applies to later lease
 * activations only.
 *
 * @mcp
 */
export const updateAccountingSettings = defineServiceFn({
  input: z.object({
    showCurrencyTrailingZeros: z.boolean().optional(),
    assetTaxDepreciationEnabled: z.boolean().optional(),
    assetTaxRate: z.number().min(0).max(100).nullable().optional(),
    deferredTaxLiabilityAccountId: z.string().min(1).optional(),
    deferredTaxExpenseAccountId: z.string().min(1).optional(),
    leaseMajorPartThresholdPercent: z.number().gt(0).max(100).optional(),
    leaseSubstantiallyAllThresholdPercent: z.number().gt(0).max(100).optional(),
    leaseDefaultDiscountRate: z.number().min(0).optional(),
    leaseIncrementalBorrowingRate: z.number().min(0).optional(),
    leaseShortTermExpedient: z.boolean().optional(),
    leaseReminderDays: z.number().int().min(0).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const {
      deferredTaxLiabilityAccountId,
      deferredTaxExpenseAccountId,
      ...settings
    } = input;

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update accounting settings"
    );
    if (saved) return saved;

    const accounts = service.sentFields({
      deferredTaxLiabilityAccountId,
      deferredTaxExpenseAccountId
    });
    if (Object.keys(accounts).length > 0) {
      const { error } = await ctx.asCaller.supabase
        .from("accountDefault")
        .update({ ...accounts, updatedBy: ctx.auditUserId })
        .eq("companyId", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the deferred tax accounts",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Write the journals the accounting cutover would have written for documents posted without one.
 *
 * @remarks
 * A company that enabled accounting before the enable wrote journals has
 * documents posted on or after its cutover with no journal. This runs the
 * `journal-legacy-documents` posting, which journals each of them, and
 * returns how many documents it journaled. Not published: it needs two
 * modules' permissions, which the API gate cannot state yet.
 */
export const writeMissingJournals = defineServiceFn({
  input: z.object({}),
  permission: { update: ["settings", "accounting"] },
  async run(ctx) {
    const result = await invokePosting(
      ctx,
      "journal-legacy-documents",
      {},
      accountingPostings.repairLegacyJournals
    );
    if (result.error) {
      return fromServerFn(
        ctx,
        result.error,
        "Failed to write the missing journals"
      );
    }
    const { movementCostRows: _, ...families } = result.data.legacyJournals;
    return {
      documents: Object.values(families).reduce((sum, count) => sum + count, 0)
    };
  }
});

/**
 * Update the inventory settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: what a kanban card prints
 * (label, QR code or URL), the shelf-life and expiry policy (the near-expiry
 * warning in days, null to turn the badges off; the default shelf life of a
 * new item; which inputs a calculated expiry reads; and what consuming an
 * expired entity does), whether finishing a picking list with unpicked
 * material warns or refuses, and when unconsumed picked material is returned
 * (when the job completes, or when each operation is done).
 *
 * @mcp
 */
export const updateInventorySettings = defineServiceFn({
  input: z.object({
    kanbanOutput: z.enum(kanbanOutputTypes).optional(),
    inventoryShelfLife: z
      .object({
        nearExpiryWarningDays: z.number().int().min(0).max(365).nullable(),
        defaultShelfLifeDays: z.number().int().min(1).max(3650),
        calculatedInputScope: z.enum(calculatedShelfLifeInputScopes),
        expiredEntityPolicy: z.enum(expiredEntityPolicies)
      })
      .optional(),
    incompletePickingListPolicy: z
      .enum(incompletePickingListPolicies)
      .optional(),
    returnPickedMaterialTiming: z.enum(returnPickedMaterialTimings).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await service.saveCompanySettings(
      ctx,
      input,
      "Failed to update inventory settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the invoicing settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: what happens to a recurring
 * invoice when the daily job creates it, the receivables email (the Reply-To
 * and a CC on automated invoice emails), who is also notified about
 * invoices, whether documents print the centralized receivables billing
 * address, that address itself (a null field clears it), and the default CC
 * on customer emails. "Post and Send via Stripe" is refused until Stripe is
 * connected in Integrations, or every recurring invoice would be held.
 *
 * @mcp
 */
export const updateInvoicingSettings = defineServiceFn({
  input: z.object({
    invoiceAutomation: z.enum(invoiceAutomations).optional(),
    accountsReceivableEmail: z.string().email().nullable().optional(),
    invoiceNotificationGroup: notificationGroup.optional(),
    accountsReceivableAddress: z.boolean().optional(),
    accountsReceivableBillingAddress: billingAddressInput.optional(),
    defaultCustomerCc: z.array(z.string().email()).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const { accountsReceivableBillingAddress, ...settings } = input;

    if (
      settings.invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, ctx.company.id))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update invoicing settings"
    );
    if (saved) return saved;

    if (accountsReceivableBillingAddress) {
      const { error } = await ctx.asCaller.supabase
        .from("companyAccountsReceivableBillingAddress")
        .upsert({
          id: ctx.company.id,
          ...service.sentFields(accountsReceivableBillingAddress),
          updatedBy: ctx.auditUserId
        });
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the accounts receivable billing address",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Update the items settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether material ids are
 * generated from their properties, whether material sizes use metric units,
 * whether item ids may contain lowercase letters, whether the BoM explorer
 * shows readable ids, and how strictly a released revision controls changes
 * (off, warn or enforce).
 *
 * @mcp
 */
export const updateItemsSettings = defineServiceFn({
  input: z.object({
    materialGeneratedIds: z.boolean().optional(),
    useMetric: z.boolean().optional(),
    allowLowercaseItemIds: z.boolean().optional(),
    showBomExplorerReadableId: z.boolean().optional(),
    plmReleaseControl: z.enum(plmReleaseControl).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await service.saveCompanySettings(
      ctx,
      input,
      "Failed to update items settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the production settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: who is notified when an
 * inventory or a sales job completes, whether opening an operation starts its
 * timer, whether the job traveler lists materials and operations, whether
 * tracked material is pre-selected without a picking list, and whether one
 * location requires an assigned operator before the scheduler places work
 * there. The staffing rule lives on the location row and is written for the
 * company's own location only, so a settings admin without the resources
 * permission can still set it.
 *
 * @mcp
 */
export const updateProductionSettings = defineServiceFn({
  input: z.object({
    inventoryJobCompletedNotificationGroup: notificationGroup.optional(),
    salesJobCompletedNotificationGroup: notificationGroup.optional(),
    autoStartOperationTimer: z.boolean().optional(),
    includeMaterialsOnTraveler: z.boolean().optional(),
    includeOperationsOnTraveler: z.boolean().optional(),
    autoSelectMaterialWithoutPickingList: z.boolean().optional(),
    locationStaffing: z
      .object({
        locationId: z.string().min(1),
        requiresStaffing: z.boolean()
      })
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const { locationStaffing, ...settings } = input;

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update production settings"
    );
    if (saved) return saved;

    if (locationStaffing) {
      const { data, error } = await ctx.asSystem.supabase
        .from("location")
        .update({ requiresStaffing: locationStaffing.requiresStaffing })
        .eq("id", locationStaffing.locationId)
        .eq("companyId", ctx.company.id)
        .select("id");
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the staffing requirement",
          error
        );
      }
      if (data.length === 0) return ctx.error("notFound", "Location not found");
    }
    return input;
  }
});

/**
 * Update the purchasing settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether documents print the
 * centralized payables billing address, that address itself (a null field
 * clears it), whether a supplier needs a contact with an email before its
 * documents issue, when a purchase updates the item's price (on invoice post
 * or on order finalize), whether a receipt updates the supplier lead time,
 * whether supplier readable ids show, who is notified about supplier quotes,
 * and the default CC on supplier emails.
 *
 * @mcp
 */
export const updatePurchasingSettings = defineServiceFn({
  input: z.object({
    accountsPayableAddress: z.boolean().optional(),
    accountsPayableBillingAddress: billingAddressInput.optional(),
    requireSupplierContactAndLocation: z.boolean().optional(),
    purchasePriceUpdateTiming: z
      .enum(purchasePriceUpdateTimingTypes)
      .optional(),
    updateLeadTimesOnReceipt: z.boolean().optional(),
    showSupplierReadableId: z.boolean().optional(),
    supplierQuoteNotificationGroup: notificationGroup.optional(),
    defaultSupplierCc: z.array(z.string().email()).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const { accountsPayableBillingAddress, ...settings } = input;

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update purchasing settings"
    );
    if (saved) return saved;

    if (accountsPayableBillingAddress) {
      const { error } = await ctx.asCaller.supabase
        .from("companyAccountsPayableBillingAddress")
        .update({
          ...service.sentFields(accountsPayableBillingAddress),
          updatedBy: ctx.auditUserId
        })
        .eq("id", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the accounts payable billing address",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Update the quality settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether an inspection needs a
 * second person to sign it off, the sampling standard inspection plans use,
 * the open-issue target on the quality dashboard, and who is notified when a
 * gauge goes out of calibration.
 *
 * @mcp
 */
export const updateQualitySettings = defineServiceFn({
  input: z.object({
    enforceInspectionFourEyes: z.boolean().optional(),
    samplingStandard: z.enum(["ANSI_Z1_4", "ISO_2859_1"]).optional(),
    qualityIssueTarget: z.number().int().min(0).optional(),
    gaugeCalibrationExpiredNotificationGroup: notificationGroup.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await service.saveCompanySettings(
      ctx,
      input,
      "Failed to update quality settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the resources settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: who is notified about a new
 * suggestion, and who is notified about a maintenance, quality, operations or
 * other dispatch.
 *
 * @mcp
 */
export const updateResourcesSettings = defineServiceFn({
  input: z.object({
    suggestionNotificationGroup: notificationGroup.optional(),
    maintenanceDispatchNotificationGroup: notificationGroup.optional(),
    qualityDispatchNotificationGroup: notificationGroup.optional(),
    operationsDispatchNotificationGroup: notificationGroup.optional(),
    otherDispatchNotificationGroup: notificationGroup.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const { suggestionNotificationGroup, ...settings } = input;

    // The suggestion group lives on the company row, not its settings.
    if (suggestionNotificationGroup) {
      const { error } = await ctx.asCaller.supabase
        .from("company")
        .update({ suggestionNotificationGroup })
        .eq("id", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update suggestion notifications",
          error
        );
      }
    }

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update dispatch notifications"
    );
    return saved ?? input;
  }
});

/**
 * Update the sales settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether a customer needs a
 * contact and location, whether customer readable ids show, the digital quote
 * (on or off, who is notified, and whether accepting one asks for a purchase
 * order), who is notified when an RFQ is ready and when a sales rule is
 * broken, and the default markup per cost category on a quote line.
 *
 * @mcp
 */
export const updateSalesSettings = defineServiceFn({
  input: z.object({
    requireCustomerContactAndLocation: z.boolean().optional(),
    showCustomerReadableId: z.boolean().optional(),
    digitalQuoteEnabled: z.boolean().optional(),
    digitalQuoteNotificationGroup: notificationGroup.optional(),
    digitalQuoteIncludesPurchaseOrders: z.boolean().optional(),
    rfqReadyNotificationGroup: notificationGroup.optional(),
    salesRuleNotificationGroup: notificationGroup.optional(),
    quoteLineCategoryMarkups: z
      .object({
        materialCost: z.number().min(0),
        partCost: z.number().min(0),
        toolCost: z.number().min(0),
        consumableCost: z.number().min(0),
        laborCost: z.number().min(0),
        machineCost: z.number().min(0),
        overheadCost: z.number().min(0),
        outsideCost: z.number().min(0)
      })
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await service.saveCompanySettings(
      ctx,
      input,
      "Failed to update sales settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the people settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether timecards are on, and
 * whether console (kiosk) mode is on. Console mode is a Business plan
 * feature. Turning it on creates the "Console Operator" employee type, and
 * for a signed-in user who has no console PIN yet it generates one: `pin` is
 * returned once and can never be read back. `pinError` says why that PIN
 * could not be created; console mode is on regardless. A key caller gets no
 * PIN.
 */
export const updatePeopleSettings = defineServiceFn({
  input: z.object({
    timeCardEnabled: z.boolean().optional(),
    consoleEnabled: z.boolean().optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const { consoleEnabled, ...settings } = input;

    const saved = await service.saveCompanySettings(
      ctx,
      settings,
      "Failed to update timecard settings"
    );
    if (saved) return saved;
    if (consoleEnabled === undefined) {
      return { ...input, pin: null, pinError: null };
    }

    let update: Awaited<ReturnType<typeof updateConsoleSetting>>;
    try {
      update = await updateConsoleSetting(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        consoleEnabled,
        ctx.actor.type === "user" ? ctx.actor.userId : undefined
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error(
        "entitlement",
        "Console mode requires the Business plan"
      );
    }
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update console mode",
        update.error
      );
    }
    return { ...input, pin: update.pin, pinError: update.pinError };
  }
});

/**
 * Turn the company-wide two-factor requirement on or off.
 *
 * @remarks
 * Requiring two-factor authentication is a Business plan feature; turning it
 * off is always allowed, so a downgraded company is never locked out. When it
 * goes from off to on, every active employee is emailed. It is not announced
 * when the stored value was already on, when the stored value cannot be read,
 * or in a controlled environment, where two-factor is mandatory from the day
 * of deployment.
 *
 * @mcp
 */
export const updateSecuritySettings = defineServiceFn({
  input: z.object({ requireMfa: z.boolean() }),
  permission: { update: "settings" },
  async run(ctx, { requireMfa }) {
    // Read first: the switch re-submits on every flip, and a toggle that
    // lands on the value it already had must not re-announce.
    const previous = await ctx.asCaller.supabase
      .from("companySettings")
      .select("requireMfa")
      .eq("id", ctx.company.id)
      .single();

    let update: Awaited<ReturnType<typeof updateRequireMfaSetting>>;
    try {
      update = await updateRequireMfaSetting(
        ctx.asCaller.supabase,
        ctx.company.id,
        requireMfa
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error(
        "entitlement",
        "Upgrade to Business to require two-factor authentication"
      );
    }
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update two-factor requirement",
        update.error
      );
    }

    if (
      !CONTROLLED_ENVIRONMENT &&
      requireMfa &&
      previous.data?.requireMfa === false
    ) {
      await sendMfaRequiredEmails(ctx.asSystem.supabase, ctx.company.id);
    }
    return { requireMfa };
  }
});

const employeeOrNone = z.string().min(1).nullable();

/**
 * Update the planning settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest. The planning action owner
 * ladder: the company default responsible employee, one location's
 * responsible employee, and one item group's at a location (null clears a
 * rung, so it inherits from the one above). Each employee must be an active
 * employee of the company. A location is a resources record: without the
 * resources update permission it is refused. Then whether purchase orders
 * the planning pages raise skip approval, the reschedule tolerance in days,
 * the default planning horizon in days (null for no time fence), the forecast
 * consumption window in weekly periods back and forward, and the time of day
 * scheduled MRP runs on the company's clock ("HH:MM" or "HH:MM:SS"; null runs
 * it every 3 hours).
 *
 * @mcp
 */
export const updatePlanningSettings = defineServiceFn({
  input: z.object({
    defaultResponsibleEmployee: employeeOrNone.optional(),
    locationResponsibleEmployee: z
      .object({
        locationId: z.string().min(1),
        responsibleEmployee: employeeOrNone
      })
      .optional(),
    itemGroupResponsibleEmployee: z
      .object({
        locationId: z.string().min(1),
        itemPostingGroupId: z.string().min(1),
        responsibleEmployee: employeeOrNone
      })
      .optional(),
    skipApprovalForPlanningPurchaseOrders: z.boolean().optional(),
    rescheduleToleranceDays: z.number().int().min(0).max(365).optional(),
    defaultPlanningHorizonDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullable()
      .optional(),
    forecastConsumptionBackwardPeriods: z
      .number()
      .int()
      .min(0)
      .max(52)
      .optional(),
    forecastConsumptionForwardPeriods: z
      .number()
      .int()
      .min(0)
      .max(52)
      .optional(),
    mrpRunTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
        message: "Choose a time for the daily MRP run"
      })
      .nullable()
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = service.nothingSent(ctx, input);
    if (refused) return refused;
    const {
      locationResponsibleEmployee: location,
      itemGroupResponsibleEmployee: itemGroup,
      mrpRunTime,
      ...settings
    } = input;

    const employees = [
      settings.defaultResponsibleEmployee,
      location?.responsibleEmployee,
      itemGroup?.responsibleEmployee
    ].filter((id): id is string => !!id);
    for (const employeeId of new Set(employees)) {
      if (
        !(await isActiveCompanyEmployee(
          ctx.asCaller.supabase,
          ctx.company.id,
          employeeId
        ))
      ) {
        return ctx.error("rule", "Choose an employee of this company");
      }
    }

    const saved = await service.saveCompanySettings(
      ctx,
      {
        ...settings,
        mrpRunTime:
          mrpRunTime === undefined
            ? undefined
            : mrpRunTime && parseTime(mrpRunTime).toString()
      },
      "Failed to update planning settings"
    );
    if (saved) return saved;

    if (location) {
      const result = await service.setLocationResponsibleEmployee(
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          locationId: location.locationId,
          employeeId: location.responsibleEmployee,
          userId: ctx.auditUserId
        }
      );
      if (result.error) {
        return ctx.error(
          "internal",
          "Failed to update location ownership",
          result.error
        );
      }
      // No row back: the location is not this company's, or the caller lacks
      // resources_update and row-level security matched nothing.
      if ((result.data?.length ?? 0) === 0) {
        return ctx.error(
          "forbidden",
          "You do not have permission to change this location"
        );
      }
    }

    if (itemGroup) {
      const result = await service.upsertItemPostingGroupResponsibility(
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          locationId: itemGroup.locationId,
          itemPostingGroupId: itemGroup.itemPostingGroupId,
          employeeId: itemGroup.responsibleEmployee,
          userId: ctx.auditUserId
        }
      );
      if (result.error) {
        return ctx.error(
          "internal",
          "Failed to update item group ownership",
          result.error
        );
      }
    }
    return input;
  }
});
/**
 * Update the company's details.
 *
 * @remarks
 * Writes the company's name, address, time zone, base currency, tax and
 * registration numbers and contact details. Changing the base currency also
 * deletes every exchange-rate override, in the same transaction: an override
 * is denominated in the old base and would rate every new document wrong.
 * The company's cached time zone is dropped, so a new one applies at once.
 *
 * @mcp
 */
export const updateCompanyDetails = defineServiceFn({
  input: companyValidator,
  permission: { update: "settings" },
  async run(ctx, company) {
    const existing = await ctx.asCaller.supabase
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", ctx.company.id)
      .single();

    const baseCurrencyChanged =
      !!existing.data?.baseCurrencyCode &&
      existing.data.baseCurrencyCode !== company.baseCurrencyCode;

    if (baseCurrencyChanged) {
      try {
        await service.updateCompanyWithBaseCurrencyChange(
          ctx.asSystem.pg,
          ctx.company.id,
          { ...company, updatedBy: ctx.auditUserId }
        );
      } catch (err) {
        return ctx.error("internal", "Failed to update company", err);
      }
    } else {
      const update = await service.updateCompany(
        ctx.asCaller.supabase,
        ctx.company.id,
        { ...company, updatedBy: ctx.auditUserId }
      );
      if (update.error) {
        return ctx.error("internal", "Failed to update company", update.error);
      }
    }

    await invalidateCompanyTimeZone(ctx.company.id);
    return { id: ctx.company.id };
  }
});
/**
 * Create a company in a new company group, for the caller.
 *
 * @remarks
 * Inserts the company, seeds it (chart of accounts, sequences, the caller's
 * employee record and permissions), creates its Headquarters location at the
 * company's address and the caller's job there. In a controlled environment
 * audit logging is on from the start. Returns the new company and its group,
 * so the caller can switch to it.
 */
export const createCompany = defineServiceFn({
  input: companyValidator,
  permission: { update: ["settings", "users"] },
  async run(ctx, company) {
    const client = ctx.asSystem.supabase;
    const inserted = await service.insertCompany(client, company);
    if (inserted.error || !inserted.data?.id) {
      return ctx.error("internal", "Failed to create company", inserted.error);
    }
    const companyId = inserted.data.id;

    const seed = await invokePosting(
      { db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId },
      "seed-company",
      { identityOnly: false },
      service.seedCompany
    );
    if (seed.error) {
      return ctx.error("internal", "Failed to seed company", seed.error);
    }

    const { baseCurrencyCode: _, ...location } = company;
    const headquarters = await service.createHeadquarters(
      ctx,
      companyId,
      location
    );
    if (headquarters) return headquarters;

    const { data } = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();
    return { companyId, companyGroupId: data?.companyGroupId ?? "" };
  }
});

/**
 * Create a company in the caller's company group.
 *
 * @remarks
 * Open to internal users only, for now. The parent must be a company of the
 * caller's own group: seeding joins the new company to its parent's group,
 * so a parent from another group would place it inside another tenant. Then
 * as for a new company: insert, seed, the Headquarters location and the
 * caller's job there.
 */
export const createSubsidiary = defineServiceFn({
  input: subsidiaryValidator,
  permission: { create: "settings" },
  async run(ctx, subsidiary) {
    const refused = await service.refuseUnlessInternalUser(ctx);
    if (refused) return refused;

    const { id: _, parentCompanyId, ...company } = subsidiary;
    const client = ctx.asSystem.supabase;

    if (parentCompanyId) {
      const parent = await client
        .from("company")
        .select("id")
        .eq("id", parentCompanyId)
        .eq("companyGroupId", ctx.company.groupId)
        .maybeSingle();
      if (parent.error || !parent.data) {
        return ctx.error("notFound", "Parent company not found", parent.error);
      }
    }

    const inserted = await service.insertCompany(client, company);
    if (inserted.error || !inserted.data?.id) {
      return ctx.error("internal", "Failed to create company", inserted.error);
    }
    const companyId = inserted.data.id;

    const seed = await invokePosting(
      { db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId },
      "seed-company",
      { parentCompanyId, identityOnly: false },
      service.seedCompany
    );
    if (seed.error) {
      return ctx.error("internal", "Failed to seed company", seed.error);
    }

    const { baseCurrencyCode: __, ...location } = company;
    const headquarters = await service.createHeadquarters(
      ctx,
      companyId,
      location
    );
    return headquarters ?? { companyId };
  }
});

/**
 * Update a company of the caller's company group.
 *
 * @remarks
 * Open to internal users only, for now. Writes the company's details and its
 * parent, then drops its cached time zone.
 */
export const updateSubsidiaryDetails = defineServiceFn({
  input: subsidiaryValidator.safeExtend({ id: z.string() }),
  permission: { update: "settings" },
  async run(ctx, { id, ...subsidiary }) {
    const refused = await service.refuseUnlessInternalUser(ctx);
    if (refused) return refused;

    const result = await service.updateSubsidiary(ctx.asCaller.supabase, id, {
      ...subsidiary,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update subsidiary", result.error);
    }
    await invalidateCompanyTimeZone(id);
    return { id };
  }
});
/**
 * Create or update a printer route.
 *
 * @remarks
 * A printer route is a printer the company prints to: its name, format (ZPL
 * labels or PDF documents), media size, URL and optional API key, location
 * and template. With an `id` the company's route is updated, without one a
 * route is created. The cached printer routing is dropped, so the change
 * applies to the next print. Not published: the server POSTs to the URL it
 * saves, so an API caller could aim it at any address.
 */
export const savePrinterRoute = defineServiceFn({
  input: printerRouteValidator,
  permission: { update: "settings" },
  async run(ctx, route) {
    const result = await upsertPrinterRoute(ctx.asCaller.supabase, {
      id: route.id || undefined,
      companyId: ctx.company.id,
      name: route.name,
      format: route.format,
      mediaSizeId: route.mediaSizeId || null,
      printerUrl: route.printerUrl,
      apiKey: route.apiKey || null,
      locationId: route.locationId || null,
      templateId: route.templateId || null
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to save printer route",
        result.error
      );
    }
    await invalidatePrinterCache(ctx.company.id);
    return { created: !route.id };
  }
});

/**
 * Send a test label to a printer route.
 *
 * @remarks
 * Prints one ZPL test label, sized to the route's media, on the company's
 * printer route. Only a ZPL route with a media size can print one. The
 * printer must answer within 10 seconds.
 */
export const testPrinterRoute = defineServiceFn({
  input: z.object({ routeId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { routeId }) {
    const { data: route } = await ctx.asCaller.supabase
      .from("printerRoute")
      .select("printerUrl, format, mediaSizeId, apiKey")
      .eq("id", routeId)
      .eq("companyId", ctx.company.id)
      .single();
    if (!route) return ctx.error("notFound", "Printer route not found");

    const testLabel = service.generateTestLabel(
      route.format,
      route.mediaSizeId
    );
    if (!testLabel) {
      return ctx.error(
        "rule",
        "Test print is only supported for ZPL label printers with a media size configured."
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream"
    };
    if (route.apiKey) headers["X-API-Key"] = route.apiKey;

    try {
      const response = await fetch(route.printerUrl, {
        method: "POST",
        headers,
        body: testLabel,
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        return ctx.error(
          "unavailable",
          `Print failed (${response.status} ${response.statusText})`
        );
      }
    } catch (err) {
      return ctx.error(
        "unavailable",
        `Print failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        err
      );
    }
    return { routeId };
  }
});

/**
 * Delete a printer route.
 *
 * @remarks
 * Deletes the company's printer route, then clears it from every printer
 * assignment that named it (a location's default, its shipping and receiving
 * printers, and its work centers), so no assignment points at a printer that
 * is gone. The cached printer routing is dropped.
 *
 * @mcp destructive
 */
export const removePrinterRoute = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const result = await deletePrinterRoute(client, id, ctx.company.id);
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to delete printer route",
        result.error
      );
    }

    const { data: existing } = await getPrintingSettings(
      client,
      ctx.company.id
    );
    const current = existing?.printing as PrintingSettings | null;
    if (current?.assignments) {
      let dirty = false;
      const assignments = { ...current.assignments };
      for (const [locationId, location] of Object.entries(assignments)) {
        if (!location) continue;
        const next = { ...location };
        if (next.defaultPrinterRouteId === id) {
          next.defaultPrinterRouteId = null;
          dirty = true;
        }
        if (next.shipping?.printerRouteId === id) {
          next.shipping = { ...next.shipping, printerRouteId: null };
          dirty = true;
        }
        if (next.receiving?.printerRouteId === id) {
          next.receiving = { ...next.receiving, printerRouteId: null };
          dirty = true;
        }
        if (next.workCenters) {
          const workCenters = { ...next.workCenters };
          for (const [workCenterId, workCenter] of Object.entries(
            workCenters
          )) {
            if (workCenter?.printerRouteId === id) {
              workCenters[workCenterId] = {
                ...workCenter,
                printerRouteId: null
              };
              dirty = true;
            }
          }
          next.workCenters = workCenters;
        }
        assignments[locationId] = next;
      }
      if (dirty) {
        await updatePrintingSettings(client, ctx.company.id, {
          ...current,
          assignments
        });
      }
    }

    await invalidatePrinterCache(ctx.company.id);
    return { id };
  }
});

/**
 * Assign a printer to a location, one of its contexts or a work center.
 *
 * @remarks
 * Sets which printer route a location prints to by default, for shipping,
 * for receiving, or at one of its work centers (`contextId` names the work
 * center), and whether it prints automatically. An empty route clears the
 * assignment, so the context falls back to the location's default. The
 * cached printer routing is dropped.
 *
 * @mcp
 */
export const assignPrinter = defineServiceFn({
  input: updateAssignmentValidator,
  permission: { update: "settings" },
  async run(ctx, assignment) {
    const client = ctx.asCaller.supabase;
    const { data: existing } = await getPrintingSettings(
      client,
      ctx.company.id
    );
    const current = (existing?.printing as PrintingSettings | null) ?? {
      assignments: {}
    };
    const updated = setContextAssignment(
      current,
      assignment.locationId,
      assignment.context,
      {
        printerRouteId: assignment.printerRouteId || null,
        autoPrint: assignment.autoPrint
      },
      assignment.contextId
    );

    const result = await updatePrintingSettings(
      client,
      ctx.company.id,
      updated
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update the printer assignment",
        result.error
      );
    }
    await invalidatePrinterCache(ctx.company.id);
    return { locationId: assignment.locationId };
  }
});

/**
 * Print a print job again.
 *
 * @remarks
 * Queues a new print job with the company's original job's content, to its
 * printer or to `printerUrl` when given, and starts its delivery. A job still
 * generating has no content and cannot be reprinted. Not published: the
 * server POSTs to `printerUrl`, so an API caller could aim it at any address.
 */
export const reprintPrintJob = defineServiceFn({
  input: reprintValidator,
  permission: { update: "settings" },
  async run(ctx, { printJobId, printerUrl }) {
    const client = ctx.asCaller.supabase;
    const [original, originalMeta] = await Promise.all([
      getPrintJobContent(client, printJobId, ctx.company.id),
      getPrintJob(client, printJobId, ctx.company.id)
    ]);
    if (
      original.error ||
      !original.data ||
      originalMeta.error ||
      !originalMeta.data
    ) {
      return ctx.error(
        "notFound",
        "Failed to load print job",
        original.error ?? originalMeta.error
      );
    }
    if (!original.data.content || !original.data.contentType) {
      return ctx.error("rule", "Cannot reprint a job that is still generating");
    }

    const job = await createPrintJob(client, {
      companyId: ctx.company.id,
      contentType: original.data.contentType as "zpl" | "pdf",
      content: original.data.content,
      printerUrl: printerUrl || originalMeta.data.printerUrl,
      sourceDocument: originalMeta.data.sourceDocument,
      sourceDocumentId: originalMeta.data.sourceDocumentId,
      sourceDocumentReadableId:
        originalMeta.data.sourceDocumentReadableId ?? undefined,
      description: originalMeta.data.description,
      status: "queued",
      origin: "reprint",
      createdBy: ctx.auditUserId
    });
    if (job.error || !job.data) {
      return ctx.error("internal", "Failed to create reprint", job.error);
    }

    try {
      await trigger("print-job-deliver", {
        printJobId: job.data.id,
        companyId: ctx.company.id
      });
    } catch (err) {
      logger.error("Failed to trigger delivery", {
        companyId: ctx.company.id,
        error: err
      });
    }
    return { printJobId: job.data.id };
  }
});

/**
 * Delete a print job.
 *
 * @remarks
 * Deletes the company's print job from the print queue history.
 *
 * @mcp destructive
 */
export const deletePrintJob = defineServiceFn({
  input: z.object({ printJobId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { printJobId }) {
    const { error } = await ctx.asCaller.supabase
      .from("printJob")
      .delete()
      .eq("id", printJobId)
      .eq("companyId", ctx.company.id);
    if (error) return ctx.error("internal", "Failed to delete job", error);
    return { id: printJobId };
  }
});

/** What a print job printed: its ZPL or PDF content. */
export const viewPrintJobContent = defineServiceFn({
  input: z.object({ printJobId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { printJobId }) {
    const content = await getPrintJobContent(
      ctx.asCaller.supabase,
      printJobId,
      ctx.company.id
    );
    if (content.error || !content.data) {
      return ctx.error("notFound", "Failed to load content", content.error);
    }
    return {
      printJobId: content.data.id,
      content: content.data.content,
      contentType: content.data.contentType
    };
  }
});

/**
 * Save a document's layout.
 *
 * @remarks
 * Writes the company's template for one document type: its blocks, theme,
 * settings and the header and footer sections it uses. The logo and header
 * layout (`headerConfig`) is edited with the template but lives on the
 * company-wide header section, so it is saved onto that section first, with
 * the section's name and content kept, and applies wherever the header is
 * used. A built-in header section is forked into the company's own copy.
 *
 * @mcp
 */
export const saveDocumentTemplate = defineServiceFn({
  input: z.object({
    documentType: documentTemplateTypeSchema,
    blocks: z.array(blockSchema),
    theme: themeSchema,
    settings: documentSettingsSchema,
    headerSectionId: z.string().optional(),
    footerSectionId: z.string().optional(),
    headerConfig: sectionConfigSchema.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, template) {
    const client = ctx.asCaller.supabase;
    const { headerConfig, headerSectionId } = template;

    if (headerConfig && headerSectionId) {
      const resolved = await service.resolveSections(client, ctx.company.id, [
        headerSectionId
      ]);
      const header = resolved[headerSectionId];
      const section = await service.upsertDocumentSection(client, {
        id: headerSectionId,
        companyId: ctx.company.id,
        name: header?.name ?? "Default Header",
        placement: "header",
        content: (header?.content ?? {
          type: "doc",
          content: []
        }) as JSONContent,
        config: headerConfig as Record<string, unknown>,
        createdBy: ctx.auditUserId,
        updatedBy: ctx.auditUserId
      });
      if (section.error) {
        return ctx.error("internal", "Failed to save header", section.error);
      }
    }

    const upsert = await service.upsertDocumentTemplate(client, {
      companyId: ctx.company.id,
      documentType: template.documentType,
      blocks: template.blocks as DocumentBlock[],
      theme: template.theme as DocumentTheme,
      settings: template.settings as DocumentSettings,
      headerSectionId: headerSectionId || null,
      footerSectionId: template.footerSectionId || null,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return ctx.error(
        "internal",
        "Failed to save document layout",
        upsert.error
      );
    }
    return { documentType: template.documentType };
  }
});

/**
 * Create or update a shared document section.
 *
 * @remarks
 * A section is company-wide rich text placed in a document's header, body or
 * footer. With an `id` the section is updated; editing a built-in section
 * forks it into the company's own copy under the same id, which then
 * overrides the built-in everywhere it is used. Without an `id` a section is
 * created.
 *
 * @mcp
 */
export const saveDocumentSection = defineServiceFn({
  input: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    placement: documentSectionPlacementSchema,
    content: z.record(z.string(), z.unknown()),
    config: sectionConfigSchema.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, { id, name, placement, content, config }) {
    const result = await service.upsertDocumentSection(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      name,
      placement,
      content: content as JSONContent,
      config: config as Record<string, unknown> | undefined,
      ...(id ? { updatedBy: ctx.auditUserId } : { createdBy: ctx.auditUserId })
    });
    if (result.error) {
      return ctx.error("internal", "Failed to save section", result.error);
    }
    return { saved: true };
  }
});

/**
 * Delete a shared document section.
 *
 * @remarks
 * Templates refer to their header and footer sections without a foreign
 * key: a template that used the deleted section renders without it.
 *
 * @mcp destructive
 */
export const removeDocumentSection = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    const result = await service.deleteDocumentSection(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error("internal", "Failed to delete section", result.error);
    }
    return { id };
  }
});

const apiKeyFields = {
  name: apiKeyValidator.shape.name,
  expiresAt: apiKeyValidator.shape.expiresAt,
  /** Per module, the actions the key may run: `{ "sales": ["view"] }`. */
  scopes: z.record(z.string(), z.array(z.string()))
};
/**
 * Create an API key.
 *
 * @remarks
 * Generates the key, stores only its hash and last five characters, and
 * returns the raw key once: it can never be read back. API keys are a
 * Business plan feature.
 */
export const createApiKey = defineServiceFn({
  input: z.object(apiKeyFields),
  permission: { update: "users" },
  async run(ctx, { name, scopes, expiresAt }) {
    const rawKey = `crbn_${nanoid()}`;
    let created: Awaited<ReturnType<typeof upsertApiKey>>;
    try {
      created = await upsertApiKey(ctx.asCaller.supabase, {
        name,
        scopes,
        expiresAt: expiresAt || undefined,
        rawKey,
        keyHash: hashApiKey(rawKey),
        keyPreview: rawKey.slice(-5),
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      });
    } catch (err) {
      return service.apiKeysEntitlement(ctx, err);
    }
    const key = created.data && "key" in created.data ? created.data.key : null;
    if (created.error || !key) {
      return ctx.error("internal", "Failed to create API key", created.error);
    }
    return { key };
  }
});

/**
 * Update an API key's name, scopes and expiry.
 *
 * @remarks
 * The key itself never changes. Its cached authentication is dropped, so a
 * narrower scope or an earlier expiry applies at once.
 */
export const updateApiKey = defineServiceFn({
  input: z.object({ id: z.string().min(1), ...apiKeyFields }),
  permission: { update: "users" },
  async run(ctx, { id, name, scopes, expiresAt }) {
    let updated: Awaited<ReturnType<typeof upsertApiKey>>;
    try {
      updated = await upsertApiKey(ctx.asCaller.supabase, {
        id,
        name,
        scopes,
        expiresAt: expiresAt || undefined
      });
    } catch (err) {
      return service.apiKeysEntitlement(ctx, err);
    }
    if (updated.error) {
      return ctx.error("internal", "Failed to update API key", updated.error);
    }
    // A scope or expiry edit must not keep authenticating from the 30s cache.
    await service.invalidateApiKeyCache(id, ctx.company.id);
    return { id };
  }
});

/**
 * Delete an API key.
 *
 * @remarks
 * The key stops authenticating: its cached authentication is dropped before
 * the delete (the key's hash cannot be read once the row is gone) and again
 * after it, in case a request re-cached the live row in between.
 */
export const revokeApiKey = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "users" },
  async run(ctx, { id }) {
    const keyHash = await service.invalidateApiKeyCache(id, ctx.company.id);
    let deleted: Awaited<ReturnType<typeof deleteApiKey>>;
    try {
      deleted = await deleteApiKey(ctx.asCaller.supabase, id);
    } catch (err) {
      return service.apiKeysEntitlement(ctx, err);
    }
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete API key", deleted.error);
    }
    if (keyHash) await bustApiKeyCache(keyHash);
    return { id };
  }
});

/**
 * Disconnect an integration.
 *
 * @remarks
 * Marks the company's integration inactive, runs the integration's own
 * uninstall step (removing its webhooks, for example) and drops its cached
 * health. Integrations outside the always-available set need the plan's
 * integrations feature.
 *
 * @mcp destructive
 */
export const deactivateCompanyIntegration = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    if (
      !isIntegrationWhitelisted(id) &&
      !(await companyHasFeature(ctx.asCaller.supabase, ctx.company.id, {
        feature: "INTEGRATIONS"
      }))
    ) {
      return ctx.error("entitlement", "Integrations require an upgraded plan");
    }

    const integration = availableIntegrations.find((i) => i.id === id);
    if (!integration) return ctx.error("notFound", "Integration not found");

    const update = await service.deactivateIntegration(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to disconnect integration",
        update.error
      );
    }

    const hooks = getIntegrationServerHooks(id);
    if (hooks?.onUninstall) await hooks.onUninstall(ctx.company.id);

    await service.invalidateIntegrationHealthCache(id, ctx.company.id);
    return { id, name: integration.name };
  }
});

/**
 * Turn audit logging on.
 *
 * @remarks
 * Records every change to the company's audited tables from now on. Audit
 * logging is a Business plan feature.
 *
 * @mcp
 */
export const enableCompanyAuditLog = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    try {
      await enableAuditLog(ctx.asCaller.supabase, ctx.company.id);
    } catch (err) {
      if (err instanceof EntitlementError) {
        return ctx.error(
          "entitlement",
          "Upgrade to Business to enable audit logging"
        );
      }
      return ctx.error("internal", "Failed to enable audit logging", err);
    }
    return { auditLogEnabled: true };
  }
});

/**
 * Turn audit logging off.
 *
 * @remarks
 * Stops recording changes; the log written so far is kept. A controlled
 * environment cannot turn audit logging off.
 *
 * @mcp destructive
 */
export const disableCompanyAuditLog = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    if (CONTROLLED_ENVIRONMENT) {
      return ctx.error(
        "rule",
        "Audit logging cannot be disabled in a controlled environment"
      );
    }
    try {
      await disableAuditLog(ctx.asCaller.supabase, ctx.company.id);
    } catch (err) {
      return ctx.error("internal", "Failed to disable audit logging", err);
    }
    return { auditLogEnabled: false };
  }
});

/** A signed URL that downloads one of the company's audit log archives. */
export const getAuditArchiveDownloadUrl = defineServiceFn({
  input: z.object({ archiveId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { archiveId }) {
    try {
      const url = await getArchiveDownloadUrl(
        ctx.asSystem.supabase,
        archiveId,
        ctx.company.id
      );
      return { url };
    } catch (err) {
      return ctx.error("internal", "Failed to generate download URL", err);
    }
  }
});

/** A Stripe billing portal session for the company, for its subscription. */
export const getBillingPortalUrl = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    try {
      const plans = await ctx.asCaller.supabase
        .from("plan")
        .select("stripePriceId")
        .eq("userBasedPricing", true);
      const priceIds = plans.data?.map((plan) => plan.stripePriceId);
      const url = await getBillingPortalRedirectUrl({
        companyId: ctx.company.id,
        priceIds
      });
      return { url };
    } catch (err) {
      return ctx.error("internal", "Failed to access billing portal", err);
    }
  }
});

/**
 * Transfer ownership of the company group to another user.
 *
 * @remarks
 * The owner holds billing and the group's administrative settings.
 */
export const transferCompanyOwnership = defineServiceFn({
  input: z.object({ newOwnerId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { newOwnerId }) {
    const { error } = await ctx.asCaller.supabase
      .from("companyGroup")
      .update({ ownerId: newOwnerId })
      .eq("id", ctx.company.groupId);
    if (error) {
      return ctx.error("internal", "Failed to transfer ownership", error);
    }
    return { ownerId: newOwnerId };
  }
});

/**
 * Set the tags of some records of one table.
 *
 * @remarks
 * Replaces the `tags` of each record. Row-level security decides which
 * records the caller may change.
 */
export const setRecordTags = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    ids: z.array(z.string()),
    tags: z.array(z.string())
  }),
  permission: {},
  async run(ctx, { table, ids, tags }) {
    const { error } = await ctx.asCaller.supabase
      // @ts-expect-error: the table is the caller's, for any taggable record
      .from(table)
      .update(
        unchecked({
          tags,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in(unchecked("id"), ids);
    if (error) return ctx.error("internal", "Failed to update tags", error);
    return { ids };
  }
});

/**
 * Set the custom field values of some records of one table.
 *
 * @remarks
 * Replaces the `customFields` of each record. Row-level security decides
 * which records the caller may change.
 */
export const setRecordCustomFields = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    ids: z.array(z.string()),
    customFields: z.record(z.string(), z.unknown())
  }),
  permission: {},
  async run(ctx, { table, ids, customFields }) {
    const { error } = await ctx.asCaller.supabase
      // @ts-expect-error: the table is the caller's, for any record with custom fields
      .from(table)
      .update(
        unchecked({
          customFields,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in(unchecked("id"), ids);
    if (error) {
      return ctx.error("internal", "Failed to update custom fields", error);
    }
    return { ids };
  }
});

/**
 * Retry, re-send or skip accounting sync operations.
 *
 * @remarks
 * "Pending" queues each operation for sync again (retry, re-send);
 * "Skipped" drops it from the inbox. Each operation's transition is checked
 * against its current status, and one that cannot move is reported.
 *
 * @mcp
 */
export const transitionSyncOperations = defineServiceFn({
  input: z.object({
    ids: z
      .array(z.string().min(1))
      .min(1, { message: "No operations selected" })
      .max(500, { message: "Select at most 500 operations at once" }),
    to: z.enum(["Pending", "Skipped"])
  }),
  permission: { update: "settings" },
  async run(ctx, { ids, to }) {
    const result = await service.transitionSyncOperations(
      ctx.asCaller.supabase,
      { ids, companyId: ctx.company.id, to, userId: ctx.auditUserId }
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update sync operations",
        result.error
      );
    }
    if (result.failures.length > 0) {
      logger.warn("Sync operations were not transitioned", {
        companyId: ctx.company.id,
        to,
        failures: result.failures
      });
      return ctx.error(
        "rule",
        result.moved > 0
          ? `Updated ${result.moved} of ${result.moved + result.failures.length} sync operations`
          : "Failed to update sync operation",
        result.failures
      );
    }
    return { count: result.moved, to };
  }
});

/** Propose provider accounts for unmapped Carbon accounts, with AI. Writes nothing. */
export const suggestAccountMappings = defineServiceFn({
  input: z.object({
    accounts: z.array(
      z.object({
        id: z.string().min(1),
        number: z.string().nullable(),
        name: z.string()
      })
    ),
    providerAccounts: z.array(
      z.object({
        id: z.string().min(1),
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional()
      })
    )
  }),
  permission: { update: "settings" },
  async run(ctx, { accounts, providerAccounts }) {
    const result = await suggestAccountMatchesWithAI({
      accounts,
      providerAccounts
    });
    if (result.error || !result.data) {
      return ctx.error(
        "internal",
        "Failed to suggest account mappings",
        result.error
      );
    }
    return { proposals: result.data };
  }
});

/** Map Carbon accounts to an accounting integration's accounts. */
export const saveAccountMappings = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    mappings: z
      .array(accountMappingEntrySchema)
      .min(1, { message: "No account mappings to save" })
  }),
  permission: { update: "settings" },
  async run(ctx, { integrationId, mappings }) {
    const result = await upsertAccountMappings(ctx.asSystem.pg, {
      companyId: ctx.company.id,
      integration: integrationId,
      userId: ctx.auditUserId,
      mappings
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to save account mappings",
        result.error
      );
    }
    return { count: mappings.length };
  }
});
/**
 * Set which Carbon dimensions ride along on the journals pushed to an accounting integration.
 *
 * @remarks
 * Each slot pairs a Carbon dimension with one of the provider's analytics
 * targets; the slots are checked against the targets the provider declares
 * and its slot limit. No slots turns dimension sync off. Unmapped values are
 * warned about or dropped.
 *
 * @mcp
 */
export const updateDimensionSync = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    slots: z.array(dimensionSlotEntrySchema),
    onUnmappedDimensionValue: z.enum(["warn", "drop"])
  }),
  permission: { update: "settings" },
  async run(ctx, { integrationId, slots, onUnmappedDimensionValue }) {
    const providerTargets = await service.getProviderDimensionTargets(
      ctx.asCaller.supabase,
      ctx.company.id,
      integrationId
    );
    if (!providerTargets.supported) {
      return ctx.error(
        "rule",
        "This integration does not support dimension sync"
      );
    }
    // Clearing every slot is always allowed; validating a non-empty config
    // against a failed target fetch would reject every target as unknown.
    if (slots.length > 0 && providerTargets.targetsError) {
      return ctx.error(
        "unavailable",
        "Couldn't load the provider's dimension targets — try again"
      );
    }
    const slotErrors = validateDimensionSlots({
      slots,
      targets: providerTargets.targets,
      maxSlots: providerTargets.maxSlots ?? undefined
    });
    if (slotErrors.length > 0) {
      return ctx.error(
        "rule",
        "Invalid dimension slot configuration",
        slotErrors.join(" ")
      );
    }

    const existing = await service.integrationSettings(ctx, integrationId);
    if (!existing) {
      return ctx.error("notFound", "Failed to load integration settings");
    }
    const postingSync =
      (existing.settings.postingSync as Record<string, unknown> | undefined) ??
      {};

    // The v2 shim-marker keys are deliberately left in place: this does not
    // write the v3 sourceTypes record, so stripping them would make the
    // schema shim lose the stored v2 enabled set on the next read.
    const saved = await service.saveIntegrationMetadata(
      ctx,
      integrationId,
      existing.active ?? true,
      {
        ...existing.metadata,
        settings: {
          ...existing.settings,
          postingSync: {
            ...postingSync,
            dimensionSlots: slots,
            onUnmappedDimensionValue
          }
        }
      },
      "Failed to update dimension sync settings"
    );
    return saved ?? { integrationId };
  }
});

/** Map Carbon dimension values to an accounting integration's analytics values. */
export const saveDimensionValueMappings = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    mappings: z
      .array(dimensionValueMappingEntrySchema)
      .min(1, { message: "No dimension value mappings to save" })
  }),
  permission: { update: "settings" },
  async run(ctx, { integrationId, mappings }) {
    const failures: string[] = [];
    // ponytail: one upsert per value, as the match drawer confirms a page of
    // names; a batched upsert in the engine when it confirms thousands.
    for (const mapping of mappings) {
      const result = await upsertDimensionValueMapping(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        integration: integrationId,
        ...mapping,
        userId: ctx.auditUserId
      });
      if (result.error) failures.push(result.error);
    }
    if (failures.length > 0) {
      const succeeded = mappings.length - failures.length;
      return ctx.error(
        succeeded > 0 ? "rule" : "internal",
        succeeded > 0
          ? `Saved ${succeeded} of ${mappings.length} dimension value mappings`
          : mappings.length === 1
            ? "Failed to save dimension value mapping"
            : "Failed to save dimension value mappings",
        failures[0]
      );
    }
    return { count: mappings.length };
  }
});

/**
 * Turn an accounting integration's sync on or off.
 *
 * @remarks
 * A new connection starts with sync off. Turning it on is refused until
 * every required account is mapped, so the first push cannot park a wall of
 * unmapped-account warnings.
 *
 * @mcp
 */
export const setIntegrationSyncEnabled = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    syncEnabled: z.boolean()
  }),
  permission: { update: "settings" },
  async run(ctx, { integrationId, syncEnabled }) {
    const existing = await service.integrationSettings(ctx, integrationId);
    if (!existing?.active) {
      return ctx.error("notFound", "Failed to load integration settings");
    }

    if (syncEnabled) {
      const unmapped = await getUnmappedRequiredAccounts(ctx.asSystem.pg, {
        companyId: ctx.company.id,
        integration: integrationId
      });
      if (unmapped.error || !unmapped.data) {
        return ctx.error(
          "internal",
          "Failed to check the account mapping",
          unmapped.error
        );
      }
      if (unmapped.data.length > 0) {
        return ctx.error(
          "rule",
          `Map the remaining ${unmapped.data.length} required account${
            unmapped.data.length === 1 ? "" : "s"
          } before turning on sync`
        );
      }
    }

    const saved = await service.saveIntegrationMetadata(
      ctx,
      integrationId,
      existing.active,
      {
        ...existing.metadata,
        settings: { ...existing.settings, syncEnabled }
      },
      "Failed to update sync"
    );
    return saved ?? { syncEnabled };
  }
});

/**
 * Set how an accounting integration receives postings.
 *
 * @remarks
 * Posting sync is always on. Each journal-represented source type except
 * Manual is sent, individually or as a daily summary (`sourceTypeConfigs`:
 * "<source type>|individual" or "|daily-summary"; an unlisted type takes its
 * default). Receivables, payables, credit memos and supplier credits each go
 * as documents, as journals or not at all. A posting into a locked provider
 * period is parked or redated, and `lockDate` is the provider's lock date.
 * Keys this form does not own (the weekly reconciliation's) are kept.
 *
 * @mcp
 */
export const updatePostingSync = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    sourceTypeConfigs: z.array(
      z
        .string()
        .regex(
          /^[^|]+\|(individual|daily-summary)$/,
          "Malformed source-type config"
        )
    ),
    familyAr: z.enum(["documents", "journals", "none"]),
    familyAp: z.enum(["documents", "journals", "none"]),
    familyCreditMemo: z.enum(["documents", "journals", "none"]),
    familySupplierCredit: z.enum(["documents", "journals", "none"]),
    periodLockPolicy: z.enum(["park", "redate"]),
    lockDate: z.string().optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const granularityBySourceType = new Map(
      input.sourceTypeConfigs.map((config) => {
        const separator = config.lastIndexOf("|");
        return [
          config.slice(0, separator),
          config.slice(separator + 1) as "individual" | "daily-summary"
        ] as const;
      })
    );
    const sourceTypes: Record<
      string,
      { enabled: boolean; granularity: "individual" | "daily-summary" }
    > = {};
    for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
      if (POSTING_POLICY[sourceType].representation !== "journal") continue;
      if (sourceType === "Manual") continue;
      sourceTypes[sourceType] = {
        enabled: true,
        granularity:
          granularityBySourceType.get(sourceType) ??
          POSTING_POLICY[sourceType].defaultGranularity
      };
    }

    const existing = await service.integrationSettings(
      ctx,
      input.integrationId
    );
    if (!existing) {
      return ctx.error("notFound", "Failed to load integration settings");
    }

    // Saving writes the v3 shape: the v2 shim markers (includeManual,
    // consolidation, the legacy sourceTypes array) and the old master
    // `enabled` are dropped, or the schema shim would read the fragment as v2.
    const {
      includeManual: _includeManual,
      consolidation: _consolidation,
      sourceTypes: _legacySourceTypes,
      enabled: _enabled,
      ...postingSync
    } = (existing.settings.postingSync as
      | Record<string, unknown>
      | undefined) ?? {};

    const saved = await service.saveIntegrationMetadata(
      ctx,
      input.integrationId,
      existing.active ?? true,
      {
        ...existing.metadata,
        settings: {
          ...existing.settings,
          postingSync: {
            ...postingSync,
            families: {
              ar: input.familyAr,
              ap: input.familyAp,
              creditMemo: input.familyCreditMemo,
              supplierCredit: input.familySupplierCredit
            },
            sourceTypes,
            periodLockPolicy: input.periodLockPolicy,
            ...(input.lockDate ? { lockDate: input.lockDate } : {})
          }
        }
      },
      "Failed to update posting sync settings"
    );
    return saved ?? { integrationId: input.integrationId };
  }
});

/**
 * Map an OEE integration's device to a work center, or unmap it.
 *
 * @remarks
 * Only a station the current connection reports can be mapped: a list read
 * before the API key changed could name a station the provider does not
 * have, whose mapping would never sync. The stored name, site and time zone
 * are the provider's. No work center unmaps the device. OEE integrations are
 * a commercial feature.
 */
export const saveOeeDeviceMapping = defineServiceFn({
  input: z.object({
    integrationId: z.string().min(1),
    externalDeviceId: z.string().min(1),
    deviceName: z.string().min(1),
    workCenterId: z.string().optional()
  }),
  permission: { update: "settings" },
  async run(
    ctx,
    { integrationId, externalDeviceId, deviceName, workCenterId }
  ) {
    let device: OeeDevice | undefined;
    if (workCenterId) {
      const provider = await service.listOeeDevices(
        ctx.company.id,
        integrationId
      );
      device = provider.devices.find(
        (candidate) => candidate.externalDeviceId === externalDeviceId
      );
      if (!device) {
        return ctx.error(
          "rule",
          `Failed to save device mapping: ${
            provider.error ?? `${deviceName} is not a station of this provider`
          }`
        );
      }
    }

    let result: { error: string | null };
    try {
      result =
        workCenterId && device
          ? await upsertWorkCenterDevice(
              ctx.asCaller.supabase,
              ctx.asSystem.pg,
              {
                companyId: ctx.company.id,
                userId: ctx.auditUserId,
                integration: integrationId,
                externalDeviceId,
                externalSiteId: device.externalSiteId,
                siteTimezone: device.siteTimezone,
                deviceName: device.name,
                workCenterId
              }
            )
          : await deleteWorkCenterDevice(
              ctx.asCaller.supabase,
              ctx.asSystem.pg,
              {
                companyId: ctx.company.id,
                userId: ctx.auditUserId,
                integration: integrationId,
                externalDeviceId
              }
            );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error(
        "entitlement",
        `Failed to save device mapping: ${err.message}`
      );
    }
    if (result.error) {
      return ctx.error(
        "rule",
        `Failed to save device mapping: ${result.error}`
      );
    }
    return { externalDeviceId, workCenterId: workCenterId ?? null };
  }
});
/**
 * Get accounts payable billing address
 *
 * @mcp read
 */
export const getAccountsPayableBillingAddress = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAccountsPayableBillingAddress(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get accounts receivable billing address
 *
 * @mcp read
 */
export const getAccountsReceivableBillingAddress = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getAccountsReceivableBillingAddress(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get api keys
 *
 * @mcp
 */
export const getApiKeys = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { update: "users" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getApiKeys(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * List the companies the caller belongs to, with their logo URLs.
 *
 * @mcp read
 */
export const getCompanies = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCompanies(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * The companies a user can enter in the ERP
 *
 * @mcp read
 */
export const getEmployeeCompanies = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getEmployeeCompanies(ctx.asCaller.supabase, ctx.auditUserId)
    );
  }
});

/**
 * Get industries
 *
 * @mcp read
 */
export const getIndustries = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(ctx, await service.getIndustries(ctx.asCaller.supabase));
  }
});

/**
 * Get company
 *
 * @mcp read
 */
export const getCompany = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCompany(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get company settings
 *
 * @mcp read
 */
export const getCompanySettings = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getCompanySettings(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get config
 *
 * @mcp read
 */
export const getConfig = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(ctx, await service.getConfig(ctx.asCaller.supabase));
  }
});

/**
 * Get current sequence
 *
 * @mcp read
 */
export const getCurrentSequence = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCurrentSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get custom field
 *
 * @mcp read
 */
export const getCustomField = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomField(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get custom fields
 *
 * @mcp read
 */
export const getCustomFields = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomFields(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get custom fields tables
 *
 * @mcp read
 */
export const getCustomFieldsTables = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomFieldsTables(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get integration
 *
 * @mcp read
 */
export const getIntegration = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getIntegration(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get kanban output setting
 *
 * @mcp read
 */
export const getKanbanOutputSetting = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getKanbanOutputSetting(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Takes the next number of a sequence, which advances it
 *
 * @mcp
 */
export const getNextSequence = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getNextSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get plans
 *
 * @mcp read
 */
export const getPlans = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(ctx, await service.getPlans(ctx.asCaller.supabase));
  }
});

/**
 * Get sequence
 *
 * @mcp read
 */
export const getSequence = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get sequences
 *
 * @mcp read
 */
export const getSequences = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getSequences(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get sequences list
 *
 * @mcp read
 */
export const getSequencesList = defineServiceFn({
  input: z.looseObject({ table: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getSequencesList(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get item serial sequences
 *
 * @mcp read
 */
export const getItemSerialSequences = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getItemSerialSequences(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get item serial sequence
 *
 * @mcp read
 */
export const getItemSerialSequence = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getItemSerialSequence(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Create a item serial sequence
 *
 * @remarks
 * Upsert item serial sequence
 *
 * @mcp
 */
export const createItemSerialSequence = defineServiceFn({
  input: z.looseObject({
    itemId: z.string().min(1),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    next: z.number().min(0),
    step: z.number().min(1),
    size: z.number().min(1).max(20),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemSerialSequence(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a item serial sequence
 *
 * @remarks
 * Upsert item serial sequence
 *
 * @mcp
 */
export const updateItemSerialSequence = defineServiceFn({
  input: z
    .looseObject({
      itemId: z.string().min(1),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      next: z.number().min(0),
      step: z.number().min(1),
      size: z.number().min(1).max(20),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertItemSerialSequence(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete item serial sequence
 *
 * @mcp destructive
 */
export const deleteItemSerialSequence = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteItemSerialSequence(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get subsidiaries
 *
 * @mcp read
 */
export const getSubsidiaries = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSubsidiaries(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Get subsidiary
 *
 * @mcp read
 */
export const getSubsidiary = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getSubsidiary(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get terms
 *
 * @mcp read
 */
export const getTerms = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getTerms(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get document template
 *
 * @mcp read
 */
export const getDocumentTemplate = defineServiceFn({
  input: z.looseObject({
    documentType: z.enum([
      "purchaseOrder",
      "salesOrder",
      "stockTransfer",
      "salesInvoice",
      "quote",
      "purchaseReturnOrder",
      "salesReturnOrder",
      "issue",
      "packingSlip",
      "jobTraveler",
      "trackingLabel"
    ])
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDocumentTemplate(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.documentType as never
      )
    );
  }
});

/**
 * Load a stored document template as a `DocumentTemplate | null` ready to pass to a PDF (which runs it through `resolveTemplate`)
 *
 * @mcp read
 */
export const getDocumentTemplateConfig = defineServiceFn({
  input: z.looseObject({
    documentType: z.enum([
      "purchaseOrder",
      "salesOrder",
      "stockTransfer",
      "salesInvoice",
      "quote",
      "purchaseReturnOrder",
      "salesReturnOrder",
      "issue",
      "packingSlip",
      "jobTraveler",
      "trackingLabel"
    ])
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return await service.getDocumentTemplateConfig(
      ctx.asCaller.supabase,
      ctx.company.id,
      input.documentType as never
    );
  }
});

/**
 * Get document sections
 *
 * @mcp read
 */
export const getDocumentSections = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getDocumentSections(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Fetch the given section ids and return them keyed by id for rendering
 *
 * @mcp
 */
export const resolveSections = defineServiceFn({
  input: z.looseObject({ ids: z.array(z.string()) }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return await service.resolveSections(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input.ids).build() as never
    );
  }
});

/**
 * Get webhook
 *
 * @mcp read
 */
export const getWebhook = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWebhook(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get webhooks
 *
 * @mcp read
 */
export const getWebhooks = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "settings" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getWebhooks(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get webhook tables
 *
 * @mcp read
 */
export const getWebhookTables = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "settings" },
  async run(ctx) {
    return unwrap(ctx, await service.getWebhookTables(ctx.asCaller.supabase));
  }
});

/**
 * Update sequence
 *
 * @mcp
 */
export const updateSequence = defineServiceFn({
  input: z.looseObject({
    table: z.string(),
    sequence: z.looseObject({
      table: z.string().min(1).optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      next: z.number().min(0).optional(),
      step: z.number().min(1).optional(),
      size: z.number().min(1).max(20).optional()
    })
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateSequence(
        ctx.asCaller.supabase,
        input.table as never,
        ctx.company.id,
        payload(ctx, input.sequence).forUpdate() as never
      )
    );
  }
});

/**
 * Detach an item from the Onshape panel
 *
 * @remarks
 * Removes the item's `onshape-v2` link. The item keeps its model, documents
 * and fields. A sync connection's `onshape` row is bill-of-materials import
 * bookkeeping that the BoM Explorer reads, so it is never removed here.
 */
export const detachOnshapeItem = defineServiceFn({
  input: z.object({ itemId: z.string().min(1) }),
  permission: { update: "parts" },
  async run(ctx, { itemId }) {
    const removed = await ctx.asSystem.supabase
      .from("externalIntegrationMapping")
      .delete()
      .eq("companyId", ctx.company.id)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .select("id");
    if (removed.error) {
      return ctx.error(
        "internal",
        "Failed to detach from Onshape",
        removed.error
      );
    }
    if (removed.data.length === 0) {
      return ctx.error("notFound", "This item is not linked to Onshape");
    }
    return { itemId };
  }
});

/**
 * Save the Onshape panel's property map
 *
 * @remarks
 * Replaces the property map, the description modes and the push defaults.
 * Answers in the panel's own reply shape.
 */
export const saveOnshapePropertyMap = defineServiceFn({
  input: service.onshapePropertyMapInput,
  permission: { update: "settings" },
  run: (ctx, input) => service.saveOnshapePropertyMap(ctx, input)
});

/**
 * Push reviewed Onshape parts
 *
 * @remarks
 * Applies a part review from the Onshape panel: creates or adopts items,
 * links them, and queues their model exports. Answers in the panel's own
 * reply shape.
 */
export const pushOnshapePart = defineServiceFn({
  input: service.onshapePartPushInput,
  permission: { create: "parts", update: "parts" },
  run: (ctx, input) => service.pushOnshapePart(ctx, input)
});

/**
 * Push a reviewed Onshape assembly
 *
 * @remarks
 * Applies an assembly review from the Onshape panel: items, bill of material
 * lines per method, links and the model export. Re-pushing replaces the lines
 * an earlier push wrote. Answers in the panel's own reply shape.
 */
export const pushOnshapeAssembly = defineServiceFn({
  input: service.onshapeAssemblyPushInput,
  permission: { create: "parts", update: "parts", delete: "parts" },
  run: (ctx, input) => service.pushOnshapeAssembly(ctx, input)
});

/**
 * Push a reviewed Onshape release
 *
 * @remarks
 * Applies a release review from the Onshape panel. Carbon's state when it
 * applies outranks the review. Answers in the panel's own reply shape.
 */
export const pushOnshapeRelease = defineServiceFn({
  input: service.onshapeReleasePushInput,
  permission: { create: "parts", update: "parts", delete: "parts" },
  run: (ctx, input) => service.pushOnshapeRelease(ctx, input)
});
