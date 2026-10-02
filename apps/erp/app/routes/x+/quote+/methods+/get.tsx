// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  copyQuoteLine,
  getMethodValidator,
  recalculateQuoteLinePrices,
  upsertQuoteLineMethod,
  upsertQuoteMaterialMakeMethod
} from "~/modules/sales";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const type = formData.get("type") as string;
  const configurationStr = formData.get("configuration") as string | null;
  const configuration = configurationStr
    ? JSON.parse(configurationStr)
    : undefined;

  const serviceRole = getCarbonServiceRole();
  if (type === "item") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const [quoteId, quoteLineId] = validation.data.targetId.split(":");
    const itemId = validation.data.sourceId;

    const lineMethodPayload: any = {
      itemId,
      quoteId,
      quoteLineId,
      companyId,
      userId,
      parts: {
        billOfMaterial: validation.data.billOfMaterial,
        billOfProcess: validation.data.billOfProcess,
        parameters: validation.data.parameters,
        tools: validation.data.tools,
        steps: validation.data.steps,
        workInstructions: validation.data.workInstructions
      }
    };

    // Only add configuration if it exists
    if (configuration !== undefined) {
      lineMethodPayload.configuration = configuration;
    }

    const lineMethod = await upsertQuoteLineMethod(
      serviceRole,
      lineMethodPayload
    );

    if (lineMethod.error) {
      return { error: "Failed to get quote line method" };
    }

    // A new method (or configuration) changes the line's cost and its
    // configuration surcharges, so reprice its existing quantities.
    const recalculate = await recalculateQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      userId
    );

    return {
      error: recalculate.error
        ? "Failed to recalculate quote line prices"
        : null
    };
  }

  if (type === "quoteLine") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const copyLine = await copyQuoteLine(serviceRole, {
      ...validation.data,
      companyId,
      userId
    });

    if (copyLine.error) {
      return { error: "Failed to copy quote line" };
    }

    // The copied method re-seeds the line's prices at cost-plus only; apply
    // the line's pricing rules and configuration prices on top.
    const [quoteId, quoteLineId] = validation.data.targetId.split(":");
    const recalculate = await recalculateQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      userId
    );

    return {
      error: recalculate.error
        ? "Failed to recalculate quote line prices"
        : null
    };
  }

  if (type === "method") {
    const validation = await validator(getMethodValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const makeMethodPayload: any = {
      ...validation.data,
      companyId,
      userId,
      parts: {
        billOfMaterial: validation.data.billOfMaterial,
        billOfProcess: validation.data.billOfProcess,
        parameters: validation.data.parameters,
        tools: validation.data.tools,
        steps: validation.data.steps,
        workInstructions: validation.data.workInstructions
      }
    };

    // Only add configuration if it exists
    if (configuration !== undefined) {
      makeMethodPayload.configuration = configuration;
    }

    const makeMethod = await upsertQuoteMaterialMakeMethod(
      serviceRole,
      makeMethodPayload
    );

    if (makeMethod.error) {
      return {
        error: makeMethod.error
          ? "Failed to insert quote material make method"
          : null
      };
    }

    throw redirect(requestReferrer(request) ?? path.to.quotes);
  }

  return data({ error: "Invalid type" }, { status: 400 });
}
