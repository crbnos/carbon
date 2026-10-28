// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  changesCompanyPlanHub,
  stateActionValidator
} from "@carbon/implementation-hub";
import {
  applyHubMutation,
  getImplementationHub,
  type HubActor
} from "@carbon/implementation-hub/server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { usesPersonalPages } from "~/modules/shared/shared.models";

// Single action endpoint for every hub state mutation. The access rules live in
// `applyHubMutation`, shared with the MCP hub tools: toggles, finishing and a
// customer's own objectives are open to any company employee; tailoring
// (fields, rows, tier, exclusions, contacts, verification) needs Carbon staff.
// A company on the Company Plan hub shares these records with it, so until it
// uses Personal Pages only its page files, assignments and priority set change
// here.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );

  const validation = await validator(stateActionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  if (changesCompanyPlanHub(validation.data.intent)) {
    const hub = await getImplementationHub(client, companyId);
    if (hub.error) {
      return data(
        { success: false, message: "Failed to read the hub" },
        await flash(request, error(hub.error, "Failed to read the hub"))
      );
    }
    if (!usesPersonalPages(hub.data)) {
      const message =
        "This company uses the Company Plan hub. Switch it to Personal Pages in the hub's Settings first.";
      return data(
        { success: false, message },
        await flash(request, error(new Error("forbidden"), message))
      );
    }
  }

  const isInternal = isInternalEmail(email);
  const actor: HubActor = {
    companyId,
    userId,
    isInternal,
    source: isInternal ? "staff" : "customer"
  };

  const result = await applyHubMutation(client, actor, validation.data);
  if (result.error) {
    // A page file's problems are listed in the dialog that loaded it, not in
    // a toast.
    if (validation.data.intent === "setMemberPage" && !result.error.forbidden) {
      return data({ success: false, message: result.error.message });
    }
    return data(
      { success: false, message: result.error.message },
      await flash(
        request,
        result.error.forbidden
          ? error(new Error("forbidden"), result.error.message)
          : error(result.error, "Failed to update")
      )
    );
  }

  return data({
    success: true,
    memberId: result.memberId
  });
}
