import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
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
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make",
      },
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make",
      },
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory",
      },
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code,
            })),
          };
        },
        default: "EA",
      },
    },
  },
  tool: {
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
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make",
      },
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make",
      },
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory",
      },
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code,
            })),
          };
        },
        default: "EA",
      },
    },
  },
  fixture: {
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
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make",
      },
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make",
      },
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory",
      },
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code,
            })),
          };
        },
        default: "EA",
      },
    },
  },
  consumable: {
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
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make",
      },
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make",
      },
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory",
      },
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code,
            })),
          };
        },
        default: "EA",
      },
    },
  },
  material: {
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
    materialSubstanceId: {
      label: "Substance",
      required: true,
      type: "enum",
      enumData: {
        description: "The substance of the material",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("materialSubstance")
            .select("id, name")
            .or(`companyId.eq.${companyId},companyId.is.null`)
            .order("name");
        },
        default: "",
      },
    },
    materialFormId: {
      label: "Form",
      required: false,
      type: "enum",
      enumData: {
        description: "The form of the material",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("materialForm")
            .select("id, name")
            .or(`companyId.eq.${companyId},companyId.is.null`)
            .order("name");
        },
        default: "",
      },
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: ["Buy", "Pick"],
        default: "Buy",
      },
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory",
      },
    },
    finish: {
      label: "Finish",
      type: "string",
      required: false,
    },
    grade: {
      label: "Grade",
      type: "string",
      required: false,
    },
    dimensions: {
      label: "Dimensions",
      type: "string",
      required: false,
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: false,
      type: "enum",
      enumData: {
        description: "The unit of measure of the part",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          const { data, error } = await client
            .from("unitOfMeasure")
            .select("name, code")
            .eq("companyId", companyId);

          if (error) {
            return { data: null, error };
          }

          return {
            data: data.map((item) => ({
              name: item.name,
              id: item.code,
            })),
          };
        },
        default: "EA",
      },
    },
  },
} as const;

export const importPermissions: Record<keyof typeof fieldMappings, string> = {
  customer: "sales",
  supplier: "purchasing",
  part: "parts",
  material: "parts",
  tool: "parts",
  fixture: "parts",
  consumable: "parts",
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
    unitOfMeasureCode: z
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
  tool: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the tool, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Readable ID is required" })
      .describe(
        "The readable id of the tool. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the tool"),
    description: z
      .string()
      .optional()
      .describe("The long description of the tool"),
    active: z.string().optional().describe("Whether the tool is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the tool"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the tool"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the tool"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the tool"),
  }),
  fixture: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the fixture, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Readable ID is required" })
      .describe(
        "The readable id of the fixture. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the fixture"),
    description: z
      .string()
      .optional()
      .describe("The long description of the fixture"),
    active: z.string().optional().describe("Whether the fixture is active"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the fixture"),
    replenishmentSystem: z
      .string()
      .optional()
      .describe("The replenishment system of the fixture"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the fixture"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the fixture"),
  }),
  consumable: z.object({
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
    unitOfMeasureCode: z
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
  material: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the material, usually a number or set of alphanumeric characters."
      ),
    readableId: z
      .string()
      .min(1, { message: "Readable ID is required" })
      .describe(
        "The readable id of the material. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The short description of the material"),
    description: z
      .string()
      .optional()
      .describe("The long description of the material"),
    active: z.string().optional().describe("Whether the material is active"),
    substance: z.string().optional().describe("The substance of the material"),
    form: z.string().optional().describe("The form of the material"),
    defaultMethodType: z
      .string()
      .optional()
      .describe("The default method type of the material"),
    itemTrackingType: z
      .string()
      .optional()
      .describe("The item tracking type of the material"),
    finish: z.string().optional().describe("The finish of the material"),
    grade: z.string().optional().describe("The grade of the material"),
    dimensions: z
      .string()
      .optional()
      .describe("The dimensions of the material"),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the material"),
  }),
} as const;
