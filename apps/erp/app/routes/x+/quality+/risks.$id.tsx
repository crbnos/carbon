// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import { riskRegisterValidator } from "~/modules/quality/quality.models";
import { getRisk } from "~/modules/quality/quality.service";
import RiskRegisterForm from "~/modules/quality/ui/RiskRegister/RiskRegisterForm";
import { getParams, path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const risk = await getRisk(client, id);
  if (risk.error || !risk.data) {
    throw new Response("Not Found", { status: 404 });
  }

  return data({ risk: risk.data });
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(riskRegisterValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _, severity, likelihood, ...risk } = input.data;
  const api = await carbon(args.request);
  const result = await api.quality.updateRisk({
    ...risk,
    id: input.params.id,
    severity: Number.parseInt(severity ?? "1", 10),
    likelihood: Number.parseInt(likelihood ?? "1", 10)
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.risks);
  }
  return respond(args.request, result).redirect(
    `${path.to.risks}?${getParams(args.request)}`,
    { message: "Risk updated successfully" }
  );
}

export default function EditRiskRoute() {
  const { risk } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const onClose = () => {
    closeRoute();
  };

  return (
    <RiskRegisterForm
      open
      // @ts-expect-error TS2322 - TODO: fix type
      initialValues={{
        ...risk,
        id: risk.id,
        title: risk.title || "",
        description: risk.description ?? undefined,
        itemId: risk.itemId ?? undefined,
        source: risk.source,
        status: risk.status || "Open",
        severity: risk.severity ? risk.severity.toString() : "1",
        likelihood: risk.likelihood ? risk.likelihood.toString() : "1",
        assignee: risk.assignee ?? undefined,
        sourceId: risk.sourceId ?? undefined,
        type: risk.type ?? "Risk"
      }}
      onClose={onClose}
    />
  );
}
