// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  makeMethodVersionValidator,
  upsertMakeMethodVersion
} from "~/modules/items";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(makeMethodVersionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // No change-order gate here: the V1 change-order model applies BOM edits by
  // spinning fresh method versions at Done and never stages/reserves a pending
  // revision, so there is nothing for an open CO to lock against.

  // The service role runs the whole call: the copy is gated on
  // `update: production`, which a parts user need not hold. RLS no longer
  // checks setting the source Active, so check `update: parts` here instead.
  if (validation.data.activeVersionId) {
    await requirePermissions(request, { update: "parts" });
  }

  const version = await upsertMakeMethodVersion(
    getCarbonServiceRole(),
    getDatabaseClient(),
    { ...validation.data, companyId, createdBy: userId }
  );
  const methodId = version.data?.id;
  const itemId = version.data?.itemId;
  const itemType = version.data?.type;
  if (version.error || !methodId || !itemType) {
    // The service's own refusals carry no `code`; a database error's text is
    // not written for users.
    const message =
      version.error && !("code" in version.error) && version.error.message
        ? version.error.message
        : "Failed to create new version";
    return data(
      { id: null },
      await flash(request, error(version.error ?? version, message))
    );
  }

  // @ts-expect-error
  throw redirect(getPathToMakeMethod(itemType, itemId, methodId));
}
