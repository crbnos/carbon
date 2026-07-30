import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import invariant from "tiny-invariant";
import { getInspectionDocumentsForItem } from "~/modules/production";
import {
  getItemInspectionDocumentAssignments,
  itemInspectionDocumentAssignmentValidator,
  upsertItemInspectionDocumentAssignment
} from "~/modules/quality";
import type { ItemInspectionDocumentAssignment } from "~/modules/quality/types";
import ItemQualityView from "~/modules/quality/ui/Item/ItemQualityView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const [documents, assignments] = await Promise.all([
    getInspectionDocumentsForItem(client, itemId, companyId),
    getItemInspectionDocumentAssignments(client, itemId, companyId)
  ]);

  return data({
    documents: documents.data ?? [],
    assignments: (assignments.data ?? []) as ItemInspectionDocumentAssignment[]
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const formData = await request.formData();

  if (formData.get("intent") === "assignment") {
    const validation = await validator(
      itemInspectionDocumentAssignmentValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);

    const result = await upsertItemInspectionDocumentAssignment(client, {
      ...validation.data,
      companyId,
      userId
    });
    if (result.error) {
      throw redirect(
        path.to.serviceQuality(itemId),
        await flash(request, error(result.error, "Failed to save assignment"))
      );
    }

    throw redirect(
      path.to.serviceQuality(itemId),
      await flash(request, success("Inspection plan assignment updated"))
    );
  }

  throw redirect(
    path.to.serviceQuality(itemId),
    await flash(request, error(null, "Unknown intent"))
  );
}

export default function ServiceQualityRoute() {
  const { documents, assignments } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId is required");
  return (
    <div className="p-4 w-full">
      <ItemQualityView
        itemId={itemId}
        actionPath={path.to.serviceQuality(itemId)}
        documents={documents}
        assignments={assignments}
      />
    </div>
  );
}
