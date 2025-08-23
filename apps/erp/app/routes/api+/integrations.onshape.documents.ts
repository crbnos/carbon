import { requirePermissions } from "@carbon/auth/auth.server";
import { Onshape as OnshapeConfig } from "@carbon/ee";
import { OnshapeClient } from "@carbon/ee/onshape/lib";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getIntegration } from "~/modules/settings/settings.service";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const integration = await getIntegration(client, "onshape", companyId);

  if (integration.error || !integration.data) {
    return json({
      data: [],
      error: integration.error,
    });
  }

  const integrationMetadata = OnshapeConfig.schema.safeParse(
    integration?.data?.metadata
  );

  if (!integrationMetadata.success) {
    return json({
      data: [],
      error: integrationMetadata.error,
    });
  }

  const onshapeClient = new OnshapeClient({
    baseUrl: integrationMetadata.data.baseUrl,
    accessKey: integrationMetadata.data.accessKey,
    secretKey: integrationMetadata.data.secretKey,
  });

  try {
    let limit = 20;
    let offset = 0;
    let allDocuments: Array<{ id: string; name: string }> = [];

    while (true) {
      const response = await onshapeClient.getDocuments(limit, offset);

      if (!response.items || response.items.length === 0) {
        break;
      }

      allDocuments.push(...response.items);

      if (response.items.length < limit) {
        break;
      }

      offset += limit;
    }

    return json({
      data: { items: allDocuments },
      error: null,
    });
  } catch (error) {
    console.error(error);
    return json({
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get documents from Onshape",
    });
  }
}
