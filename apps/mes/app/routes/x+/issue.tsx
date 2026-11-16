// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { issueMaterialToOperation } from "~/services/issue.server";
import { issueValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await authorize(request, {});

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  return issueMaterialToOperation(
    { companyId, userId },
    {
      ...validation.data,
      acknowledged: formData.get("acknowledged") === "true"
    }
  );
}
