// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import invariant from "tiny-invariant";
import { itemInspectionDocumentAssignmentValidator } from "~/modules/quality/quality.models";
import {
  getItemInspectionDocumentAssignments,
  upsertItemInspectionDocumentAssignment
} from "~/modules/quality/quality.service";
import type { ItemInspectionDocumentAssignment } from "~/modules/quality/types";
import ItemQualityView from "~/modules/quality/ui/Item/ItemQualityView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "parts"
  });
  const { client, companyId } = auth;
  const api = carbonFor(auth);
  const { itemId } = params;
  invariant(itemId, "itemId is required");

  const [documents, assignments] = await Promise.all([
    api.quality.getInspectionDocumentsForItem({ itemId }),
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
        path.to.partQuality(itemId),
        await flash(request, error(result.error, "Failed to save assignment"))
      );
    }

    throw redirect(
      path.to.partQuality(itemId),
      await flash(request, success("Inspection plan assignment updated"))
    );
  }

  throw redirect(
    path.to.partQuality(itemId),
    await flash(request, error(null, "Unknown intent"))
  );
}

export default function PartQualityRoute() {
  const { documents, assignments } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId is required");
  return (
    <div className="p-4 w-full">
      <ItemQualityView
        itemId={itemId}
        actionPath={path.to.partQuality(itemId)}
        documents={documents}
        assignments={assignments}
      />
    </div>
  );
}
