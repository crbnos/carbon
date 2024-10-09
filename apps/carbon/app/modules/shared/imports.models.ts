import { z } from "zod";

export const fieldMappings = {
  customer: {
    id: {
      label: "ID",
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
    email: {
      label: "Email",
      required: false,
      type: "string",
    },
    taxId: {
      label: "Tax ID",
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
    email: z.string().optional().describe("The email address of the customer"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the customer. Usually numeric."
      ),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://"),
  }),
} as const;
