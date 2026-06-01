import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { incoterms } from "./shared.models";

// to avoid a circular dependency
const methodType = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;
const itemReplenishmentSystems = ["Buy", "Make", "Buy and Make"] as const;
const itemTrackingTypes = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch"
] as const;
const supplierStatusTypes = [
  "Active",
  "Inactive",
  "Pending",
  "Rejected"
] as const;

// Shared supplier-part import fields. Spread into every item-type entry
// (part / material / tool / fixture / consumable) so a single CSV row can
// optionally create a supplierPart link alongside the item itself. All
// optional — rows without a Supplier column import as items only.
const supplierPartImportFields = {
  supplierId: {
    label: "Supplier",
    required: false,
    type: "enum",
    enumData: {
      description:
        "Optional — link this item to a supplier (match by Supplier ID)",
      fetcher: async (client: SupabaseClient<Database>, companyId: string) => {
        const { data, error } = await client
          .from("supplier")
          .select("id, name, readableId")
          .eq("companyId", companyId)
          .order("name");
        if (error) return { data: null, error };
        // Returning readableId in the `name` slot makes it the option label;
        // auto-match in FieldMappings keys on lowercase-trimmed label, so a
        // CSV value of "SUPP-12" resolves to the supplier whose readableId
        // is "SUPP-12".
        return {
          data: data.map((s) => ({
            id: s.id,
            name: s.readableId ?? s.name
          }))
        };
      }
    }
  },
  supplierPartId: {
    label: "Supplier Part Number",
    required: false,
    type: "string"
  },
  supplierUnitOfMeasureCode: {
    label: "Supplier Unit of Measure",
    required: false,
    type: "enum",
    enumData: {
      description: "How the supplier sells this part (e.g., BOX)",
      fetcher: async (client: SupabaseClient<Database>, companyId: string) => {
        const { data, error } = await client
          .from("unitOfMeasure")
          .select("name, code")
          .eq("companyId", companyId);
        if (error) return { data: null, error };
        return {
          data: data.map((u) => ({ id: u.code, name: u.name }))
        };
      }
    }
  },
  minimumOrderQuantity: {
    label: "Minimum Order Quantity",
    required: false,
    type: "string"
  },
  orderMultiple: {
    label: "Order Multiple",
    required: false,
    type: "string"
  },
  conversionFactor: {
    label: "Conversion Factor",
    required: false,
    type: "string"
  },
  unitPrice: {
    label: "Supplier Unit Price",
    required: false,
    type: "string"
  }
} as const;

// Item-level purchasing fields. Spread into every real item-type entry
// (part / material / tool / fixture / consumable). These write to the
// item's "itemReplenishment" row (auto-created by the create_item_related_records
// trigger) in the edge function's post-pass — the same fields the in-app
// "Purchasing" tab edits.
const itemPurchasingImportFields = {
  leadTime: {
    label: "Lead Time (Days)",
    required: false,
    type: "string"
  }
} as const;

// Shared address + payment + incoterm fields. Spread into supplier and
// customer entries — they write to side-tables (supplierLocation/address +
// supplierPayment + supplierShipping; same for customer) in the edge
// function's post-pass.
const partnerLocationImportFields = {
  locationName: {
    label: "Location Name",
    required: false,
    type: "string"
  },
  addressLine1: {
    label: "Address Line 1",
    required: false,
    type: "string"
  },
  addressLine2: {
    label: "Address Line 2",
    required: false,
    type: "string"
  },
  city: {
    label: "City",
    required: false,
    type: "string"
  },
  state: {
    label: "State / Region",
    required: false,
    type: "string"
  },
  postalCode: {
    label: "Postal Code",
    required: false,
    type: "string"
  },
  countryCode: {
    label: "Country",
    required: false,
    type: "enum",
    enumData: {
      description: "Country — match by full name (e.g., United States)",
      fetcher: async (client: SupabaseClient<Database>, _companyId: string) => {
        const { data, error } = await client
          .from("country")
          .select("alpha2, name");
        if (error) return { data: null, error };
        // address.countryCode is TEXT storing the ISO 3166-1 alpha-2 code
        // (e.g., "US"). The country table's PK is alpha2 since migration
        // 20240928155702_country-codes.sql.
        return {
          data: data.map((c) => ({ id: c.alpha2, name: c.name }))
        };
      }
    }
  }
} as const;

