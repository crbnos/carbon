import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  addChangeOrderAffectedItem,
  type ChangeOrderChangeType,
  changeOrderChangeTypes,
  getItem,
  insertChangeOrder
} from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

// One-click "Create Change Order" for a part/tool: mint a CO and attach the item
// as its first affected item, then open the CO. Change-order creation lives only
// here (and new.tsx) — this route is the single home for the create+attach flow,
// so no CO logic leaks into the revision/part routes that link to it.
//
// The optional `changeType` + `revision` POST fields let callers request a
// specific kind of change (the new-revision modal posts `Revision` plus the
// typed revision label); with no body it defaults to a `Version` change (the
// parts-table "Create Change Order" action).
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");

  const formData = await request.formData();
  const changeTypeRaw = formData.get("changeType");
  const changeType: ChangeOrderChangeType = changeOrderChangeTypes.includes(
    changeTypeRaw as ChangeOrderChangeType
  )
    ? (changeTypeRaw as ChangeOrderChangeType)
    : "Version";
  const revisionRaw = formData.get("revision");
  const revision =
    typeof revisionRaw === "string" && revisionRaw.trim()
      ? revisionRaw.trim()
      : undefined;

  const backTo = requestReferrer(request) ?? path.to.changeOrders;

  const item = await getItem(client, itemId);
  const label =
    item.data?.readableIdWithRevision ?? item.data?.readableId ?? itemId;

  const co = await insertChangeOrder(client, {
    companyId,
    createdBy: userId,
    name: `Change for ${label}`,
    openDate: today(getLocalTimeZone()).toString()
  });
  if (co.error || !co.data) {
    throw redirect(
      backTo,
      await flash(request, error(co.error, "Failed to create change order"))
    );
  }

  const add = await addChangeOrderAffectedItem(client, {
    changeOrderId: co.data.id,
    itemId,
    changeType,
    revision,
    companyId,
    userId
  });
  if (add.error) {
    throw redirect(
      path.to.changeOrder(co.data.id),
      await flash(
        request,
        error(
          add.error,
          "Change order created, but the item could not be added"
        )
      )
    );
  }

  throw redirect(
    path.to.changeOrder(co.data.id),
    await flash(request, success("Change order created"))
  );
}
