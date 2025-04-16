import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { onShapeDataValidator } from "~/integrations/onshape/lib/data";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
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
    .select("companyId")
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

    await serviceRole.functions.invoke("sync", {
      body: {
        type: "onshape",
        makeMethodId,
        data,
        companyId,
        userId,
      },
    });
  } catch (error) {
    console.error(error);
    return json(
      { success: false, message: "Invalid rows data" },
      { status: 400 }
    );
  }

  return json({ success: true, message: "Synced successfully" });
}
