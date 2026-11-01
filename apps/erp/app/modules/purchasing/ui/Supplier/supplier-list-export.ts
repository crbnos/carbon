// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatAddress } from "@carbon/utils";
import type { SupplierReportContacts } from "../../types";

/**
 * The supplier contact and address columns, by column id. The loader adds
 * `reportContacts` to each page's rows; the Suppliers table shows and exports
 * these values, and the background CSV export writes the same ones
 * (`suppliersList.exportValues`).
 */
type Row = { reportContacts?: SupplierReportContacts | null };

const purchasingContact = (row: Row) =>
  row.reportContacts?.purchasingContact?.contact ?? null;
const invoiceContact = (row: Row) =>
  row.reportContacts?.payment?.invoiceContact?.contact ?? null;
const shippingContact = (row: Row) =>
  row.reportContacts?.shipping?.shippingContact?.contact ?? null;

type Address = NonNullable<
  NonNullable<SupplierReportContacts["payment"]>["invoiceLocation"]
>["address"];

const formatSupplierAddress = (address: Address | null | undefined) =>
  address
    ? formatAddress(
        address.addressLine1,
        address.addressLine2,
        address.city,
        address.stateProvince,
        address.postalCode,
        address.country?.name
      )
    : null;

export const SUPPLIER_CONTACT_VALUES = {
  purchasingContactName: (row: Row) => purchasingContact(row)?.fullName ?? null,
  purchasingContactEmail: (row: Row) => purchasingContact(row)?.email ?? null,
  purchasingContactPhone: (row: Row) =>
    purchasingContact(row)?.workPhone ?? null,
  invoiceAddress: (row: Row) =>
    formatSupplierAddress(
      row.reportContacts?.payment?.invoiceLocation?.address
    ),
  invoiceContactName: (row: Row) => invoiceContact(row)?.fullName ?? null,
  invoiceContactEmail: (row: Row) => invoiceContact(row)?.email ?? null,
  invoiceContactPhone: (row: Row) => invoiceContact(row)?.workPhone ?? null,
  shippingAddress: (row: Row) =>
    formatSupplierAddress(
      row.reportContacts?.shipping?.shippingLocation?.address
    ),
  shippingContactName: (row: Row) => shippingContact(row)?.fullName ?? null,
  shippingContactEmail: (row: Row) => shippingContact(row)?.email ?? null,
  shippingContactPhone: (row: Row) => shippingContact(row)?.workPhone ?? null
} satisfies Record<string, (row: Row) => string | null>;
