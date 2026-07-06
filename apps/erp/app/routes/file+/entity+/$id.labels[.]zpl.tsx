import { requirePermissions } from "@carbon/auth/auth.server";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCompany, getDocumentTemplateConfig } from "~/modules/settings";
import { resolveLabelLogo } from "~/modules/settings/labelLogo.server";
import { path } from "~/utils/path";
import { getEntityLabelData } from "./labels.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await getEntityLabelData(client, companyId, id);

  if (result.error) {
    return new Response(result.error, { status: 404 });
  }

  const { companySettings, labelItem } = result;

  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const labelSizeId =
    labelParam || companySettings?.data?.productLabelSize || "label2x1";

  const labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.trackedEntityLabelPdf(id, { labelSize: labelSize.id })
    );
  }

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const company = await getCompany(client, companyId);
  const logo = await resolveLabelLogo(company.data, template, labelSize);

  const zplOutput = generateProductLabelZPL(
    labelItem!,
    labelSize,
    template,
    logo
  );

  const headers = new Headers({
    "Content-Type": "application/zpl",
    "Content-Disposition": `attachment; filename="labels-${id}.zpl"`
  });

  return new Response(zplOutput, { status: 200, headers });
}
