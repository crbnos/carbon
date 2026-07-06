import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
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

  const company = await getCompany(client, companyId);
  if (company.error) {
    console.error(company.error);
    throw new Error("Failed to load company");
  }

  const result = await getEntityLabelData(client, companyId, id);

  if (result.error) {
    return new Response(result.error, { status: 404 });
  }

  const { companySettings, labelItem } = result;

  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const labelSizeId =
    labelParam || companySettings?.data?.productLabelSize || "avery5163";

  const labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (labelSize.zpl) {
    throw redirect(
      path.to.file.trackedEntityLabelZpl(id, { labelSize: labelSize.id })
    );
  }

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );
  const logo = await resolveLabelLogo(company.data, template, labelSize);

  const stream = await renderToStream(
    <ProductLabelPDF
      items={[labelItem!]}
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

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - Entity Labels.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
