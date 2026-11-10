// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const updatesRaw = (await request.formData()).get("updates");

  let updates: unknown;
  try {
    updates = JSON.parse(String(updatesRaw ?? ""));
  } catch {
    return data(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const api = await carbon(request);
  const result = await api.shared.updateSavedViewOrder({
    updates: updates as { id: string; sortOrder: number }[]
  });
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to update sort order"))
    );
  }
  return null;
}
