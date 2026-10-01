// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { saveJournalLineDimensions } from "~/modules/accounting";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { journalLineId } = params;
  if (!journalLineId) throw new Error("Could not find journalLineId");

  const body = (await request.json()) as {
    dimensions: Array<{ dimensionId: string; valueId: string }>;
  };

  const result = await saveJournalLineDimensions(
    client,
    journalLineId,
    companyId,
    body.dimensions ?? []
  );

  if (result.error) {
    return data({ error: result.error }, { status: 500 });
  }

  return data({ success: true });
}
