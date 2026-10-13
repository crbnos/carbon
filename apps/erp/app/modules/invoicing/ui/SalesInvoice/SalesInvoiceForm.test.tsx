// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/auth")>()),
  useCarbon: () => ({ carbon: null })
}));
vi.mock("@carbon/form", () => ({
  ValidatedForm: ({ children }: { children: ReactNode }) =>
    createElement("form", null, children)
}));
vi.mock("@carbon/react", () => {
  const Box = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Card: Box,
    CardContent: Box,
    CardDescription: Box,
    CardFooter: Box,
    CardHeader: Box,
    CardTitle: Box,
    VStack: Box,
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
    toast: { error: vi.fn() }
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce(
        (result, part, index) => result + part + (values[index] ?? ""),
        ""
      )
  })
}));
// The two pickers under test render the customer they are scoped to.
vi.mock("~/components/Form", () => {
  const Field = () => null;
  const ScopedPicker = ({
    name,
    customer
  }: {
    name: string;
    customer?: string;
  }) => createElement("input", { name, "data-customer": customer ?? "" });
  return {
    Currency: Field,
    Customer: Field,
    CustomerContact: ScopedPicker,
    CustomerLocation: ScopedPicker,
    CustomFormFields: Field,
    DatePicker: Field,
    Hidden: Field,
    Input: Field,
    Location: Field,
    SequenceOrCustomId: Field,
    Submit: Field
  };
});
vi.mock("~/components/Form/PaymentTerm", () => ({ default: () => null }));
vi.mock("~/hooks", () => ({
  usePermissions: () => ({ can: () => true }),
  useRouteData: () => undefined
}));
vi.mock("~/modules/invoicing", () => import("../../invoicing.models"));

import SalesInvoiceForm from "./SalesInvoiceForm";

function render() {
  return renderToStaticMarkup(
    createElement(SalesInvoiceForm, {
      initialValues: {
        customerId: "cust_sold_to",
        invoiceCustomerId: "cust_billing",
        locationId: "loc_1"
      }
    })
  );
}

describe("SalesInvoiceForm", () => {
  it.each([
    "invoiceCustomerContactId",
    "invoiceCustomerLocationId"
  ])("scopes %s to the invoice customer, not the sold-to customer", (name) => {
    expect(render()).toContain(`name="${name}" data-customer="cust_billing"`);
  });
});
