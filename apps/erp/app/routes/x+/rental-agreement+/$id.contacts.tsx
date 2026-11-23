// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { rentalAgreementContactRowValidator } from "~/modules/sales/sales.models";

const contactsForm = z.object({
  primaryId: zfd.text(z.string().optional()),
  contacts: zfd.json(z.array(rentalAgreementContactRowValidator).max(100))
});

/** The agreement page's contacts table: saves the whole list on each change. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(contactsForm).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.sales.setRentalAgreementContacts({
    rentalAgreementId: input.params.id,
    primaryId: input.data.primaryId ?? null,
    contacts: input.data.contacts
  });
}
