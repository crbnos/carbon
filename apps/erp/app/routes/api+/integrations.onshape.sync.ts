import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeClient, onShapeDataValidator } from "@carbon/ee/onshape";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const logger = getLogger("erp", "integrations-onshape-sync");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const documentId = formData.get("documentId");
  const versionId = formData.get("versionId");
  const elementId = formData.get("elementId");

  const configuration = formData.get("configuration");

  const makeMethodId = formData.get("makeMethodId");
  const rows = formData.get("rows");

  if (!makeMethodId || !rows) {
    return data(
      { success: false, message: "Missing required fields" },
      { status: 400 }
    );
  }

  const record = await client
    .from("makeMethod")
    .select("itemId, companyId")
    .eq("id", makeMethodId as string)
    .single();

  if (record.data?.companyId !== companyId) {
    return data(
      { success: false, message: "Invalid make method id" },
      { status: 400 }
    );
  }

  try {
    const parsed = onShapeDataValidator.parse(JSON.parse(rows as string));
    const serviceRole = await getCarbonServiceRole();

    // Persist BOTH forms. The encoded string is what re-runs Onshape API calls; the
    // parameter map is what re-hydrates the picker on reopen — which is the whole reason
    // v1 needs no decodeConfiguration endpoint. Encoding failure here is non-fatal: the
    // BOM has already been fetched and reviewed by the user, so losing the audit trail is
    // strictly better than losing the import.
    let configurationParameters:
      | Record<string, string | number | boolean>
      | undefined;
    let encodedConfiguration: string | undefined;
    if (typeof configuration === "string" && configuration.length > 0) {
      try {
        configurationParameters = JSON.parse(configuration);
        const parameters = Object.entries(configurationParameters ?? {}).map(
          ([parameterId, parameterValue]) => ({
            parameterId,
            parameterValue: String(parameterValue)
          })
        );
        if (parameters.length > 0) {
          const onshape = await getOnshapeClient(client, companyId, userId);
          if (onshape.client) {
            const encoded = await onshape.client.encodeConfiguration(
              documentId as string,
              elementId as string,
              parameters,
              versionId as string
            );
            encodedConfiguration = encoded.encodedId;
          }
        }
      } catch (error) {
        logger.error("Failed to encode Onshape configuration for mapping", {
          error
        });
      }
    }

    const sync = await serviceRole.functions.invoke("sync", {
      body: {
        type: "onshape",
        makeMethodId,
        data: parsed,
        companyId,
        userId
      }
    });

    if (sync.error) {
      logger.info("Failed to sync onshape data", { error: sync.error });
      return data(
        { success: false, message: "Failed to sync onshape data" },
        { status: 400 }
      );
    }

    const itemId = record.data?.itemId as string;

    // Upsert the OnShape mapping in externalIntegrationMapping
    await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("integration", "onshape");

    await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: itemId,
      integration: "onshape",
      metadata: {
        documentId: documentId as string,
        versionId: versionId as string,
        elementId: elementId as string,
        ...(encodedConfiguration
          ? { configuration: encodedConfiguration }
          : {}),
        ...(configurationParameters ? { configurationParameters } : {})
      },
      lastSyncedAt: new Date().toISOString(),
      companyId
    });
  } catch (error) {
    logger.error("Failed to sync onshape data", { error: error });
    return data(
      { success: false, message: "Invalid rows data" },
      { status: 400 }
    );
  }

  return { success: true, message: "Synced successfully" };
}
