import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useUser } from "~/hooks";
import {
  addChangeOrderAffectedItem,
  changeOrderValidator,
  getChangeOrderTypesList,
  insertChangeOrder
} from "~/modules/items";
import { ChangeOrderForm } from "~/modules/items/ui/ChangeOrder";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders,
  module: "items"
};

// The reason/description form fields arrive as plain text; the columns are
// tiptap JSON, so wrap non-empty text into a minimal doc (the inline Editor on
// the detail page then edits it as rich text). Empty stays undefined.
function toRichText(value: string | undefined): Json | undefined {
  if (!value) return undefined;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }]
  } as unknown as Json;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const types = await getChangeOrderTypesList(client, companyId);

  // "Create Change Order" from an Issue (NCR) links here with the source in the
  // query string. Pre-link the non-conformance so the created CO references it
  // (changeOrder.nonConformanceId) — the create action reads this off the form.
  const url = new URL(request.url);
  const sourceType = url.searchParams.get("sourceType");
  const sourceId = url.searchParams.get("sourceId") ?? undefined;
  const name = url.searchParams.get("name") ?? undefined;

  const nonConformanceId =
    sourceType === "nonConformance" ? sourceId : undefined;

  return {
    types: types.data ?? [],
    nonConformanceId: nonConformanceId ?? "",
    name: name ?? ""
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  const createResult = await insertChangeOrder(client, {
    changeOrderId: d.changeOrderId || undefined,
    name: d.name,
    reasonForChange: toRichText(d.reasonForChange),
    description: toRichText(d.description),
    priority: d.priority,
    changeOrderTypeId: d.changeOrderTypeId || undefined,
    nonConformanceId: d.nonConformanceId || undefined,
    openDate: d.openDate || today(getLocalTimeZone()).toString(),
    dueDate: d.dueDate || undefined,
    assignee: d.assignee || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createResult.error || !createResult.data) {
    throw redirect(
      path.to.changeOrders,
      await flash(
        request,
        error(createResult.error, "Failed to create change order")
      )
    );
  }

  // Attach any affected Parts/Tools picked at create time. Each is added as a
  // Version change (the service coerces Buy items to Revision). Best-effort: the
  // CO already exists, so a per-item failure lands the user on the detail page
  // with a warning rather than losing the CO.
  const affectedItemIds = [...new Set(d.affectedItemIds ?? [])];
  let affectedError: Parameters<typeof error>[0] = null;
  for (const itemId of affectedItemIds) {
    const add = await addChangeOrderAffectedItem(client, {
      changeOrderId: createResult.data.id,
      itemId,
      changeType: "Version",
      companyId,
      userId
    });
    if (add.error) affectedError = add.error;
  }

  if (affectedError) {
    throw redirect(
      path.to.changeOrderDetails(createResult.data.id),
      await flash(
        request,
        error(
          affectedError,
          "Change order created, but some items could not be added"
        )
      )
    );
  }

  throw redirect(path.to.changeOrderDetails(createResult.data.id));
}

export default function ChangeOrderNewRoute() {
  const { types, nonConformanceId, name } = useLoaderData<typeof loader>();
  const user = useUser();

  const initialValues = {
    id: undefined,
    changeOrderId: undefined,
    name,
    reasonForChange: "",
    description: "",
    changeOrderTypeId: "",
    assignee: user.id,
    priority: "Medium" as const,
    openDate: today(getLocalTimeZone()).toString(),
    dueDate: "",
    nonConformanceId,
    affectedItemIds: []
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ChangeOrderForm initialValues={initialValues} types={types} />
    </div>
  );
}
