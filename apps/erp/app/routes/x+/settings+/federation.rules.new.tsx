// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  federationRuleFields,
  federationRuleValidator
} from "@carbon/ee/federation";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import { getActiveFederationIssuers } from "~/modules/settings/settings.service";
import { FederationRuleForm } from "~/modules/settings/ui";
import { ruleValuesFor } from "~/modules/settings/ui/Federation/RuleFields";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const issuers = await getActiveFederationIssuers(client, companyId);
  if (issuers.error) {
    throw redirect(
      `${path.to.federationRules}?${getParams(request)}`,
      await flash(request, error(issuers.error, "Failed to load issuers"))
    );
  }
  // A rule needs an issuer: without one, the wizard registers it first.
  if (issuers.data.length === 0) {
    throw redirect(`${path.to.connectWorkload}?${getParams(request)}`);
  }

  return { issuers: issuers.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(federationRuleValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.createFederationRule(
    federationRuleFields(input.data)
  );
  // The wizard reads the new rule's id and stays open for its Test step.
  if (result.error || new URL(args.request.url).searchParams.has("wizard")) {
    return result;
  }
  // The edit view shows the rule id and a usage example to copy.
  return respond(args.request, result).redirect(
    `${path.to.federationRule(result.data.id)}?${getParams(args.request)}`,
    { message: "Created federation rule" }
  );
}

export default function NewFederationRuleRoute() {
  const closeRoute = useCloseRoute();
  const { issuers } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ companyId: string }>(
    path.to.federationRules
  );

  return (
    <FederationRuleForm
      onClose={() => closeRoute()}
      initialValues={ruleValuesFor(issuers[0])}
      issuers={issuers}
      companyId={routeData?.companyId}
    />
  );
}
