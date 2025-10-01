import { labelSizes } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { DataType } from "~/modules/shared";

export const modulesType = [
  "Accounting",
  // "Documents",
  "Invoicing",
  "Inventory",
  "Items",
  "Production",
  // "Messaging",
  "Purchasing",
  "Resources",
  "Sales",
  "Users",
] as const;

export const kanbanOutputTypes = ["label", "qrcode", "url"] as const;

export const apiKeyValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

const company = {
  name: z.string().min(1, { message: "Name is required" }),
  taxId: zfd.text(z.string().optional()),
  addressLine1: z.string().min(1, { message: "Address is required" }),
  addressLine2: zfd.text(z.string().optional()),
  city: z.string().min(1, { message: "City is required" }),
  stateProvince: z.string().min(1, { message: "State / Province is required" }),
  postalCode: z.string().min(1, { message: "Postal Code is required" }),
  countryCode: z.string().min(1, { message: "Country is required" }),
  baseCurrencyCode: zfd.text(z.string()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  email: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional()),
};

export const companyValidator = z.object(company);
export const onboardingCompanyValidator = z.object({
  ...company,
  next: z.string().min(1, { message: "Next is required" }),
});

export const customFieldValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    table: z.string().min(1, { message: "Table is required" }),
    dataTypeId: zfd.numeric(
      z.number().min(1, { message: "Data type is required" })
    ),
    listOptions: z.string().min(1).array().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((input) => {
    // allows bar to be optional only when foo is 'foo'
    if (
      input.dataTypeId === DataType.List &&
      (input.listOptions === undefined ||
        input.listOptions.length === 0 ||
        input.listOptions.some((option) => option.length === 0))
    )
      return false;

    return true;
  });

export const digitalQuoteValidator = z.object({
  digitalQuoteEnabled: zfd.checkbox(),
  digitalQuoteNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
  digitalQuoteIncludesPurchaseOrders: zfd.checkbox(),
});

export const kanbanOutputValidator = z.object({
  kanbanOutput: z.enum(kanbanOutputTypes),
});

export const materialIdsValidator = z.object({
  materialGeneratedIds: zfd.checkbox(),
});

export const materialUnitsValidator = z.object({
  useMetric: zfd.checkbox(),
});

export const productLabelSizeValidator = z.object({
  productLabelSize: z.enum(
    labelSizes.map((size) => size.id) as [string, ...string[]],
    {
      message: "Product label size is required",
    }
  ),
});

export const rfqReadyValidator = z.object({
  rfqReadyNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
});

export const sequenceValidator = z.object({
  table: z.string().min(1, { message: "Table is required" }),
  prefix: zfd.text(z.string().optional()),
  suffix: zfd.text(z.string().optional()),
  next: zfd.numeric(z.number().min(0)),
  step: zfd.numeric(z.number().min(1)),
  size: zfd.numeric(z.number().min(1).max(20)),
});

export const themes = [
  "zinc",
  "neutral",
  "red",
  "rose",
  "orange",
  "green",
  "blue",
  "yellow",
  "violet",
] as const;
export type Theme = (typeof themes)[number];

export const themeValidator = z.object({
  next: zfd.text(z.string().optional()),
  theme: z.enum(themes, {
    errorMap: (issue, ctx) => ({ message: "Theme is required" }),
  }),
});

export const webhookValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    table: z.string().min(1, { message: "Table is required" }),
    url: z.string().url({ message: "Must be a valid URL" }),
    onInsert: zfd.checkbox(),
    onUpdate: zfd.checkbox(),
    onDelete: zfd.checkbox(),
    active: zfd.checkbox(),
  })
  .refine(
    (input) => {
      if (input.onInsert || input.onUpdate || input.onDelete) return true;
      return false;
    },
    {
      message: "At least one action is required",
      path: ["onDelete"],
    }
  );
