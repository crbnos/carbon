import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  quoteMaterialValidator,
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const serviceRole = getCarbonServiceRole();
  const insertQuoteMaterial = await upsertQuoteMaterial(serviceRole, {
    ...data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertQuoteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial.error, "Failed to insert quote material")
      )
    );
  }

  const quoteMaterialId = insertQuoteMaterial.data?.id;
  if (!quoteMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial, "Failed to insert quote material")
      )
    );
  }

  if (data.methodType === "Make") {
    const materialMakeMethod = await serviceRole
      .from("quoteMaterialWithMakeMethodId")
      .select("*")
      .eq("id", quoteMaterialId)
      .single();
    if (materialMakeMethod.error) {
      return json(
        {
          id: null,
        },
        await flash(
          request,
          error(materialMakeMethod.error, "Failed to get material make method")
        )
      );
    }
    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, {
      sourceId: data.itemId,
      targetId: materialMakeMethod.data?.quoteMaterialMakeMethodId!,
      companyId,
      userId,
    });

    if (makeMethod.error) {
      return json(
        {
          id: quoteMaterialId,
        },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert quote material make method")
        )
      );
    }
  }

  return json({ id: quoteMaterialId });
}
