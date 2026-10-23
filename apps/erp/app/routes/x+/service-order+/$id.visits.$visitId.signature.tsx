// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Saves the customer's signature on a visit (`signServiceVisit`): the PNG in
 * the company's private bucket, then its path and the signer's name. A user
 * without `update: "service"` signs only their own open visit.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "visitId"]
  });
  if ("invalid" in input) return input.invalid;
  const formData = await args.request.formData();
  const signature = formData.get("signature");
  const signedByName = formData.get("signedByName");
  if (!(signature instanceof File)) return failure("Sign before you save");

  const api = await carbon(args.request);
  const result = await api.service.signServiceVisit({
    serviceOrderId: input.params.id,
    serviceVisitId: input.params.visitId,
    signature,
    signedByName: typeof signedByName === "string" ? signedByName : ""
  });
  if (result.error) return failure(result.error.message);

  return data(
    { success: true, error: null },
    await flash(args.request, success("Signature saved"))
  );
}
