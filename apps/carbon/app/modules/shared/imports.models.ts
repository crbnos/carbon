import { z } from "zod";
// to avoid a circular dependency
const methodType = ["Buy", "Make", "Pick"] as const;
const itemReplenishmentSystems = ["Buy", "Make", "Buy and Make"] as const;
const itemTrackingTypes = ["Inventory", "Non-Inventory"] as const;

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
  part: {
    id: {
      label: "External ID",
      required: true,
      type: "string",
    },
    readableId: {
      label: "Readable ID",
      required: true,
      type: "string",
    },
    name: {
      label: "Short Description",
      required: true,
      type: "string",
    },
    description: {
      label: "Long Description",
      required: false,
      type: "string",
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean",
    },
    unitOfMeasure: {
      label: "Unit of Measure",
      required: false,
      type: "string",
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      description:
        "Whether demand for a part should be fulfilled by buying or making",
      options: itemReplenishmentSystems,
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      description:
        "How a part should be produced when it is required in production",
      options: methodType,
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      description: "Whether a part is tracked as inventory or not",
      options: itemTrackingTypes,
    },
  },
} as const;

export const importPermissions: Record<keyof typeof fieldMappings, string> = {
  customer: "sales",
  supplier: "purchasing",
  part: "parts",
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
  part: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the part, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Readable ID is required" })
      .describe(
        "The readable id of the part. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the part"),
    description: z
      .string()
      .optional()
      .describe("The long description of the part"),
    active: z.string().optional().describe("Whether the part is active"),
    unitOfMeasure: z
      .string()
      .optional()
      .describe("The unit of measure of the part"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the part"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the part"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the part"),
  }),
} as const;
