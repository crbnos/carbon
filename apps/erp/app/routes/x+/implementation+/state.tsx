// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  changesImplementationHub1,
  hubAccess,
  stateActionValidator
} from "@carbon/implementation-hub";
import {
  applyHubMutation,
  getImplementationHub,
  getImplementationMember,
  type HubActor
} from "@carbon/implementation-hub/server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { usesImplementationHub2 } from "~/modules/shared/shared.models";
import { implementationHub2Enabled } from "~/modules/shared/shared.service";

// Single action endpoint for every Implementation Hub state mutation. The access rules live in
// `applyHubMutation`, shared with the MCP hub tools: toggles, finishing and a
// customer's own objectives are open to the company's people; tailoring
// (fields, rows, tier, exclusions, contacts, verification) needs Carbon staff.
// The company's own people write here only once the company uses
// Implementation Hub 2.0 and they have a page. A company on Implementation Hub
// 1.0 shares these records with it, so until it uses 2.0 only its page files,
// assignments and priority set change here, and only by Carbon staff.
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

  const isInternal = isInternalEmail(email);
  // The company's own people write only where they can open the page: a
  // company on 2.0, with a page of their own (`hubAccess`, as the layout).
  if (!isInternal || changesImplementationHub1(validation.data.intent)) {
    const [hub, flagOn, own] = await Promise.all([
      getImplementationHub(client, companyId),
      implementationHub2Enabled(companyId),
      isInternal
        ? null
        : getImplementationMember(client, { companyId, memberId: userId })
    ]);
    if (hub.error || own?.error) {
      return data(
        { success: false, message: "Failed to read the Implementation Hub" },
        await flash(
          request,
          error(
            hub.error ?? own?.error,
            "Failed to read the Implementation Hub"
          )
        )
      );
    }
    const implementationHub2 = usesImplementationHub2(hub.data, flagOn);
    if (
      !isInternal &&
      hubAccess({
        isInternal,
        enrolled: Boolean(hub.data),
        usesHub2: implementationHub2,
        hasPage: Boolean(own?.data)
      }) !== "page"
    ) {
      const message = "You have no page in this Implementation Hub.";
      return data(
        { success: false, message },
        await flash(request, error(new Error("forbidden"), message))
      );
    }
    if (!implementationHub2) {
      const message = !flagOn
        ? "Implementation Hub 2.0 is off for this company. Add the company to the implementation-hub-2 flag first."
        : hub.data
          ? "This company uses Implementation Hub 1.0. Switch it to Implementation Hub 2.0 in the Implementation Hub Settings first."
          : "This company is not enrolled. Enroll it in the Implementation Hub Settings first.";
      return data(
        { success: false, message },
        await flash(request, error(new Error("forbidden"), message))
      );
    }
  }

  const actor: HubActor = {
    companyId,
    userId,
    isInternal,
    source: isInternal ? "staff" : "customer"
  };

  const result = await applyHubMutation(client, actor, validation.data);
  if (result.error) {
    // A page file's problems are listed in the dialog that loaded it, and an
    // edit on the page shows its own, so neither is flashed.
    const pageWrite =
      validation.data.intent === "setMemberPage" ||
      (validation.data.intent === "addRow" && Boolean(validation.data.place));
    if (pageWrite && !result.error.forbidden) {
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
