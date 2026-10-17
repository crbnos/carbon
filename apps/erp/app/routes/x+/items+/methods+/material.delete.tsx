// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { checkRevisionLock } from "~/modules/items/items.server";

// Deletes one or more materials of ONE make method: the form carries an `id`
// per material, so the bill of material's "Delete Selected" is a single request.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const formData = await request.formData();
  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("id not found");
  }

  const materials = await client
    .from("methodMaterial")
    .select("makeMethodId")
    .in("id", ids)
    .eq("companyId", companyId);
  const makeMethodIds = new Set(
    (materials.data ?? []).map((m) => m.makeMethodId)
  );
  if (materials.error || makeMethodIds.size !== 1) {
    return data(
      { id: null },
      await flash(
        request,
        error(materials.error, "Failed to delete method material")
      )
    );
  }
  const [makeMethodId] = makeMethodIds;

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change notice is used. enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "makeMethod",
    id: makeMethodId,
    companyId
  });
  if (!lock.ok) {
    return data({ id: null }, await flash(request, error(null, lock.message)));
  }

  const deleteMaterials = await client
    .from("methodMaterial")
    .delete()
    .in("id", ids)
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId);
  if (deleteMaterials.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteMaterials.error, "Failed to delete method material")
      )
    );
  }

  if (lock.warn) {
    return data({}, await flash(request, success(lock.message)));
  }

  return {};
}
