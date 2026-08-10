import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useCompanyToday, useUser } from "~/hooks";
import {
  addChangeNoticeAffectedItem,
  changeNoticeValidator,
  getChangeNoticeTypesList,
  insertChangeNotice
} from "~/modules/items";
import { ChangeNoticeForm } from "~/modules/items/ui/ChangeNotice";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Notices`,
  to: path.to.changeNotices,
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

  const types = await getChangeNoticeTypesList(client, companyId);

  // "Create Change Notice" from an Issue (NCR) links here with the source in the
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
  const validation = await validator(changeNoticeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  const createResult = await insertChangeNotice(client, {
    changeNoticeId: d.changeOrderId || undefined,
    name: d.name,
    reasonForChange: toRichText(d.reasonForChange),
    description: toRichText(d.description),
    priority: d.priority,
    changeNoticeTypeId: d.changeOrderTypeId || undefined,
    nonConformanceId: d.nonConformanceId || undefined,
    openDate:
      d.openDate ||
      datetime.today(await getCompanyTimeZone(client, companyId)).toString(),
    dueDate: d.dueDate || undefined,
    assignee: d.assignee || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createResult.error || !createResult.data) {
    throw redirect(
      path.to.changeNotices,
      await flash(
        request,
        error(createResult.error, "Failed to create change notice")
      )
    );
  }

  // Attach any affected Parts picked at create time. Each is added as a Version
  // change (the service coerces Buy items to Revision). Best-effort: the CO
  // already exists, so a per-item failure lands the user on the detail page with
  // a warning rather than losing the CO.
  const submittedItemIds = [...new Set(d.affectedItemIds ?? [])];

  // Change notices operate on Parts only — the create modal is reachable from
  // Tool pages, so filter out anything that isn't a Part.
  const submittedItems = submittedItemIds.length
    ? await client
        .from("item")
        .select("id, type")
        .in("id", submittedItemIds)
        .eq("companyId", companyId)
    : null;

  const affectedItemIds = (submittedItems?.data ?? [])
    .filter((item) => item.type === "Part")
    .map((item) => item.id);
  const skippedNonParts = submittedItemIds.length - affectedItemIds.length;

  let affectedError: Parameters<typeof error>[0] =
    submittedItems?.error ?? null;
  for (const itemId of affectedItemIds) {
    const add = await addChangeNoticeAffectedItem(client, {
      changeNoticeId: createResult.data.id,
      itemId,
      changeType: "Version",
      companyId,
      userId
    });
    if (add.error) affectedError = add.error;
  }

  if (affectedError || skippedNonParts > 0) {
    throw redirect(
      path.to.changeNoticeDetails(createResult.data.id),
      await flash(
        request,
        error(
          affectedError,
          affectedError
            ? "Change notice created, but some items could not be added"
            : "Change notice created. Change notices support Parts only, so non-Part items were skipped"
        )
      )
    );
  }

  throw redirect(path.to.changeNoticeDetails(createResult.data.id));
}

export default function ChangeNoticeNewRoute() {
  const { types, nonConformanceId, name } = useLoaderData<typeof loader>();
  const user = useUser();

  const companyToday = useCompanyToday();
  const initialValues = {
    id: undefined,
    changeOrderId: undefined,
    name,
    reasonForChange: "",
    description: "",
    changeOrderTypeId: "",
    assignee: user.id,
    priority: "Medium" as const,
    openDate: companyToday,
    dueDate: "",
    nonConformanceId,
    affectedItemIds: []
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ChangeNoticeForm initialValues={initialValues} types={types} />
    </div>
  );
}