const partnerPaymentImportFields = {
  paymentTermId: {
    label: "Payment Term",
    required: false,
    type: "enum",
    enumData: {
      description: "Payment term (e.g., Net 30)",
      fetcher: async (client: SupabaseClient<Database>, companyId: string) => {
        return client
          .from("paymentTerm")
          .select("id, name")
          .eq("companyId", companyId)
          .order("name");
      }
    }
  }
} as const;

// Shipping/incoterm fields are supplier-only by design: businesses configure
// these when receiving goods (purchasing/import) but rarely set them on the
// outbound side. customerShipping.incoterm exists in the DB for completeness
// but is set via the in-app form when needed.
const supplierShippingImportFields = {
  shippingMethodId: {
    label: "Shipping Method",
    required: false,
    type: "enum",
    enumData: {
      description: "Carrier / shipping method (e.g., FedEx Ground)",
      fetcher: async (client: SupabaseClient<Database>, companyId: string) => {
        return client
          .from("shippingMethod")
          .select("id, name")
          .eq("companyId", companyId)
          .order("name");
      }
    }
  },
  incoterm: {
    label: "Incoterm",
    required: false,
    type: "enum",
    enumData: {
      default: "",
      description:
        "International Commercial Term — one of: EXW, FCA, FAS, FOB, CPT, CIP, CFR, CIF, DAP, DPU, DDP",
      options: incoterms
    }
  },
  incotermLocation: {
    label: "Incoterm Location",
    required: false,
    type: "string"
  }
} as const;

