// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { jsonSchemaInput } from "@carbon/api/schema";
import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// An API caller clears a field by sending null: JSON has no `undefined`, and a
// field left out keeps the stored value. The router validates every call
// against the published schema, so the schema has to take that null.

type Tool = { name: string; schema: Record<string, unknown> };

const tools = new Map(
  (metadata.tools as Tool[]).map((tool) => [tool.name, tool.schema])
);

function nullableEnumsWithoutNull(node: unknown, at: string): string[] {
  if (!node || typeof node !== "object") return [];
  const schema = node as { type?: unknown; enum?: unknown[] };
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const own =
    Array.isArray(schema.enum) &&
    types.includes("null") &&
    !schema.enum.includes(null)
      ? [at]
      : [];
  return [
    ...own,
    ...Object.entries(node).flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.flatMap((item, i) =>
            nullableEnumsWithoutNull(item, `${at}.${key}[${i}]`)
          )
        : nullableEnumsWithoutNull(value, `${at}.${key}`)
    )
  ];
}

const cleared = (...fields: string[]) =>
  Object.fromEntries(fields.map((field) => [field, null]));

const ADDRESS = cleared(
  "addressLine1",
  "addressLine2",
  "city",
  "stateProvince",
  "countryCode",
  "postalCode"
);
const CONTACT = cleared(
  "firstName",
  "lastName",
  "title",
  "email",
  "mobilePhone",
  "homePhone",
  "workPhone",
  "notes"
);
const TAX = cleared(
  "taxId",
  "vatNumber",
  "eori",
  "taxExemptionReason",
  "taxExemptionCertificateNumber",
  "taxExemptionCertificatePath"
);

const CLEARS: [string, Record<string, unknown>][] = [
  [
    "purchasing_updateSupplier",
    {
      id: "sup_1",
      name: "Acme",
      ...cleared(
        "supplierStatus",
        "supplierStageId",
        "supplierTypeId",
        "accountManagerId",
        "currencyCode",
        "purchasingContactId",
        "website"
      )
    }
  ],
  [
    "purchasing_updateSupplierLocation",
    { addressId: "addr_1", name: "Main", address: ADDRESS }
  ],
  [
    "purchasing_updateSupplierContact",
    { contactId: "con_1", contact: CONTACT, supplierLocationId: null }
  ],
  [
    "purchasing_updateSupplierPayment",
    {
      supplierId: "sup_1",
      ...cleared(
        "invoiceSupplierId",
        "invoiceSupplierLocationId",
        "invoiceSupplierContactId",
        "paymentTermId"
      )
    }
  ],
  [
    "purchasing_updateSupplierShipping",
    {
      supplierId: "sup_1",
      ...cleared(
        "shippingSupplierId",
        "shippingSupplierLocationId",
        "shippingSupplierContactId",
        "shippingMethodId",
        "incoterm",
        "incotermLocation"
      )
    }
  ],
  ["purchasing_updateSupplierTax", { supplierId: "sup_1", ...TAX }],
  [
    "sales_updateCustomer",
    {
      id: "cus_1",
      name: "Acme",
      taxPercent: 0,
      ...cleared(
        "customerStatusId",
        "customerTypeId",
        "accountManagerId",
        "currencyCode",
        "salesContactId",
        "website"
      )
    }
  ],
  [
    "sales_updateCustomerLocation",
    { addressId: "addr_1", name: "Main", address: ADDRESS }
  ],
  [
    "sales_updateCustomerContact",
    { contactId: "con_1", contact: CONTACT, customerLocationId: null }
  ],
  [
    "sales_updateCustomerPayment",
    {
      customerId: "cus_1",
      ...cleared(
        "invoiceCustomerId",
        "invoiceCustomerLocationId",
        "invoiceCustomerContactId",
        "paymentTermId"
      )
    }
  ],
  [
    "sales_updateCustomerShipping",
    {
      customerId: "cus_1",
      ...cleared(
        "shippingCustomerId",
        "shippingCustomerLocationId",
        "shippingCustomerContactId",
        "shippingMethodId",
        "incoterm",
        "incotermLocation"
      )
    }
  ],
  ["sales_updateCustomerTax", { customerId: "cus_1", ...TAX }]
];

describe("published input schemas", () => {
  it("list null among the values of every nullable enum", () => {
    const missing = [...tools].flatMap(([name, schema]) =>
      nullableEnumsWithoutNull(schema, name)
    );
    expect(missing).toEqual([]);
  });

  it.each(CLEARS)("%s takes null to clear an optional field", (name, input) => {
    const schema = tools.get(name);
    if (!schema) throw new Error(`${name} is not published`);
    expect(jsonSchemaInput(schema)["~standard"].validate(input)).toEqual({
      value: input
    });
  });
});
