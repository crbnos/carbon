// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { fixedAssetOutOfServiceValidator } from "~/modules/accounting/accounting.models";
import { outOfServiceRefusal } from "~/modules/accounting/accounting.service";
import { FixedAssetOutOfServiceForm } from "~/modules/accounting/ui/FixedAssets";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  // The action asks again: the form can be submitted long after it opened.
  const refused = await outOfServiceRefusal(
    client,
    getCarbonServiceRole(),
    fixedAssetId,
    companyId
  );
  if (refused) {
    throw redirect(
      refused.category === "notFound"
        ? path.to.fixedAssets
        : path.to.fixedAsset(fixedAssetId),
      await flash(request, error(refused.cause ?? null, refused.message))
    );
  }

  return null;
}

// POST with `?intent=return` clears the out-of-service state and needs no
// body; a plain POST takes the asset out of service with the form's reason.
export async function action(args: ActionFunctionArgs) {
  if (new URL(args.request.url).searchParams.get("intent") === "return") {
    const input = await validator().request(args, {
      params: ["fixedAssetId"]
    });
    if ("invalid" in input) return input.invalid;
    const { fixedAssetId } = input.params;
    const api = await carbon(args.request);
    const result = await api.accounting.returnFixedAssetToService({
      fixedAssetId
    });
    return respond(args.request, result).redirect(
      path.to.fixedAsset(fixedAssetId),
      { message: "Asset returned to service" }
    );
  }

  const input = await validator(fixedAssetOutOfServiceValidator).request(args, {
    params: ["fixedAssetId"]
  });
  if ("invalid" in input) return input.invalid;
  const { fixedAssetId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.takeFixedAssetOutOfService({
    fixedAssetId,
    reason: input.data.reason
  });
  return respond(args.request, result).redirect(
    path.to.fixedAsset(fixedAssetId),
    { message: "Asset taken out of service" }
  );
}

export default function FixedAssetOutOfServiceRoute() {
  const navigate = useNavigate();

  return <FixedAssetOutOfServiceForm onClose={() => navigate(-1)} />;
}
