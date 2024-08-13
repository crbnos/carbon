import type { Validator } from "@carbon/remix-validated-form";
import { z } from "zod";
import { zfd } from "zod-form-data";

export type TypeOfValidator<U extends Validator<any>> = U extends Validator<
  infer T
>
  ? T
  : unknown;

export type Mode = "light" | "dark";

export const address = {
  addressId: zfd.text(z.string().optional()),
  addressLine1: zfd.text(z.string().optional()),
  addressLine2: zfd.text(z.string().optional()),
  city: zfd.text(z.string().optional()),
  state: zfd.text(z.string().optional()),
  postalCode: zfd.text(z.string().optional()),
  countryId: zfd.numeric(z.number().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
};

export const contact = {
  contactId: z.string().optional(),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  title: zfd.text(z.string().optional()),
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  mobilePhone: zfd.text(z.string().optional()),
  homePhone: zfd.text(z.string().optional()),
  workPhone: zfd.text(z.string().optional()),
};

export const favoriteSchema = z.object({
  id: z.string(),
  favorite: z.enum(["favorite", "unfavorite"]),
});

export const modeValidator = z.object({
  mode: z.enum(["light", "dark", "system"]),
});
