// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Validator } from "@carbon/form";
import { z } from "zod";
import { zfd } from "zod-form-data";

export type TypeOfValidator<U extends Validator<any>> =
  U extends Validator<infer T> ? T : unknown;

export const address = {
  addressId: zfd.text(z.string().optional()),
  addressLine1: zfd.text(z.string().optional()),
  addressLine2: zfd.text(z.string().optional()),
  city: zfd.text(z.string().optional()),
  stateProvince: zfd.text(z.string().optional()),
  postalCode: zfd.text(z.string().optional()),
  countryCode: zfd.text(z.string().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional())
};

export const contact = {
  contactId: z.string().optional(),
  firstName: zfd.text(z.string().optional()),
  lastName: zfd.text(z.string().optional()),
  title: zfd.text(z.string().optional()),
  email: zfd.text(z.string().email("Must be a valid email").optional()),
  mobilePhone: zfd.text(z.string().optional()),
  homePhone: zfd.text(z.string().optional()),
  workPhone: zfd.text(z.string().optional()),
  notes: zfd.text(z.string().optional())
};

/** A contact needs a first name, a last name or an email. */
export const hasContactNameOrEmail = (data: {
  firstName?: string;
  lastName?: string;
  email?: string;
}) =>
  Boolean(
    data.firstName?.trim() || data.lastName?.trim() || data.email?.trim()
  );

export const contactNameOrEmailMessage = {
  message: "Enter a name or an email",
  path: ["firstName"]
};

/** The rule "Require an Email on Supplier / Customer Contacts" adds. */
export const hasContactEmail = (data: { email?: string }) =>
  Boolean(data.email?.trim());

export const contactEmailRequiredMessage = {
  message: "Email is required",
  path: ["email"]
};

export const favoriteSchema = z.object({
  id: z.string(),
  favorite: z.enum(["favorite", "unfavorite"])
});
