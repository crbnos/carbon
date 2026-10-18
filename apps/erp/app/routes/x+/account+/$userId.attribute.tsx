// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  attributeBooleanValidator,
  attributeCustomerValidator,
  attributeFileValidator,
  attributeNumericValidator,
  attributeSupplierValidator,
  attributeTextValidator,
  attributeUserValidator
} from "~/modules/users/users.models";

/** The value's form, by the attribute's data type. */
const attributeValueForm = z.discriminatedUnion("type", [
  attributeBooleanValidator.extend({ type: z.literal("boolean") }),
  attributeNumericValidator.extend({ type: z.literal("numeric") }),
  attributeTextValidator.extend({ type: z.literal("date") }),
  attributeTextValidator.extend({ type: z.literal("list") }),
  attributeTextValidator.extend({ type: z.literal("text") }),
  attributeUserValidator.extend({ type: z.literal("user") }),
  attributeCustomerValidator.extend({ type: z.literal("customer") }),
  attributeSupplierValidator.extend({ type: z.literal("supplier") }),
  attributeFileValidator.extend({ type: z.literal("file") })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(attributeValueForm).request(args, {
    params: ["userId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.users.upsertAttributeValue({
    ...input.data,
    userId: input.params.userId
  });
}

export default function UserAttributeValueRoute() {
  // React Router bug
  return null;
}
