// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Server-rendered markup, same harness style as the neighbouring
 * `PaymentForm.test.tsx`: the form's own composition is what is under test, so
 * the field library is stubbed down to the attributes that decide what gets
 * SUBMITTED and at what precision.
 */
const harness = vi.hoisted(() => ({
  currencies: [
    { code: "USD", name: "US Dollar", decimalPlaces: 2 },
    { code: "EUR", name: "Euro", decimalPlaces: 2 },
    { code: "JPY", name: "Japanese Yen", decimalPlaces: 0 }
  ]
}));

vi.mock("@carbon/react", () => {
  const Box = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Button: Box,
    Card: Box,
    CardContent: Box,
    CardHeader: Box,
    CardTitle: Box,
    Heading: Box,
    HStack: Box,
    Status: Box,
    VStack: Box,
    useMount: () => undefined,
    useRouteData: () => undefined
  };
});
vi.mock("@carbon/form", () => ({
  ValidatedForm: ({ children }: { children: ReactNode }) =>
    createElement("form", null, children)
}));
vi.mock("~/components/Form", () => {
  const Field = () => null;
  return {
    CustomFormFields: Field,
    DatePicker: Field,
    Input: Field,
    TextArea: Field,
    Hidden: ({ name }: { name: string }) =>
      createElement("input", { type: "hidden", name, readOnly: true }),
    Currency: ({ isReadOnly }: { isReadOnly?: boolean }) =>
      createElement("input", {
        name: "currencyCode",
        readOnly: Boolean(isReadOnly)
      }),
    NumberControlled: ({
      name,
      label,
      value,
      formatOptions,
      step
    }: {
      name: string;
      label: string;
      value: number;
      formatOptions: Intl.NumberFormatOptions;
      step?: number;
    }) =>
      createElement("input", {
        name,
        "aria-label": label,
        "data-step": step,
        readOnly: true,
        value: new Intl.NumberFormat("en-US", formatOptions).format(value)
      })
  };
});
vi.mock("~/components/Form/ExchangeRate", () => ({
  default: ({ name, value }: { name: string; value: number }) =>
    createElement("input", {
      name,
      "aria-label": "Exchange Rate",
      readOnly: true,
      value: String(value)
    })
}));
vi.mock("~/components/DocumentLineEditor", () => ({
  DocumentLineEditor: ({ currencyCode }: { currencyCode: string }) =>
    createElement("div", { "data-lines-currency": currencyCode })
}));
vi.mock("~/components", () => ({ EmployeeAvatar: () => null }));
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
vi.mock("react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) =>
    createElement("a", null, children),
  useFetcher: () => ({ state: "idle", data: { data: harness.currencies } })
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      authenticatedRoot: "/x",
      reimbursement: (id: string) => `/x/reimbursements/${id}`
    }
  }
}));
vi.mock("~/hooks", async () => {
  const { useCurrencyDecimals } = await import("~/hooks/useCurrencies");
  const { useCurrencyFormatter } = await import("~/hooks/useCurrencyFormatter");
  return {
    useCurrencyDecimals,
    useCurrencyFormatter,
    useUser: () => ({ company: { baseCurrencyCode: "USD" } })
  };
});
vi.mock("~/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ showCurrencyTrailingZeros: true })
}));

import ReimbursementEditForm from "./ReimbursementEditForm";

type Props = ComponentProps<typeof ReimbursementEditForm>;

const initialValues: Props["initialValues"] = {
  id: "rmb_1",
  reimbursementDate: "2026-09-20",
  currencyCode: "EUR",
  exchangeRate: 0.92,
  amount: 120.8,
  reference: undefined,
  notes: undefined
};

function render(values: Props["initialValues"] = initialValues) {
  return renderToStaticMarkup(
    createElement(ReimbursementEditForm, {
      reimbursementId: "rmb_1",
      displayId: "RMB000001",
      employeeId: "emp_1",
      initialValues: values,
      initialLines: [],
      dimensions: []
    })
  );
}

describe("ReimbursementEditForm currency and rate", () => {
  /**
   * The currency used to be editable while `exchangeRate` was a bare `<Hidden>`
   * nobody recomputed, so USD→EUR saved a EUR payable at rate 1 — and the money
   * inputs kept the ORIGINAL currency's decimals, which react-aria's
   * `parse(format(x))` blur commit turns into real rounding.
   */
  it("does not let the currency be changed away from the stored rate", () => {
    expect(render()).toContain('name="currencyCode" readonly=""');
  });

  it("submits the stored rate through a visible field, not a hidden one", () => {
    const html = render();
    expect(html).toContain('name="exchangeRate" aria-label="Exchange Rate"');
    expect(html).toContain('value="0.92"');
    // Exactly one `exchangeRate` input, or the form posts the value twice.
    expect((html.match(/name="exchangeRate"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('type="hidden" name="exchangeRate"');
  });

  it("keeps a base-currency document on the hidden pass-through at rate 1", () => {
    const html = render({
      ...initialValues,
      currencyCode: "USD",
      exchangeRate: 1
    });
    expect(html).toContain('type="hidden" name="exchangeRate"');
    expect((html.match(/name="exchangeRate"/g) ?? []).length).toBe(1);
  });

  it("formats and steps the amount at the DOCUMENT currency's precision", () => {
    expect(render()).toContain(
      'aria-label="Amount" data-step="0.01" readonly="" value="€120.80"'
    );
    // 0 decimals and a whole-unit step, or a typed ¥123.4 commits as ¥123.
    expect(
      render({ ...initialValues, currencyCode: "JPY", amount: 123 })
    ).toContain('aria-label="Amount" data-step="1" readonly="" value="¥123"');
  });

  it("hands the line editor the same currency the header is denominated in", () => {
    expect(render()).toContain('data-lines-currency="EUR"');
  });
});
