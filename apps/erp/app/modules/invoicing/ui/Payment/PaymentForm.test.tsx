import type { ComponentProps, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  values: {} as Record<string, unknown>,
  typeChange: undefined as
    | ((option: { value: string; label: string }) => void)
    | undefined,
  currencyChange: undefined as
    | ((option: { value: string; label: string }) => void)
    | undefined,
  currencies: [
    { code: "USD", name: "US Dollar", decimalPlaces: 2 },
    { code: "EUR", name: "Euro", decimalPlaces: 2 },
    { code: "JPY", name: "Japanese Yen", decimalPlaces: 0 },
    { code: "BHD", name: "Bahraini Dinar", decimalPlaces: 3 }
  ]
}));

// Match the neighboring server-rendered composer tests while retaining each
// PaymentForm state slot between renders to exercise selector callbacks.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (seed: unknown) => {
      const index = harness.stateIndex++;
      if (!(index in harness.states))
        harness.states[index] = typeof seed === "function" ? seed() : seed;
      return [
        harness.states[index],
        (value: unknown) => {
          harness.states[index] =
            typeof value === "function" ? value(harness.states[index]) : value;
        }
      ];
    }
  };
});
vi.mock("@carbon/react", () => {
  const Box = ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children);
  return {
    Button: Box,
    Card: Box,
    CardContent: Box,
    CardDescription: Box,
    CardFooter: Box,
    CardHeader: Box,
    CardTitle: Box,
    DropdownMenuIcon: Box,
    DropdownMenuItem: Box,
    Status: Box,
    VStack: Box,
    useDisclosure: () => ({ isOpen: false }),
    useMount: () => undefined
  };
});
vi.mock("@carbon/form", () => ({
  ValidatedForm: ({
    children,
    defaultValues
  }: {
    children: ReactNode;
    defaultValues: Record<string, unknown>;
  }) => {
    harness.values = defaultValues;
    return createElement("form", null, children);
  }
}));
vi.mock("~/components/Form", () => {
  const Field = () => null;
  return {
    Account: Field,
    Customer: () => createElement("input", { name: "customerId" }),
    CustomFormFields: Field,
    DatePicker: Field,
    Hidden: ({ name, value }: { name: string; value?: string }) =>
      createElement("input", { type: "hidden", name, value, readOnly: true }),
    Input: Field,
    Select: Field,
    SelectControlled: ({
      options,
      onChange
    }: {
      options: { label: string; value: string }[];
      onChange: typeof harness.typeChange;
    }) => {
      harness.typeChange = onChange;
      return createElement(
        "select",
        null,
        options.map((o) =>
          createElement("option", { key: o.value, value: o.value }, o.label)
        )
      );
    },
    SequenceOrCustomId: Field,
    Submit: Field,
    Supplier: () => createElement("input", { name: "supplierId" }),
    TextArea: Field,
    Currency: ({ onChange }: { onChange?: typeof harness.currencyChange }) => {
      harness.currencyChange = onChange;
      return null;
    },
    Number: ({
      name,
      label,
      formatOptions
    }: {
      name: string;
      label: string;
      formatOptions: Intl.NumberFormatOptions;
    }) =>
      createElement("input", {
        name,
        "aria-label": label,
        readOnly: true,
        value: new Intl.NumberFormat("en-US", formatOptions).format(
          Number(harness.values[name])
        )
      })
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
vi.mock("react-router", () => ({
  generatePath: (path: string) => path,
  useFetcher: () => ({ state: "idle", data: { data: harness.currencies } })
}));
vi.mock("~/components", () => ({ DocumentHeader: () => null }));
vi.mock("~/components/Enumerable", () => ({ Enumerable: () => null }));
vi.mock("~/components/Modals", () => ({ ConfirmDelete: () => null }));
vi.mock("~/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ showCurrencyTrailingZeros: true })
}));
vi.mock("~/hooks", async () => {
  const { useCurrencyDecimals } = await import("~/hooks/useCurrencies");
  return {
    useCurrencyDecimals,
    usePermissions: () => ({ can: () => true }),
    useUser: () => ({ company: { baseCurrencyCode: "USD" } })
  };
});
vi.mock("~/modules/invoicing", () => import("../../invoicing.models"));

import PaymentForm from "./PaymentForm";

const initialValues: ComponentProps<typeof PaymentForm>["initialValues"] = {
  paymentType: "Receipt",
  customerId: "customer",
  paymentDate: "2026-09-08",
  currencyCode: "EUR",
  exchangeRate: 0.8,
  totalAmount: 120.8,
  bankAccount: "bank"
};

function render(values = initialValues) {
  harness.stateIndex = 0;
  return renderToStaticMarkup(
    createElement(PaymentForm, { initialValues: values })
  );
}

beforeEach(() => {
  harness.states = [];
  harness.stateIndex = 0;
  harness.currencyChange = undefined;
  harness.typeChange = undefined;
});

describe("PaymentForm refund directions", () => {
  it("seeds the visible payment kind in the form's registered defaults", () => {
    render();
    expect(harness.values.paymentKind).toBe("customer-payment");
  });
  it.each([
    ["customer-refund", "Disbursement", "customerId", "supplierId"],
    ["supplier-refund", "Receipt", "supplierId", "customerId"]
  ])("offers %s and submits its cash direction with one party", (kind, direction, party, otherParty) => {
    const html = render();
    expect(html).toContain("Refund to Customer");
    expect(html).toContain("Refund from Supplier");
    harness.typeChange?.({ value: kind, label: kind });
    const next = render();
    expect(next).toContain(
      `name="paymentType" readonly="" value="${direction}"`
    );
    expect(next).toContain(`name="${party}"`);
    expect(next).toContain(`name="${otherParty}" readonly="" value=""`);
  });
});

describe("PaymentForm document currency", () => {
  it.each([
    undefined,
    "payment-id"
  ])("labels document cash in EUR for payment id %s while the company uses USD", (id) => {
    const html = render({ ...initialValues, id, status: "Draft" });
    expect(html).toContain(
      'aria-label="Total Amount" readonly="" value="€120.80"'
    );
    expect(html).not.toContain("$120.80");
  });

  it.each([
    ["JPY", 123, "¥123"],
    ["BHD", 123.456, "BHD 123.456"]
  ] as const)("uses %s document settlement precision", (currencyCode, totalAmount, formatted) => {
    expect(render({ ...initialValues, currencyCode, totalAmount })).toContain(
      `aria-label="Total Amount" readonly="" value="${formatted}"`
    );
  });

  it.each([
    undefined,
    "payment-id"
  ])("updates currency and decimal precision after selection for payment id %s", (id) => {
    const values = {
      ...initialValues,
      id,
      status: "Draft",
      totalAmount: 123.456
    };
    render(values);
    harness.currencyChange?.({ value: "BHD", label: "Bahraini Dinar" });
    expect(render(values)).toContain('value="BHD 123.456"');
    harness.currencyChange?.({ value: "JPY", label: "Japanese Yen" });
    expect(render(values)).toContain('value="¥123"');
    harness.currencyChange?.({ value: "EUR", label: "Euro" });
    expect(render(values)).toContain('value="€123.46"');
  });
});
