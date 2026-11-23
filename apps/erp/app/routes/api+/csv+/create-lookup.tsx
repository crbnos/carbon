// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { createImportLookups } from "~/modules/shared/shared.server";

// A batch of lookup values to create during a CSV import; an inline create
// sends one name.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(createImportLookups.input).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.shared.createImportLookups(input.data);
}
