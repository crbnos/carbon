import type { ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  submit: vi.fn(),
  buttons: [] as { children: ReactNode; onClick?: () => void }[],
  state: undefined as unknown
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (seed: unknown) => {
      if (harness.state === undefined)
        harness.state = typeof seed === "function" ? seed() : seed;
      return [
        harness.state,
        (value: unknown) => {
          harness.state =
            typeof value === "function" ? value(harness.state) : value;
        }
      ];
    }
  };
});
vi.mock("@carbon/react", () => {
  const Box = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return {
    Button: (props: { children: ReactNode; onClick?: () => void }) => {
      harness.buttons.push(props);
      return createElement("button", null, props.children);
    },
    Select: Box,
    SelectContent: Box,
    SelectItem: Box,
    SelectTrigger: Box,
    SelectValue: Box,
    Table: Box,
    Tbody: Box,
    Td: Box,
    Tfoot: Box,
    Th: Box,
    Thead: Box,
    Tr: Box,
    Card: Box,
    CardContent: Box,
    CardDescription: Box,
    CardFooter: Box,
    CardHeader: Box,
    CardTitle: Box,
    HStack: Box,
    Checkbox: () => null,
    NumberField: ({
      value,
      formatOptions
    }: {
      value: number;
      formatOptions: Intl.NumberFormatOptions;
    }) =>
      createElement(
        "output",
        null,
        new Intl.NumberFormat("en-US", formatOptions).format(value)
      ),
    NumberInput: Box,
    NumberInputGroup: Box,
    cn: (...args: unknown[]) =>
      args.filter((x) => typeof x === "string").join(" ")
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((s, p, i) => s + p + (values[i] ?? ""), "")
  })
}));
vi.mock("react-router", () => ({
  generatePath: (s: string) => s,
  useFetcher: () => ({ state: "idle", submit: harness.submit })
}));
vi.mock("~/components", () => ({
  DateTime: () => null,
  Hyperlink: ({ children }: { children: ReactNode }) => children
}));
vi.mock("~/components/Enumerable", () => ({ Enumerable: () => null }));
vi.mock("@react-aria/i18n", () => ({
  useNumberFormatter: () => new Intl.NumberFormat("en-US")
}));
vi.mock("~/hooks", () => ({
  usePermissions: () => ({ can: () => true }),
  useCompanyToday: () => ({ toString: () => "2026-09-07" }),
  useCurrencyDecimals: () => 2,
  useCurrencyFormatter: ({ currency = "USD" } = {}) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency })
}));

import AvailableCreditsTable from "./AvailableCreditsTable";
import PaymentApplications from "./PaymentApplications";
import PaymentApplyTable from "./PaymentApplyTable";

