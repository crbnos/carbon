import type { CarbonAccountClass, CarbonAccountType } from "@carbon/netsuite";

import type { LoadCtx } from "./context";
import { lookupKey } from "./context";

/**
 * Tier 1 — the lookups every later tier resolves against.
 *
 * Each of these MERGES: a NetSuite value that already exists in Carbon under the
 * same name is linked, not re-created. Carbon seeds a company with a chart of
 * accounts, an `EA` unit and a set of customer statuses, so a naive insert would
 * hand the customer two of everything.
 */

export async function loadCurrencies(ctx: LoadCtx): Promise<void> {
  for (const currency of ctx.plan.currencies) {
    const existing = ctx.config.currencyByCode.get(lookupKey(currency.code));
    if (existing) {
      ctx.ids.set("currency", currency.externalId, existing);
      ctx.counts.currencies.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("currency")
      .values({
        // `currency` carries no name column — the plan keeps NetSuite's name
        // only so the preview screen can show something a human recognizes.
        code: currency.code,
        decimalPlaces: currency.decimalPlaces,
        active: currency.active,
        companyGroupId: ctx.config.companyGroupId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.currencyByCode.set(lookupKey(currency.code), inserted.id);
    ctx.ids.set("currency", currency.externalId, inserted.id);
    ctx.counts.currencies.inserted += 1;
  }
}

export async function loadUnitsOfMeasure(ctx: LoadCtx): Promise<void> {
  for (const uom of ctx.plan.unitsOfMeasure) {
    const existing = ctx.config.unitOfMeasureByCode.get(lookupKey(uom.code));
    if (existing) {
      ctx.ids.set("unitOfMeasure", uom.externalId, existing);
      ctx.counts.unitsOfMeasure.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("unitOfMeasure")
      .values({
        code: uom.code,
        name: uom.name,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.unitOfMeasureByCode.set(lookupKey(uom.code), inserted.id);
    ctx.ids.set("unitOfMeasure", uom.externalId, inserted.id);
    ctx.counts.unitsOfMeasure.inserted += 1;
  }
}

export async function loadPaymentTerms(ctx: LoadCtx): Promise<void> {
  for (const term of ctx.plan.paymentTerms) {
    const existing = ctx.config.paymentTermByName.get(lookupKey(term.name));
    if (existing) {
      ctx.ids.set("paymentTerm", term.externalId, existing);
      ctx.counts.paymentTerms.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("paymentTerm")
      .values({
        name: term.name,
        daysDue: term.daysDue,
        daysDiscount: term.daysDiscount,
        discountPercentage: term.discountPercentage,
        calculationMethod: term.calculationMethod,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.paymentTermByName.set(lookupKey(term.name), inserted.id);
    ctx.ids.set("paymentTerm", term.externalId, inserted.id);
    ctx.counts.paymentTerms.inserted += 1;
  }
}

export async function loadShippingMethods(ctx: LoadCtx): Promise<void> {
  for (const method of ctx.plan.shippingMethods) {
    const existing = ctx.config.shippingMethodByName.get(
      lookupKey(method.name)
    );
    if (existing) {
      ctx.ids.set("shippingMethod", method.externalId, existing);
      ctx.counts.shippingMethods.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("shippingMethod")
      .values({
        name: method.name,
        carrier: method.carrier,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.shippingMethodByName.set(lookupKey(method.name), inserted.id);
    ctx.ids.set("shippingMethod", method.externalId, inserted.id);
    ctx.counts.shippingMethods.inserted += 1;
  }
}

/**
 * Locations must land BEFORE items: inserting an `item` fires an interceptor
 * that creates one `itemPlanning` row per existing location, so an item created
 * first would be unplannable at every location added afterwards.
 */
export async function loadLocations(ctx: LoadCtx): Promise<void> {
  for (const location of ctx.plan.locations) {
    const existing = ctx.config.locationByName.get(lookupKey(location.name));
    if (existing) {
      ctx.ids.set("location", location.externalId, existing);
      ctx.counts.locations.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("location")
      .values({
        name: location.name,
        // `location` requires a street address and a postal code, which a
        // NetSuite location record does not always carry. An empty string keeps
        // the row insertable and is visibly wrong in the UI, which is what we
        // want — a placeholder nobody notices is worse than a blank field.
        addressLine1: location.addressLine1 || "",
        addressLine2: location.addressLine2,
        city: location.city || "",
        stateProvince: location.stateProvince,
        postalCode: location.postalCode || "",
        countryCode: location.countryCode,
        // `timezone` has no column default, and the company's own is the only
        // sane answer — NetSuite locations carry no timezone.
        timezone: ctx.config.timezone,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.locationByName.set(lookupKey(location.name), inserted.id);
    ctx.ids.set("location", location.externalId, inserted.id);
    ctx.counts.locations.inserted += 1;

    if (!location.addressLine1 || !location.city || !location.postalCode) {
      ctx.warn(
        `Location "${location.name}" arrived without a complete address`
      );
    }
  }
}

/** Parents are linked in a second pass so a child listed first still resolves. */
export async function loadDepartments(ctx: LoadCtx): Promise<void> {
  for (const department of ctx.plan.departments) {
    const existing = ctx.config.departmentByName.get(
      lookupKey(department.name)
    );
    if (existing) {
      ctx.ids.set("department", department.externalId, existing);
      ctx.counts.departments.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("department")
      .values({
        name: department.name,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.departmentByName.set(lookupKey(department.name), inserted.id);
    ctx.ids.set("department", department.externalId, inserted.id);
    ctx.counts.departments.inserted += 1;
  }

  for (const department of ctx.plan.departments) {
    if (!department.parentExternalId) continue;
    const childId = ctx.ids.get("department", department.externalId);
    const parentId = ctx.ids.get("department", department.parentExternalId);
    if (!childId || !parentId) continue;

    await ctx.trx
      .updateTable("department")
      .set({
        parentDepartmentId: parentId,
        updatedAt: ctx.now,
        updatedBy: ctx.userId
      })
      .where("id", "=", childId)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }
}

/**
 * Carbon's account type, derived from the account's class when NetSuite's own
 * type has no Carbon counterpart. Only ever a fallback — the mapper sets the
 * type directly whenever NetSuite's `accttype` maps cleanly.
 */
function accountTypeForClass(
  accountClass: CarbonAccountClass
): CarbonAccountType {
  switch (accountClass) {
    case "Asset":
      return "Other Asset";
    case "Liability":
      return "Other Current Liability";
    case "Equity":
      return "Equity - No Close";
    case "Revenue":
      return "Income";
    case "Expense":
      return "Expense";
  }
}

/**
 * The chart of accounts MERGES onto the one Carbon seeded — matching first on
 * account number, then on name.
 *
 * Two things make this the most delicate tier. `account` is company-GROUP
 * scoped, so an insert is visible to every sibling company in the group; and
 * `accountDefault` points at seeded accounts by id, so replacing the seeded
 * chart would break posting. Merging is therefore the only safe shape, and a
 * multi-company group gets an explicit warning rather than a silent surprise.
 */
export async function loadAccounts(ctx: LoadCtx): Promise<void> {
  if (ctx.plan.accounts.length === 0) return;

  const groupMembers = await ctx.trx
    .selectFrom("company")
    .select(["id"])
    .where("companyGroupId", "=", ctx.config.companyGroupId)
    .execute();

  if (groupMembers.length > 1) {
    ctx.warn(
      `Accounts are shared across the ${groupMembers.length} companies in this group — ` +
        `${ctx.plan.accounts.length} NetSuite accounts were merged into the shared chart.`
    );
  }

  // Insert parents before children so `parentId` always resolves; NetSuite
  // returns the chart in no particular order.
  const byExternalId = new Map(
    ctx.plan.accounts.map((account) => [account.externalId, account])
  );
  const ordered: typeof ctx.plan.accounts = [];
  const placed = new Set<string>();

  const place = (externalId: string, seen: Set<string>): void => {
    if (placed.has(externalId) || seen.has(externalId)) return;
    const account = byExternalId.get(externalId);
    if (!account) return;
    seen.add(externalId);
    if (account.parentExternalId) place(account.parentExternalId, seen);
    placed.add(externalId);
    ordered.push(account);
  };
  for (const account of ctx.plan.accounts) place(account.externalId, new Set());

  for (const account of ordered) {
    const existing =
      (account.number
        ? ctx.config.accountByNumber.get(lookupKey(account.number))
        : undefined) ?? ctx.config.accountByName.get(lookupKey(account.name));

    if (existing) {
      ctx.ids.set("account", account.externalId, existing);
      ctx.counts.accounts.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("account")
      .values({
        name: account.name,
        number: account.number,
        class: account.class,
        incomeBalance: account.incomeBalance,
        accountType: account.accountType ?? accountTypeForClass(account.class),
        isGroup: account.isGroup,
        active: account.active,
        parentId: account.parentExternalId
          ? (ctx.ids.get("account", account.parentExternalId) ?? null)
          : null,
        companyGroupId: ctx.config.companyGroupId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (account.number)
      ctx.config.accountByNumber.set(lookupKey(account.number), inserted.id);
    ctx.config.accountByName.set(lookupKey(account.name), inserted.id);
    ctx.ids.set("account", account.externalId, inserted.id);
    ctx.counts.accounts.inserted += 1;
  }
}

export async function loadCustomerTypes(ctx: LoadCtx): Promise<void> {
  for (const type of ctx.plan.customerTypes) {
    const existing = ctx.config.customerTypeByName.get(lookupKey(type.name));
    if (existing) {
      ctx.ids.set("customerType", type.externalId, existing);
      ctx.counts.customerTypes.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("customerType")
      .values({
        name: type.name,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.customerTypeByName.set(lookupKey(type.name), inserted.id);
    ctx.ids.set("customerType", type.externalId, inserted.id);
    ctx.counts.customerTypes.inserted += 1;
  }
}

export async function loadSupplierTypes(ctx: LoadCtx): Promise<void> {
  for (const type of ctx.plan.supplierTypes) {
    const existing = ctx.config.supplierTypeByName.get(lookupKey(type.name));
    if (existing) {
      ctx.ids.set("supplierType", type.externalId, existing);
      ctx.counts.supplierTypes.skipped += 1;
      continue;
    }

    const inserted = await ctx.trx
      .insertInto("supplierType")
      .values({
        name: type.name,
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.config.supplierTypeByName.set(lookupKey(type.name), inserted.id);
    ctx.ids.set("supplierType", type.externalId, inserted.id);
    ctx.counts.supplierTypes.inserted += 1;
  }
}
