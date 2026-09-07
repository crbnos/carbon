import { z } from "zod";
import { zfd } from "zod-form-data";

export const bulkPermissionsValidator = z.object({
  editType: z.string().min(1, { message: "Update type is required" }),
  userIds: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Group members are required" }),
  data: z
    .string()
    .startsWith("{", { message: "Invalid JSON" })
    .endsWith("}", { message: "Invalid JSON" })
});

export const createCustomerAccountValidator = z.object({
  id: z.string().min(1, "Customer contact is required"),
  customer: z.string().min(1, { message: "Customer is required" })
});

export const createEmployeeValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  employeeType: z.string().min(1, { message: "Employee type is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  // Controlled environments (ITAR) require the inviter to attest a reasonable
  // basis that the invitee is a U.S. person (22 CFR 120.62). Optional in the
  // schema — the action enforces it only when CONTROLLED_ENVIRONMENT is on, so
  // ordinary deployments (no checkbox rendered) still validate.
  usPersonAttestation: zfd.checkbox()
});

// ITAR certification — Screen 1 (entity Rider acceptance). The two checkboxes
// must be checked; z.literal(true) rejects an unchecked/absent box server-side
// even though the browser also enforces `required`.
export const itarEntityCertificationValidator = z.object({
  authorityToBind: z.literal(true, {
    error: "You must confirm your authority to bind"
  }),
  acceptRider: z.literal(true, {
    error: "You must accept the Rider"
  }),
  fullLegalName: z
    .string()
    .trim()
    .min(1, { message: "Full legal name is required" }),
  title: z.string().trim().min(1, { message: "Title is required" }),
  complianceContact: z
    .string()
    .trim()
    .min(1, { message: "Export compliance contact is required" })
});

// ITAR certification — Screen 2 (user U.S.-Person attestation).
export const itarUserCertificationValidator = z.object({
  certifyUsPerson: z.literal(true, {
    error: "You must certify that you are a U.S. Person"
  }),
  agreeNotify: z.literal(true, {
    error: "You must agree to the notification requirement"
  }),
  understandPenalty: z.literal(true, {
    error: "You must acknowledge the penalties"
  }),
  fullLegalName: z
    .string()
    .trim()
    .min(1, { message: "Full legal name is required" })
});

export const createOperatorValidator = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits")
});

export const convertOperatorValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  employeeType: z.string().min(1, { message: "Employee type is required" })
});

export const createSupplierAccountValidator = z.object({
  id: z.string().min(1, "Supplier contact is required"),
  supplier: z.string().min(1, { message: "Supplier is required" })
});

export const deactivateUsersValidator = z.object({
  redirectTo: z.string(),
  users: z
    .array(z.string().min(1, { message: "Invalid user id" }))
    .min(1, { message: "Group members are required" })
});

export const employeeTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  data: z
    .string()
    .startsWith("[", { message: "Invalid JSON" })
    .endsWith("]", { message: "Invalid JSON" })
});

export const employeeTypePermissionsValidator = z.array(
  z.object({
    name: z.string(),
    permission: z.object({
      view: z.boolean(),
      create: z.boolean(),
      update: z.boolean(),
      delete: z.boolean()
    })
  })
);

export const employeeValidator = z.object({
  id: z.string(),
  employeeType: z.string().min(1, { message: "Employee type is required" }),
  data: z
    .string()
    .startsWith("{", { message: "Invalid JSON" })
    .endsWith("}", { message: "Invalid JSON" })
});

export const groupValidator = z.object({
  id: z.string(),
  name: z.string().trim().min(1, { message: "Name is required" }),
  selections: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Group members are required" })
});

export const resendInviteValidator = z.object({
  users: z
    .array(z.string().min(1, { message: "Invalid user id" }))
    .min(1, { message: "Users are required" })
});

export const revokeInviteValidator = z.object({
  users: z
    .array(z.string().min(1, { message: "Invalid user id" }))
    .min(1, { message: "Users are required" })
});

export const userPermissionsValidator = z.object({
  view: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean()
});

export const validUserFlags = [
  "academy",
  "training:quotes",
  "training:salesOrders",
  "training:salesInvoices",
  "training:jobs",
  "training:suppliers",
  "training:purchaseOrders",
  "training:parts",
  "training:inventory",
  "training:quality"
] as const;

export type UserFlagKey = (typeof validUserFlags)[number];

const userFlagKeyValidator = z.enum(validUserFlags);

export const userFlagValidator = z.object({
  flag: userFlagKeyValidator,
  value: z.boolean()
});

export const userFlagsValidator = z.record(userFlagKeyValidator, z.boolean());