export const fieldMappings = {
  customer: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    accountManagerId: {
      label: "Account Manager",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The account manager — match by employee email (e.g. jane@company.com)",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("employees")
            .select("id, name, email, avatarUrl")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    customerStatusId: {
      label: "Status",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The status of the customer (from your configured statuses)",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("customerStatus")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    customerTypeId: {
      label: "Type",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The category/type of the customer (from your configured types)",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("customerType")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string"
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string"
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string"
    },
    website: {
      label: "Website",
      required: false,
      type: "string"
    },
    ...partnerLocationImportFields,
    ...partnerPaymentImportFields
  },
  customerContact: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    companyId: {
      label: "External Company ID",
      required: true,
      type: "string"
    },
    firstName: {
      label: "First Name",
      required: true,
      type: "string"
    },
    lastName: {
      label: "Last Name",
      required: true,
      type: "string"
    },
    email: {
      label: "Email",
      type: "string",
      required: true
    },
    title: {
      label: "Title",
      type: "string",
      required: false
    },
    mobilePhone: {
      label: "Mobile Phone",
      type: "string",
      required: false
    },
    workPhone: {
      label: "Work Phone",
      type: "string",
      required: false
    },
    homePhone: {
      label: "Home Phone",
      type: "string",
      required: false
    },
    fax: {
      label: "Fax",
      type: "string",
      required: false
    },
    notes: {
      label: "Notes",
      type: "string",
      required: false
    }
  },
  supplier: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    accountManagerId: {
      label: "Account Manager",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The account manager — match by employee email (e.g. jane@company.com)",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("employees")
            .select("id, name, email, avatarUrl")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    supplierStatus: {
      label: "Status",
      required: false,
      type: "enum",
      enumData: {
        default: "",
        description:
          "The status of the supplier — one of: Active, Inactive, Pending, Rejected",
        options: supplierStatusTypes
      }
    },
    supplierTypeId: {
      label: "Type",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The category/type of the supplier (from your configured types)",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("supplierType")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    },
    phone: {
      label: "Phone",
      required: false,
      type: "string"
    },
    fax: {
      label: "Fax",
      required: false,
      type: "string"
    },
    taxId: {
      label: "Tax ID",
      required: false,
      type: "string"
    },
    currencyCode: {
      label: "Currency Code",
      required: false,
      type: "string"
    },
    website: {
      label: "Website",
      required: false,
      type: "string"
    },
    ...partnerLocationImportFields,
    ...partnerPaymentImportFields,
    ...supplierShippingImportFields
  },
  supplierContact: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    companyId: {
      label: "External Company ID",
      required: true,
      type: "string"
    },
    firstName: {
      label: "First Name",
      required: true,
      type: "string"
    },
    lastName: {
      label: "Last Name",
      required: true,
      type: "string"
    },
    email: {
      label: "Email",
      type: "string",
      required: true
    },
    title: {
      label: "Title",
      type: "string",
      required: false
    },
    mobilePhone: {
      label: "Mobile Phone",
      type: "string",
      required: false
    },
    workPhone: {
      label: "Work Phone",
      type: "string",
      required: false
    },
    homePhone: {
      label: "Home Phone",
      type: "string",
      required: false
    },
    fax: {
      label: "Fax",
      type: "string",
      required: false
    },
    notes: {
      label: "Notes",
      type: "string",
      required: false
    }
  },
  part: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Description",
      required: true,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields,
    ...itemPurchasingImportFields
  },
  tool: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Description",
      required: true,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields,
    ...itemPurchasingImportFields
  },
  fixture: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Description",
      required: true,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields,
    ...itemPurchasingImportFields
  },
  consumable: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Description",
      required: true,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
    },
    replenishmentSystem: {
      label: "Replenishment System",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether demand for a part should be fulfilled by buying or making",
        options: itemReplenishmentSystems,
        default: "Buy and Make"
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: methodType,
        default: "Make"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields,
    ...itemPurchasingImportFields
  },
  material: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    readableId: {
      label: "Part Number",
      required: true,
      type: "string"
    },
    revision: {
      label: "Revision",
      required: true,
      type: "string",
      default: "0"
    },
    name: {
      label: "Description",
      required: true,
      type: "string"
    },
    active: {
      label: "Active",
      required: false,
      type: "boolean"
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
        default: ""
      }
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
        default: ""
      }
    },
    defaultMethodType: {
      label: "Default Method",
      required: false,
      type: "enum",
      enumData: {
        description:
          "How a part should be produced when it is required in production",
        options: ["Purchase to Order", "Pull from Inventory", "Make to Order"],
        default: "Purchase to Order"
      }
    },
    itemTrackingType: {
      label: "Tracking Type",
      required: false,
      type: "enum",
      enumData: {
        description: "Whether a part is tracked as inventory or not",
        options: itemTrackingTypes,
        default: "Inventory"
      }
    },
    finish: {
      label: "Finish",
      type: "string",
      required: false
    },
    grade: {
      label: "Grade",
      type: "string",
      required: false
    },
    dimensions: {
      label: "Dimensions",
      type: "string",
      required: false
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields,
    ...itemPurchasingImportFields
  },
  methodMaterial: {
    level: {
      label: "Level",
      required: false,
      type: "string"
    },
    partId: {
      label: "Part ID",
      required: true,
      type: "string"
    },
    description: {
      label: "Description",
      required: false,
      type: "string"
    },
    methodType: {
      label: "Method Type",
      required: true,
      type: "enum",
      enumData: {
        description:
          "The method type of the part, which describes whether it is bought or made",
        options: methodType,
        default: "Pull from Inventory"
      }
    },
    quantity: {
      label: "Quantity",
      required: true,
      type: "number"
    },
    unitOfMeasureCode: {
      label: "Unit of Measure",
      required: true,
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
              id: item.code
            }))
          };
        },
        default: "EA"
      }
    },
    ...supplierPartImportFields
  },
  workCenter: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    description: {
      label: "Description",
      required: true,
      type: "string"
    },
    defaultStandardFactor: {
      label: "Standard Factor",
      required: false,
      type: "enum",
      enumData: {
        description: "The standard factor unit for time tracking",
        options: [
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ],
        default: "Hours/Piece"
      }
    },
    laborRate: {
      label: "Labor Rate",
      required: true,
      type: "number"
    },
    machineRate: {
      label: "Machine Rate",
      required: true,
      type: "number"
    },
    overheadRate: {
      label: "Overhead Rate",
      required: true,
      type: "number"
    },
    locationId: {
      label: "Location",
      required: true,
      type: "enum",
      enumData: {
        description: "The location of the work center",
        fetcher: async (
          client: SupabaseClient<Database>,
          companyId: string
        ) => {
          return client
            .from("location")
            .select("id, name")
            .eq("companyId", companyId)
            .order("name");
        }
      }
    }
  },
  process: {
    id: {
      label: "Unique ID",
      required: true,
      type: "string"
    },
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    processType: {
      label: "Process Type",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether the process is Inside (in-house), Outside (outsourced), or both",
        options: ["Inside", "Outside", "Inside and Outside"],
        default: "Inside"
      }
    },
    defaultStandardFactor: {
      label: "Standard Factor",
      required: false,
      type: "enum",
      enumData: {
        description:
          "The standard factor unit for time tracking (required for Inside processes)",
        options: [
          "Hours/Piece",
          "Hours/100 Pieces",
          "Hours/1000 Pieces",
          "Minutes/Piece",
          "Minutes/100 Pieces",
          "Minutes/1000 Pieces",
          "Pieces/Hour",
          "Pieces/Minute",
          "Seconds/Piece",
          "Total Hours",
          "Total Minutes"
        ],
        default: "Hours/Piece"
      }
    },
    completeAllOnScan: {
      label: "Complete All On Scan",
      required: false,
      type: "enum",
      enumData: {
        description:
          "Whether scanning a barcode should complete all operations for this process",
        options: ["true", "false"],
        default: "false"
      }
    }
  },
  fixedAsset: {
    name: {
      label: "Name",
      required: true,
      type: "string"
    },
    fixedAssetClassId: {
      label: "Asset Class ID",
      required: true,
      type: "string"
    },
    serialNumber: {
      label: "Serial Number",
      required: false,
      type: "string"
    },
    acquisitionCost: {
      label: "Acquisition Cost",
      required: true,
      type: "string"
    },
    acquisitionDate: {
      label: "Acquisition Date",
      required: true,
      type: "string"
    },
    accumulatedDepreciation: {
      label: "Accumulated Depreciation",
      required: false,
      type: "string"
    },
    depreciationMethod: {
      label: "Depreciation Method",
      required: false,
      type: "enum",
      enumData: {
        description: "The depreciation method for this asset",
        options: ["Straight Line", "Declining Balance", "Units of Production"],
        default: "Straight Line"
      }
    },
    usefulLifeMonths: {
      label: "Useful Life (Months)",
      required: false,
      type: "string"
    },
    residualValuePercent: {
      label: "Residual Value %",
      required: false,
      type: "string"
    },
    locationId: {
      label: "Location ID",
      required: false,
      type: "string"
    }
  }
} as const;

