// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  isIssueLocked,
  nonConformanceAssociationType
} from "~/modules/quality/quality.models";
import { getIssue } from "~/modules/quality/quality.service";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, api } = await authorize(request, {
    "quality.issues": "Full"
  });

  const { id, type, associationId } = params;
  if (!id) throw new Error("Could not find id");
  if (!type) throw new Error("Could not find type");
  if (!associationId) throw new Error("Could not find associationId");

  const issue = await getIssue(client, id);
  await requireUnlocked({
    request,
    isLocked: isIssueLocked(issue.data?.status),
    redirectTo: requestReferrer(request) ?? path.to.issue(id),
    message: "Cannot modify a closed issue. Reopen it first."
  });

  // @ts-expect-error
  if (!nonConformanceAssociationType.includes(type)) {
    throw new Error(`Invalid type: ${type}`);
  }

  const deletion = await api.quality.deleteIssueAssociation({
    type: type as (typeof nonConformanceAssociationType)[number],
    associationId
  });

  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issue(id),
      await flash(
        request,
        error(deletion.error, "Failed to delete association")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issue(id),
    await flash(request, success("Successfully deleted association"))
  );
}
