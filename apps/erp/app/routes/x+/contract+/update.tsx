// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// The properties panel: one term, or the type or invoicing intent, by id.
const propertyForm = z.object({
  id: z.string(),
  intent: zfd.text(z.string().optional()),
  field: zfd.text(z.string().optional()),
  value: z.string().nullish()
});

/**
 * One property of a contract, saved from its properties panel. The type and
 * the invoicing mode stay editable while Active; every other field is a term.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(propertyForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, intent, field, value } = input.data;
  const api = await carbon(args.request);
  // Each operation checks the value it is given against its own choices.

  if (intent === "invoiceAutomation") {
    return api.sales.setContractInvoiceAutomation({
      id,
      // Empty is the company's setting.
      invoiceAutomation: (value || null) as never
    });
  }
  if (intent === "contractType") {
    return api.sales.setContractType({ id, contractType: value as never });
  }
  return api.sales.setContractTerm({ id, field: field as never, value });
}
