import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  addChangeNoticeAffectedItem,
  type ChangeNoticeChangeType,
  changeNoticeChangeTypes,
  getItem,
  insertChangeNotice
} from "~/modules/items";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path, requestReferrer } from "~/utils/path";

// One-click "Create Change Notice" for a part/tool: mint a CO and attach the item
// as its first affected item, then open the CO. Change-order creation lives only
// here (and new.tsx) — this route is the single home for the create+attach flow,
// so no CO logic leaks into the revision/part routes that link to it.
//
// The optional `changeType` + `revision` POST fields let callers request a
// specific kind of change (the new-revision modal posts `Revision` plus the
// typed revision label); with no body it defaults to a `Version` change (the
// parts-table "Create Change Notice" action).
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");

  const formData = await request.formData();
  const changeTypeRaw = formData.get("changeType");
  const changeType: ChangeNoticeChangeType = changeNoticeChangeTypes.includes(
    changeTypeRaw as ChangeNoticeChangeType
  )
    ? (changeTypeRaw as ChangeNoticeChangeType)
    : "Version";
  const revisionRaw = formData.get("revision");
  const revision =
    typeof revisionRaw === "string" && revisionRaw.trim()
      ? revisionRaw.trim()
      : undefined;

  const backTo = requestReferrer(request) ?? path.to.changeNotices;

  const item = await getItem(client, itemId);
  const label =
    item.data?.readableIdWithRevision ?? item.data?.readableId ?? itemId;

  const co = await insertChangeNotice(client, {
    companyId,
    createdBy: userId,
    name: `Change for ${label}`,
    openDate: datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString()
  });
  if (co.error || !co.data) {
    throw redirect(
      backTo,
      await flash(request, error(co.error, "Failed to create change notice"))
    );
  }

  const add = await addChangeNoticeAffectedItem(client, {
    changeNoticeId: co.data.id,
    itemId,
    changeType,
    revision,
    companyId,
    userId
  });
  if (add.error) {
    throw redirect(
      path.to.changeNotice(co.data.id),
      await flash(
        request,
        error(
          add.error,
          "Change notice created, but the item could not be added"
        )
      )
    );
  }

  throw redirect(
    path.to.changeNotice(co.data.id),
    await flash(request, success("Change notice created"))
  );
}
