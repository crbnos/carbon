// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPickingListTravelerEntities } from "@carbon/database/travelers";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getCompanySettings,
  getDocumentTemplateConfig,
  getLabelTrackingTypes
} from "~/services/inventory.service";
import {
  getCompanyLogoForLabel,
  resolveLabelLogo
} from "~/services/labelLogo.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [companySettings, trackedEntities] = await Promise.all([
    getCompanySettings(client, companyId),
    getPickingListTravelerEntities(client, { pickingListId: id, companyId })
  ]);

  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "label2x1";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.pickingListTravelersPdf(id, { labelSize: labelSize.id })
    );
  }

  const trackingTypes = await getLabelTrackingTypes(
    client,
    companyId,
    trackedEntities.data ?? []
  );
  if (trackingTypes.error || !trackingTypes.data) {
    return new Response(
      `Could not read the items of picking list ${trackedEntities.readableId ?? id}`,
      { status: 500 }
    );
  }

  const items = trackedEntities.data
    ?.map((tracking) => ({
      itemId: tracking.sourceDocumentReadableId ?? "",
      revision: "0",
      number: tracking.readableId ?? "",
      trackedEntityId: tracking.id,
      quantity: tracking.quantity,
      trackingType: trackingTypes.data.get(tracking.id) ?? "Serial"
    }))
    .sort((a, b) => {
      if (a.itemId === b.itemId) {
        return a.number.localeCompare(b.number);
      }
      return a.itemId.localeCompare(b.itemId);
    });

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(
      `No travelers found for picking list ${trackedEntities.readableId ?? id}`,
      { status: 404 }
    );
  }

  if (!labelSize?.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const companyLogo = await getCompanyLogoForLabel(client, companyId);
  const logo = await resolveLabelLogo(companyLogo, template, labelSize);

  // Generate ZPL for each item
  const zplCommands = items.map((item) =>
    generateProductLabelZPL(item, labelSize, template, logo, companyLogo)
  );
  const zplOutput = zplCommands.join("\n");

  const headers = new Headers({
    "Content-Type": "application/zpl",
    "Content-Disposition": `attachment; filename="travelers-${id}.zpl"`
  });

  return new Response(zplOutput, { status: 200, headers });
}
