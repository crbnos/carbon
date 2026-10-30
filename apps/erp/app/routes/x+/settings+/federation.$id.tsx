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
import { getFederationRule } from "~/modules/settings/settings.service";
import { FederationRuleForm } from "~/modules/settings/ui";
import { getParams, path } from "~/utils/path";

// The list holds only the rows scrolled so far, so the drawer reads its own rule.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const rule = await getFederationRule(client, id, companyId);
  if (rule.error) {
    throw redirect(
      `${path.to.federationRules}?${getParams(request)}`,
      await flash(request, error(rule.error, "Failed to load federation rule"))
    );
  }

  return { rule: rule.data, companyId };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(federationRuleValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.updateFederationRule({
    ...federationRuleFields(input.data),
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.federationRules}?${getParams(args.request)}`,
    { message: "Updated federation rule" }
  );
}

export default function EditFederationRuleRoute() {
  const closeRoute = useCloseRoute();
  const { rule, companyId } = useLoaderData<typeof loader>();

  const initialValues = {
    id: rule.id,
    name: rule.name,
    provider: rule.provider,
    issuer: rule.issuer,
    audience: rule.audience,
    subject: rule.subject ?? "",
    tokenLifetimeMinutes: rule.tokenLifetimeMinutes
  };

  return (
    <FederationRuleForm
      key={rule.id}
      initialValues={initialValues}
      companyId={companyId}
      existingScopes={rule.scopes as Record<string, string[]> | null}
      existingClaims={rule.claimConditions as Record<string, string> | null}
      rule={rule}
      onClose={() => closeRoute()}
    />
  );
}
