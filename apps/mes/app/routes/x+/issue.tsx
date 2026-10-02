// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import type { RuleRefusalDetails } from "~/services/commands.materials.server";
import { issueMaterial } from "~/services/commands.materials.server";
import { issueValidator } from "~/services/models";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  const result = await issueMaterial(
    serviceRole,
    { companyId, userId },
    {
      ...validation.data,
      acknowledged: formData.get("acknowledged") === "true"
    }
  );

  if (!result.ok) {
    // A rules refusal is the one failure this route renders rather than
    // redirecting: the dialog needs the violations to offer "acknowledge".
    if (result.failure.kind === "blocked") {
      const { violations, ruleNames } = result.failure
        .details as RuleRefusalDetails;
      return { error: null, data: null, violations, ruleNames };
    }
    // The referrer is request-scoped, so the route owns it — the command never
    // sees the request.
    throw redirect(
      requestReferrer(request) ?? path.to.operations,
      await flash(
        request,
        error(result.failure.details ?? null, result.failure.message)
      )
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.operations);
}
