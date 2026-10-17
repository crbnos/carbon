// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { fixedAssetRegisterValidator } from "~/modules/accounting/accounting.models";
import { getFixedAsset } from "~/modules/accounting/accounting.service";
import { FixedAssetRegisterForm } from "~/modules/accounting/ui/FixedAssets";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId, companyId);
  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  if (asset.data.status !== "Draft") {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "Only Draft assets can be registered"))
    );
  }

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(fixedAssetRegisterValidator).request(args, {
    params: ["fixedAssetId"]
  });
  if ("invalid" in input) return input.invalid;
  const { fixedAssetId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.registerFixedAsset({
    fixedAssetId,
    ...input.data
  });
  return respond(args.request, result).redirect(
    path.to.fixedAsset(fixedAssetId),
    { message: "Asset registered successfully" }
  );
}

export default function RegisterFixedAssetRoute() {
  const closeRoute = useCloseRoute();

  return <FixedAssetRegisterForm onClose={() => closeRoute()} />;
}
