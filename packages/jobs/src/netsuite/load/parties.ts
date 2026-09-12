import type {
  PlanAddress,
  PlanContact,
  PlanCustomer,
  PlanSupplier
} from "@carbon/netsuite";

import type { LoadCtx } from "./context";
import { lookupKey } from "./context";

/**
 * Tier 2 — customers and suppliers, with their addresses and contacts.
 *
 * Both tables have an INSERT interceptor (`sync_create_customer_entries` /
 * `sync_create_supplier_entries`) that creates the party's payment and shipping
 * rows for us. So the payment term and shipping method are applied with an
 * UPDATE: inserting them would violate those tables' primary key, which is the
 * party id itself.
 */

/** A readable id Carbon can accept: non-empty, and not already taken. */
function usableReadableId(
  candidate: string | null,
  taken: Set<string>
): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed) return undefined;
  if (taken.has(lookupKey(trimmed))) return undefined;
  taken.add(lookupKey(trimmed));
  return trimmed;
}

async function upsertAddress(
  ctx: LoadCtx,
  address: PlanAddress
): Promise<string> {
  const existingId = address.externalId
    ? ctx.ids.get("address", address.externalId)
    : undefined;

  if (existingId) {
    await ctx.trx
      .updateTable("address")
      .set({
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        stateProvince: address.stateProvince,
        postalCode: address.postalCode,
        countryCode: address.countryCode
      })
      .where("id", "=", existingId)
      .where("companyId", "=", ctx.companyId)
      .execute();
    return existingId;
  }

  const inserted = await ctx.trx
    .insertInto("address")
    .values({
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      stateProvince: address.stateProvince,
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      companyId: ctx.companyId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  if (address.externalId)
    ctx.ids.set("address", address.externalId, inserted.id);
  return inserted.id;
}

async function upsertContact(
  ctx: LoadCtx,
  contact: PlanContact,
  isCustomer: boolean
): Promise<string> {
  const existingId = ctx.ids.get("contact", contact.externalId);

  const values = {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    title: contact.title,
    workPhone: contact.workPhone,
    mobilePhone: contact.mobilePhone,
    isCustomer
  };

  if (existingId) {
    await ctx.trx
      .updateTable("contact")
      .set(values)
      .where("id", "=", existingId)
      .where("companyId", "=", ctx.companyId)
      .execute();
    return existingId;
  }

  const inserted = await ctx.trx
    .insertInto("contact")
    .values({ ...values, companyId: ctx.companyId })
    .returning("id")
    .executeTakeFirstOrThrow();

  ctx.ids.set("contact", contact.externalId, inserted.id);
  return inserted.id;
}

async function loadCustomer(
  ctx: LoadCtx,
  customer: PlanCustomer
): Promise<void> {
  const typeId = customer.typeName
    ? (ctx.config.customerTypeByName.get(lookupKey(customer.typeName)) ?? null)
    : null;
  const statusId = customer.statusName
    ? (ctx.config.customerStatusByName.get(lookupKey(customer.statusName)) ??
      null)
    : null;

  const values = {
    name: customer.name,
    phone: customer.phone,
    fax: customer.fax,
    website: customer.website,
    // A currency Carbon does not hold would be a dangling FK; fall back to base.
    currencyCode: customer.currencyCode
      ? ctx.config.currencyByCode.has(lookupKey(customer.currencyCode))
        ? customer.currencyCode
        : ctx.config.baseCurrencyCode
      : ctx.config.baseCurrencyCode,
    taxPercent: customer.taxPercent,
    customerTypeId: typeId,
    customerStatusId: statusId
  };

  const existingId = ctx.ids.get("customer", customer.externalId);
  let customerId: string;

  if (existingId) {
    await ctx.trx
      .updateTable("customer")
      .set({ ...values, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("id", "=", existingId)
      .where("companyId", "=", ctx.companyId)
      .execute();
    customerId = existingId;
    ctx.counts.customers.updated += 1;
  } else {
    const readableId = usableReadableId(
      customer.readableId,
      ctx.config.customerReadableIds
    );
    const inserted = await ctx.trx
      .insertInto("customer")
      .values({
        ...values,
        // Omitted rather than null when unusable, so the column default (the
        // customer sequence) mints one instead of failing the NOT NULL.
        ...(readableId ? { readableId } : {}),
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    customerId = inserted.id;
    ctx.ids.set("customer", customer.externalId, customerId);
    ctx.counts.customers.inserted += 1;
  }

  // The interceptor already created these rows — update, never insert.
  const paymentTermId = customer.paymentTermName
    ? (ctx.config.paymentTermByName.get(lookupKey(customer.paymentTermName)) ??
      null)
    : null;
  if (paymentTermId) {
    await ctx.trx
      .updateTable("customerPayment")
      .set({ paymentTermId, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("customerId", "=", customerId)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  const shippingMethodId = customer.shippingMethodName
    ? (ctx.config.shippingMethodByName.get(
        lookupKey(customer.shippingMethodName)
      ) ?? null)
    : null;
  if (shippingMethodId) {
    await ctx.trx
      .updateTable("customerShipping")
      .set({ shippingMethodId, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("customerId", "=", customerId)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  const locationIdByAddressName = new Map<string, string>();
  for (const address of customer.addresses) {
    const addressId = await upsertAddress(ctx, address);
    const locationKey =
      address.externalId ?? `${customer.externalId}:${address.name}`;
    const existingLocationId = ctx.ids.get("customerLocation", locationKey);

    if (existingLocationId) {
      locationIdByAddressName.set(lookupKey(address.name), existingLocationId);
      continue;
    }

    const location = await ctx.trx
      .insertInto("customerLocation")
      .values({
        customerId,
        addressId,
        name: address.name,
        companyId: ctx.companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("customerLocation", locationKey, location.id);
    locationIdByAddressName.set(lookupKey(address.name), location.id);
  }

  for (const contact of customer.contacts) {
    const contactId = await upsertContact(ctx, contact, true);
    if (ctx.ids.has("customerContact", contact.externalId)) continue;

    const customerLocationId = contact.addressName
      ? (locationIdByAddressName.get(lookupKey(contact.addressName)) ?? null)
      : null;

    const inserted = await ctx.trx
      .insertInto("customerContact")
      .values({
        customerId,
        contactId,
        customerLocationId,
        companyId: ctx.companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("customerContact", contact.externalId, inserted.id);
  }
}

export async function loadCustomers(ctx: LoadCtx): Promise<void> {
  for (const customer of ctx.plan.customers) {
    await loadCustomer(ctx, customer);
  }
}

async function loadSupplier(
  ctx: LoadCtx,
  supplier: PlanSupplier
): Promise<void> {
  const typeId = supplier.typeName
    ? (ctx.config.supplierTypeByName.get(lookupKey(supplier.typeName)) ?? null)
    : null;

  const values = {
    name: supplier.name,
    phone: supplier.phone,
    fax: supplier.fax,
    website: supplier.website,
    currencyCode: supplier.currencyCode
      ? ctx.config.currencyByCode.has(lookupKey(supplier.currencyCode))
        ? supplier.currencyCode
        : ctx.config.baseCurrencyCode
      : ctx.config.baseCurrencyCode,
    supplierTypeId: typeId,
    supplierStatus: supplier.status
  };

  const existingId = ctx.ids.get("supplier", supplier.externalId);
  let supplierId: string;

  if (existingId) {
    await ctx.trx
      .updateTable("supplier")
      .set({ ...values, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("id", "=", existingId)
      .where("companyId", "=", ctx.companyId)
      .execute();
    supplierId = existingId;
    ctx.counts.suppliers.updated += 1;
  } else {
    const readableId = usableReadableId(
      supplier.readableId,
      ctx.config.supplierReadableIds
    );
    const inserted = await ctx.trx
      .insertInto("supplier")
      .values({
        ...values,
        ...(readableId ? { readableId } : {}),
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        createdAt: ctx.now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    supplierId = inserted.id;
    ctx.ids.set("supplier", supplier.externalId, supplierId);
    ctx.counts.suppliers.inserted += 1;
  }

  const paymentTermId = supplier.paymentTermName
    ? (ctx.config.paymentTermByName.get(lookupKey(supplier.paymentTermName)) ??
      null)
    : null;
  if (paymentTermId) {
    await ctx.trx
      .updateTable("supplierPayment")
      .set({ paymentTermId, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("supplierId", "=", supplierId)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  const shippingMethodId = supplier.shippingMethodName
    ? (ctx.config.shippingMethodByName.get(
        lookupKey(supplier.shippingMethodName)
      ) ?? null)
    : null;
  if (shippingMethodId) {
    await ctx.trx
      .updateTable("supplierShipping")
      .set({ shippingMethodId, updatedAt: ctx.now, updatedBy: ctx.userId })
      .where("supplierId", "=", supplierId)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  const locationIdByAddressName = new Map<string, string>();
  for (const address of supplier.addresses) {
    const addressId = await upsertAddress(ctx, address);
    const locationKey =
      address.externalId ?? `${supplier.externalId}:${address.name}`;
    const existingLocationId = ctx.ids.get("supplierLocation", locationKey);

    if (existingLocationId) {
      locationIdByAddressName.set(lookupKey(address.name), existingLocationId);
      continue;
    }

    const location = await ctx.trx
      .insertInto("supplierLocation")
      .values({
        supplierId,
        addressId,
        name: address.name,
        companyId: ctx.companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("supplierLocation", locationKey, location.id);
    locationIdByAddressName.set(lookupKey(address.name), location.id);
  }

  for (const contact of supplier.contacts) {
    const contactId = await upsertContact(ctx, contact, false);
    if (ctx.ids.has("supplierContact", contact.externalId)) continue;

    const supplierLocationId = contact.addressName
      ? (locationIdByAddressName.get(lookupKey(contact.addressName)) ?? null)
      : null;

    const inserted = await ctx.trx
      .insertInto("supplierContact")
      .values({
        supplierId,
        contactId,
        supplierLocationId,
        companyId: ctx.companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    ctx.ids.set("supplierContact", contact.externalId, inserted.id);
  }
}

export async function loadSuppliers(ctx: LoadCtx): Promise<void> {
  for (const supplier of ctx.plan.suppliers) {
    await loadSupplier(ctx, supplier);
  }
}
