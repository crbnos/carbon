// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { companyValidator } from "~/modules/settings/settings.models";
import { path, requestReferrer } from "~/utils/path";

// The form lives in the topbar and only posts here. A tab left open across a
// deployment cannot submit it: React Router reloads the document at this URL
// instead, which without a loader is a 400. Send that reload back to the page
// it came from.
export function loader({ request }: LoaderFunctionArgs) {
  const referrer = requestReferrer(request);
  throw redirect(
    referrer && !referrer.startsWith(path.to.newCompany)
      ? referrer
      : path.to.authenticatedRoot
  );
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(companyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.createCompany(input.data);
  if (result.error) {
    return respond(args.request, result).redirect(
      requestReferrer(args.request) ?? path.to.authenticatedRoot
    );
  }

  // Switch the session to the new company.
  const { companyId, companyGroupId } = result.data;
  throw redirect(path.to.authenticatedRoot, {
    headers: [
      [
        "Set-Cookie",
        await updateCompanySession(args.request, companyId, companyGroupId)
      ],
      ["Set-Cookie", setCompanyId(companyId)]
    ]
  });
}
