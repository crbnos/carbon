// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";
import { duplicatePriceListValidator } from "~/modules/sales";
import { duplicatePriceOverrides } from "~/modules/sales/sales.server";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(duplicatePriceListValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    sourceCustomerId,
    sourceCustomerTypeId,
    targetCustomerId,
    targetCustomerTypeId,
    conflictStrategy
  } = validation.data;

  let overrideIds: string[] | undefined;
  if (validation.data.overrideIds) {
    try {
      const parsed = z
        .array(z.string())
        .parse(JSON.parse(validation.data.overrideIds));
      overrideIds = parsed.length ? parsed : undefined;
    } catch {
      return validationError({
        fieldErrors: { overrideIds: "Invalid override IDs" }
      });
    }
  }

  const result = await duplicatePriceOverrides(
    client,
    companyId,
    userId,
    {
      customerId: sourceCustomerId,
      customerTypeId: sourceCustomerTypeId
    },
    {
      customerId: targetCustomerId,
      customerTypeId: targetCustomerTypeId
    },
    { overrideIds, conflictStrategy }
  );

  if (result.error) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to duplicate price list")
      )
    );
  }

  const parts = [];
  if (result.duplicated > 0) parts.push(`${result.duplicated} duplicated`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.overwritten > 0) parts.push(`${result.overwritten} overwritten`);
  const message = parts.length > 0 ? parts.join(", ") : "Nothing to duplicate";

  throw redirect(
    `${path.to.salesPriceList}?${getParams(request)}`,
    await flash(request, success(message))
  );
}