const props = {
  paymentId: "current",
  paymentType: "Receipt" as const,
  paymentCurrency: "EUR",
  baseCurrency: "USD",
  currencyDecimals: 2,
  paymentTotal: 170,
  paymentExchangeRate: 1.2,
  availableCredit: 0,
  priorSources: [],
  openInvoices: [
    {
      id: "one",
      invoiceId: "INV1",
      dateDue: null,
      currencyCode: "EUR",
      exchangeRate: 1.1,
      totalAmount: 100,
      balance: 100,
      remainingDocument: 110,
      status: "Submitted"
    },
    {
      id: "two",
      invoiceId: "INV2",
      dateDue: null,
      currencyCode: "EUR",
      exchangeRate: 1.2,
      totalAmount: 50,
      balance: 50,
      remainingDocument: 60,
      status: "Submitted"
    }
  ],
  existingApplications: []
};
function render(overrides = {}) {
  harness.buttons = [];
  return renderToStaticMarkup(
    createElement(PaymentApplyTable, { ...props, ...overrides })
  );
}
function click(label: string) {
  const button = harness.buttons.find((b) =>
    renderToStaticMarkup(createElement("span", null, b.children)).includes(
      label
    )
  );
  expect(button).toBeDefined();
  button?.onClick?.();
}
beforeEach(() => {
  harness.state = undefined;
  harness.buttons = [];
  harness.submit.mockClear();
});
describe("payment composer document funding", () => {
  it("auto applies 170 EUR to invoices carrying 100 and 50 USD at distinct snapshots", () => {
    render();
    click("Auto apply");
    const html = render();
    expect(html).toContain("$100.00");
    expect(html).toContain("$50.00");
    expect(html).toContain("€110.00");
    expect(html).toContain("€60.00");
    click("Save applications");
    const submitted = harness.submit.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(submitted.get("applications")))).toEqual([
      expect.objectContaining({
        targetSalesInvoiceId: "one",
        appliedAmount: 100,
        sourceAmount: 110,
        targetExchangeRate: 1.1,
        sourceExchangeRate: 1.2
      }),
      expect.objectContaining({
        targetSalesInvoiceId: "two",
        appliedAmount: 50,
        sourceAmount: 60,
        targetExchangeRate: 1.2,
        sourceExchangeRate: 1.2
      })
    ]);
  });
  it("aggregates reopened funding splits into one invoice and resaves exact principal", () => {
    const existingApplications = [
      {
        targetSalesInvoiceId: "one",
        targetPurchaseInvoiceId: null,
        appliedAmount: 40,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceAmount: 44,
        sourcePaymentId: null,
        targetExchangeRate: 1.1,
        sourceExchangeRate: 1.2,
        appliedDate: "2026-09-07"
      },
      {
        targetSalesInvoiceId: "one",
        targetPurchaseInvoiceId: null,
        appliedAmount: 60,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceAmount: 66,
        sourcePaymentId: "prior",
        targetExchangeRate: 1.1,
        sourceExchangeRate: 1.1,
        appliedDate: "2026-09-07"
      }
    ];
    const html = render({ existingApplications });
    expect(html).toContain("$100.00");
    click("Save applications");
    const submitted = harness.submit.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(submitted.get("applications")))).toEqual([
      expect.objectContaining({
        appliedAmount: 100,
        sourceAmount: 110,
        sourceExchangeRate: 1.2
      })
    ]);
  });
  it("auto applies a prior document cent on a zero-cash draft even when base rounds to zero", () => {
    const overrides = {
      paymentTotal: 0,
      paymentExchangeRate: 100000,
      availableCredit: 0.01,
      priorSources: [
        {
          paymentId: "prior",
          postingDate: "2026-09-01",
          exchangeRate: 100000,
          remainingDocument: 0.01,
          remainingBase: 0
        }
      ],
      openInvoices: [
        {
          ...props.openInvoices[0],
          exchangeRate: 100000,
          totalAmount: 0.0000001,
          balance: 0,
          remainingDocument: 0.01
        }
      ]
    };
    render(overrides);
    click("Auto apply");
    render(overrides);
    click("Save applications");
    const submitted = harness.submit.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(submitted.get("applications")))).toEqual([
      expect.objectContaining({ appliedAmount: 0, sourceAmount: 0.01 })
    ]);
  });
});

it("displays staged memo base and document amounts and retains a zero-base document cent", () => {
  const html = renderToStaticMarkup(
    createElement(AvailableCreditsTable, {
      paymentId: "current",
      side: "sales",
      currency: "USD",
      documentCurrency: "EUR",
      documentDecimals: 2,
      credits: [
        {
          id: "m",
          memoId: "CM1",
          direction: "Credit",
          currencyCode: "EUR",
          exchangeRate: 100000,
          remaining: 0,
          remainingDocument: 0.01
        }
      ],
      openInvoices: [
        {
          id: "i",
          invoiceId: "INV",
          exchangeRate: 100000,
          balance: 0,
          remainingDocument: 0.01
        }
      ],
      staged: [{ memoId: "m", invoiceId: "i", amount: 0, sourceAmount: 0.01 }]
    })
  );
  expect(html).toContain("€0.01");
  expect(html).toContain("$0.00");
  click("Apply credits");
  expect(
    JSON.parse(
      String((harness.submit.mock.calls[0][0] as FormData).get("applications"))
    )
  ).toEqual([{ memoId: "m", invoiceId: "i", amount: 0, sourceAmount: 0.01 }]);
});
it("payment history aggregates invoice splits and subtracts only current document cash from unapplied", () => {
  const app = {
    id: "a",
    targetSalesInvoiceId: "one",
    salesInvoice: { invoiceId: "INV1" },
    appliedAmount: 40,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceAmount: 44,
    sourcePaymentId: null,
    targetExchangeRate: 1.1,
    sourceExchangeRate: 1.2,
    fxGainLossAmount: -3.33333,
    appliedDate: "2026-09-07"
  };
  const html = renderToStaticMarkup(
    createElement(PaymentApplications, {
      paymentTotal: 44,
      paymentCurrency: "EUR",
      baseCurrency: "USD",
      applications: [
        app,
        {
          ...app,
          id: "b",
          appliedAmount: 60,
          sourceAmount: 66,
          sourcePaymentId: "prior",
          sourceExchangeRate: 1.1,
          fxGainLossAmount: 0
        }
      ] as any
    })
  );
  expect(html.match(/INV1/g)).toHaveLength(1);
  expect(html).toContain("$100.00");
  expect(html).toContain("€0.00");
  expect(html).toContain("€110.00");
});
