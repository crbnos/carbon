import { z } from "zod";

export const fieldMappings = {
  customer: {
    id: {
      label: "External ID",
      required: true,
      type: "string",
    },
    name: {
      label: "Name",
      required: true,
      type: "string",
    },
    phone: {
      label: "Phone",
      required: false,
      type: "string",
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string",
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string",
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string",
    },
    website: {
      label: "Website",
      required: false,
      type: "string",
    },
  },
  supplier: {
    id: {
      label: "External ID",
      required: true,
      type: "string",
    },
    name: {
      label: "Name",
      required: true,
      type: "string",
    },
    phone: {
      label: "Phone",
      required: false,
      type: "string",
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string",
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string",
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string",
    },
    website: {
      label: "Website",
      required: false,
      type: "string",
    },
  },
} as const;

export const importPermissions: Record<keyof typeof fieldMappings, string> = {
  customer: "sales",
  supplier: "purchasing",
};

export const importSchemas: Record<
  keyof typeof fieldMappings,
  z.ZodObject<any>
> = {
  customer: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the customer, usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe(
        "The name of the customer. Sometimes contains Inc or LLC. Usually a proper noun."
      ),
    phone: z.string().optional().describe("The phone number of the customer"),
    fax: z.string().optional().describe("The fax number of the customer"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the customer. Usually numeric."
      ),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the customer. Usually a 3-letter code."),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://"),
  }),
  supplier: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the supplier, usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe(
        "The name of the supplier. Sometimes contains Inc or LLC. Usually a proper noun."
      ),
    phone: z.string().optional().describe("The phone number of the supplier"),
    fax: z.string().optional().describe("The fax number of the supplier"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the supplier. Usually numeric."
      ),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the supplier. Usually a 3-letter code."),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://"),
  }),
} as const;
