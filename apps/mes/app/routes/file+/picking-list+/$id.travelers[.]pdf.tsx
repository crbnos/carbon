// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPickingListTravelerEntities } from "@carbon/database/travelers";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes, redirect } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getCompany,
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

  // Get the label size from query params or default to avery5163
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5163";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.pickingListTravelersZpl(id, { labelSize: labelSize.id })
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

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const company = await getCompany(client, companyId);
  const companyLogo = await getCompanyLogoForLabel(client, companyId);
  const logo = await resolveLabelLogo(companyLogo, template, labelSize);

  const stream = await renderToStream(
    <ProductLabelPDF
      items={items ?? []}
      labelSize={labelSize}
      template={template}
      company={company.data as any}
      logo={logo}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
