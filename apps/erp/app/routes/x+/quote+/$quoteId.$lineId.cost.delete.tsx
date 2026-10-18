// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { quoteLineAdditionalChargesValidator } from "~/modules/sales/sales.models";
import { upsertQuoteLineAdditionalCharges } from "~/modules/sales/sales.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, userId } = await authorize(request, {
    update: "sales"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const additionalCharges = JSON.parse(
    (formData.get("additionalCharges") ?? "{}") as string
  );
  if (!additionalCharges)
    return data(
      {
        data: null,
        errors: { additionalCharges: "Additional charges are required" }
      },
      { status: 400 }
    );

  const parsedCharges =
    quoteLineAdditionalChargesValidator.safeParse(additionalCharges);
  if (parsedCharges.success === false) {
    return data(
      { data: null, errors: parsedCharges.error.issues?.[0].message },
      { status: 400 }
    );
  }

  delete parsedCharges.data[id];

  const { error } = await upsertQuoteLineAdditionalCharges(client, lineId, {
    additionalCharges: parsedCharges.data,
    updatedBy: userId
  });

  if (error) {
    return data(
      { data: null, errors: { form: error.message } },
      { status: 400 }
    );
  }

  return { data: { id }, error: null };
}
