import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { onShapeDataValidator } from "@carbon/integrations/onshape";
import { FunctionRegion } from "@supabase/supabase-js";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export const config = {
  runtime: "nodejs",
  maxDuration: 300,
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const documentId = formData.get("documentId");
  const versionId = formData.get("versionId");
  const elementId = formData.get("elementId");

  const makeMethodId = formData.get("makeMethodId");
  const rows = formData.get("rows");

  if (!makeMethodId || !rows) {
    return json(
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
    return json(
      { success: false, message: "Invalid make method id" },
      { status: 400 }
    );
  }

  try {
    const data = onShapeDataValidator.parse(JSON.parse(rows as string));
    const serviceRole = await getCarbonServiceRole();

    const [sync, item] = await Promise.all([
      serviceRole.functions.invoke("sync", {
        body: {
          type: "onshape",
          makeMethodId,
          data,
          companyId,
          userId,
        },
        region: FunctionRegion.UsEast1,
      }),
      serviceRole
        .from("item")
        .select("externalId")
        .eq("id", record.data?.itemId as string)
        .single(),
    ]);

    if (sync.error) {
      return json(
        { success: false, message: "Failed to sync onshape data" },
        { status: 400 }
      );
    }

    if (item.error) {
      return json(
        { success: false, message: "Failed to get item" },
        { status: 400 }
      );
    }

    const currentExternalId =
      (item.data?.externalId as Record<string, any>) ?? {};

    currentExternalId["onshape"] = {
      documentId,
      versionId,
      elementId,
      lastSyncedAt: new Date().toISOString(),
    };

    await client
      .from("item")
      .update({
        externalId: currentExternalId,
      })
      .eq("id", record.data?.itemId as string);
  } catch (error) {
    console.error("Failed to sync onshape data");
    return json(
      { success: false, message: "Invalid rows data" },
      { status: 400 }
    );
  }

  return json({ success: true, message: "Synced successfully" });
}