export const importPermissions: Record<keyof typeof fieldMappings, string> = {
  customer: "sales",
  customerContact: "sales",
  supplier: "purchasing",
  supplierContact: "purchasing",
  part: "parts",
  material: "parts",
  methodMaterial: "parts",
  tool: "parts",
  fixture: "parts",
  consumable: "parts",
  workCenter: "production",
  process: "production",
  fixedAsset: "accounting"
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
    accountManagerId: z
      .string()
      .optional()
      .describe("The id of the account manager of the customer"),
    customerStatusId: z
      .string()
      .optional()
      .describe("The id of the customer's status"),
    customerTypeId: z
      .string()
      .optional()
      .describe("The id of the customer's type/category"),
    phone: z.string().optional().describe("The phone number of the customer"),
    fax: z.string().optional().describe("The fax number of the customer"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the customer. Usually numeric."
      )
      .nullable(),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the customer. Usually a 3-letter code.")
      .nullable(),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://")
      .nullable(),
    locationName: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().optional(),
    paymentTermId: z.string().optional()
  }),
  customerContact: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the customer contact, usually a number or set of alphanumeric characters."
      ),
    companyId: z
      .string()
      .min(1, { message: "Company ID is required" })
      .describe("The id of the company the contact belongs to"),
    firstName: z.string().describe("The first name of the customer contact"),
    lastName: z.string().describe("The last name of the customer contact"),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .describe("The email of the customer contact"),
    title: z.string().optional().describe("The title of the customer contact"),
    mobilePhone: z
      .string()
      .optional()
      .describe("The mobile phone of the customer contact"),
    workPhone: z
      .string()
      .optional()
      .describe("The work phone of the customer contact"),
    homePhone: z
      .string()
      .optional()
      .describe("The home phone of the customer contact"),
    fax: z.string().optional().describe("The fax of the customer contact"),
    notes: z.string().optional().describe("The notes of the customer contact")
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
    accountManagerId: z
      .string()
      .optional()
      .describe("The id of the account manager of the supplier"),
    supplierStatus: z
      .string()
      .optional()
      .describe("The status of the supplier"),
    supplierTypeId: z
      .string()
      .optional()
      .describe("The id of the supplier's type/category"),
    phone: z.string().optional().describe("The phone number of the supplier"),
    fax: z.string().optional().describe("The fax number of the supplier"),
    taxId: z
      .string()
      .optional()
      .describe(
        "The tax identification number of the supplier. Usually numeric."
      )
      .nullable(),
    currencyCode: z
      .string()
      .optional()
      .describe("The currency code of the supplier. Usually a 3-letter code.")
      .nullable(),
    website: z
      .string()
      .optional()
      .describe("The website url. Usually begins with http:// or https://")
      .nullable(),
    locationName: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().optional(),
    paymentTermId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    incoterm: z.string().optional(),
    incotermLocation: z.string().optional()
  }),
  supplierContact: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe(
        "The id of the supplier contact, usually a number or set of alphanumeric characters."
      ),
    companyId: z
      .string()
      .min(1, { message: "Company ID is required" })
      .describe("The id of the company the contact belongs to"),
    firstName: z
      .string()
      .describe("The first name of the supplier contact")
      .optional(),
    lastName: z
      .string()
      .describe("The last name of the supplier contact")
      .optional(),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .describe("The email of the supplier contact"),
    title: z.string().optional().describe("The title of the supplier contact"),
    mobilePhone: z
      .string()
      .optional()
      .describe("The mobile phone of the supplier contact"),
    workPhone: z
      .string()
      .optional()
      .describe("The work phone of the supplier contact"),
    homePhone: z
      .string()
      .optional()
      .describe("The home phone of the supplier contact"),
    fax: z.string().optional().describe("The fax of the supplier contact"),
    notes: z.string().optional().describe("The notes of the supplier contact")
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
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the part. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The description of the part"),
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
    supplierId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierUnitOfMeasureCode: z.string().optional(),
    minimumOrderQuantity: z.string().optional(),
    orderMultiple: z.string().optional(),
    conversionFactor: z.string().optional(),
    unitPrice: z.string().optional(),
    leadTime: z.string().optional()
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
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the tool. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The description of the tool"),
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
    supplierId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierUnitOfMeasureCode: z.string().optional(),
    minimumOrderQuantity: z.string().optional(),
    orderMultiple: z.string().optional(),
    conversionFactor: z.string().optional(),
    unitPrice: z.string().optional(),
    leadTime: z.string().optional()
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
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the fixture. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The description of the fixture"),
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
    supplierId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierUnitOfMeasureCode: z.string().optional(),
    minimumOrderQuantity: z.string().optional(),
    orderMultiple: z.string().optional(),
    conversionFactor: z.string().optional(),
    unitPrice: z.string().optional(),
    leadTime: z.string().optional()
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
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the part. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The description of the part"),
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
    supplierId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierUnitOfMeasureCode: z.string().optional(),
    minimumOrderQuantity: z.string().optional(),
    orderMultiple: z.string().optional(),
    conversionFactor: z.string().optional(),
    unitPrice: z.string().optional(),
    leadTime: z.string().optional()
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
      .min(1, { message: "Part Number is required" })
      .describe(
        "The readable id of the material. Usually a number or set of alphanumeric characters."
      ),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The description of the material"),
    active: z.string().optional().describe("Whether the material is active"),
    materialSubstanceId: z
      .string()
      .optional()
      .describe("The substance of the material"),
    materialFormId: z.string().optional().describe("The form of the material"),
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
    supplierId: z.string().optional(),
    supplierPartId: z.string().optional(),
    supplierUnitOfMeasureCode: z.string().optional(),
    minimumOrderQuantity: z.string().optional(),
    orderMultiple: z.string().optional(),
    conversionFactor: z.string().optional(),
    unitPrice: z.string().optional(),
    leadTime: z.string().optional()
  }),
  methodMaterial: z.object({
    level: z.string().optional().describe("The level of the material"),
    partId: z
      .string()
      .min(1, { message: "Part ID is required" })
      .describe("The id of the part"),
    description: z.string().optional().describe("The description of the part"),
    quantity: z.string().describe("The quantity of the part"),
    methodType: z
      .string()
      .optional()
      .describe(
        "The method type of the part, which describes whether it is bought or made"
      ),
    unitOfMeasureCode: z
      .string()
      .optional()
      .describe("The unit of measure of the part")
  }),
  workCenter: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe("The unique ID of the work center"),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the work center"),
    description: z
      .string()
      .min(1, { message: "Description is required" })
      .describe("The description of the work center"),
    defaultStandardFactor: z
      .string()
      .optional()
      .describe("The standard factor unit for time tracking"),
    laborRate: z.string().describe("The labor rate for the work center"),
    machineRate: z.string().describe("The machine rate for the work center"),
    overheadRate: z.string().describe("The overhead rate for the work center"),
    locationId: z
      .string()
      .min(1, { message: "Location is required" })
      .describe("The location ID of the work center")
  }),
  process: z.object({
    id: z
      .string()
      .min(1, { message: "ID is required" })
      .describe("The unique ID of the process"),
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the process"),
    processType: z
      .string()
      .optional()
      .describe(
        "Whether the process is Inside (in-house), Outside (outsourced), or both"
      ),
    defaultStandardFactor: z
      .string()
      .optional()
      .describe(
        "The standard factor unit for time tracking (required for Inside processes)"
      ),
    completeAllOnScan: z
      .string()
      .optional()
      .describe(
        "Whether scanning a barcode should complete all operations for this process"
      )
  }),
  fixedAsset: z.object({
    name: z
      .string()
      .min(1, { message: "Name is required" })
      .describe("The name of the fixed asset"),
    fixedAssetClassId: z
      .string()
      .min(1, { message: "Asset Class is required" })
      .describe("The ID of the fixed asset class"),
    serialNumber: z
      .string()
      .optional()
      .describe("The serial number of the asset"),
    acquisitionCost: z
      .string()
      .optional()
      .describe("The acquisition cost of the asset"),
    acquisitionDate: z
      .string()
      .optional()
      .describe("The date the asset was acquired (YYYY-MM-DD)"),
    accumulatedDepreciation: z
      .string()
      .optional()
      .describe("The accumulated depreciation to date"),
    depreciationMethod: z
      .string()
      .optional()
      .describe(
        "The depreciation method: Straight Line, Declining Balance, or Units of Production"
      ),
    usefulLifeMonths: z
      .string()
      .optional()
      .describe("The useful life of the asset in months"),
    residualValuePercent: z
      .string()
      .optional()
      .describe("The residual value as a percentage of acquisition cost"),
    locationId: z
      .string()
      .optional()
      .describe("The location ID where the asset is located")
  })
} as const;
