// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  type ChangeNoticeChangeType,
  changeNoticeChangeTypes
} from "~/modules/items/items.models";
import { path, requestReferrer } from "~/utils/path";

// One-click "Create Change Notice" for a part or tool. The new-revision modal
// posts `Revision` and the typed revision label; with no body (the parts
// table's action) it is a Version change.
const form = z.object({
  changeType: zfd.text(z.string().optional()),
  revision: zfd.text(z.string().trim().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["itemId"] });
  if ("invalid" in input) return input.invalid;
  const { changeType, revision } = input.data;
  const api = await carbon(args.request);
  const result = await api.items.createChangeNoticeForItem({
    itemId: input.params.itemId,
    changeType: changeNoticeChangeTypes.includes(
      changeType as ChangeNoticeChangeType
    )
      ? (changeType as ChangeNoticeChangeType)
      : "Version",
    revision: revision || undefined
  });
  if (result.error) {
    return respond(args.request, result).redirect(
      requestReferrer(args.request) ?? path.to.changeNotices
    );
  }
  const { id, warning } = result.data;
  return respond(
    args.request,
    warning ? { error: { message: warning } } : result
  ).redirect(path.to.changeNotice(id), { message: "Change notice created" });
}
