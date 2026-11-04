// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  contractFinancingRateValidator,
  contractFinancingTermsValidator,
  financingRequestValidator,
  pbpEventCompleteValidator,
  pbpEventValidator
} from "@carbon/ee/contract-financing";
import {
  addFinancingRate,
  completePbpEvent,
  createFinancingRequest,
  FinancingError,
  getContractFinancing,
  upsertContractFinancing,
  upsertPbpEvent
} from "@carbon/ee/contract-financing.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import ContractFinancing from "~/modules/sales/ui/Contracts/ContractFinancing.ee";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-financing");

/** The contract's financing: its terms, rates, PBP events and requests. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [financing, lines, contract] = await Promise.all([
    getContractFinancing(getDatabaseClient(), {
      companyId,
      customerContractId: id
    }),
    client
      .from("customerContractLine")
      .select("id, lineItemNumber, description")
      .eq("customerContractId", id)
      .eq("companyId", companyId)
      .order("sortOrder"),
    client
      .from("customerContract")
      .select("customerId, currencyCode")
      .eq("id", id)
      .eq("companyId", companyId)
      .single()
  ]);
  if (lines.error || contract.error) {
    logger.error("Failed to load the contract for financing", {
      companyId,
      customerContractId: id,
      error: lines.error ?? contract.error
    });
  }

  return {
    financing,
    lines: lines.data ?? [],
    customerId: contract.data?.customerId ?? null
  };
}

/**
 * Intents: `terms`, `rate`, `event`, `complete-event` and `request` (a new
 * Draft request, which opens its drawer).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.contractFinancing(id),
    feature: "GOVERNMENT_CONTRACTING"
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actor = { companyId, userId, customerContractId: id };
  const db = getDatabaseClient();

  const refuse = async (err: unknown, message: string) => {
    if (
      !(err instanceof FinancingError) &&
      !(err instanceof EntitlementError)
    ) {
      logger.error(message, { companyId, customerContractId: id, error: err });
    }
    return data(
      { success: false },
      await flash(
        request,
        error(err, err instanceof FinancingError ? err.message : message)
      )
    );
  };

  try {
    switch (intent) {
      case "terms": {
        const validation = await validator(
          contractFinancingTermsValidator
        ).validate(formData);
        if (validation.error) return validationError(validation.error);
        await upsertContractFinancing(client, db, {
          ...actor,
          ...validation.data
        });
        return data(
          { success: true },
          await flash(request, success("Financing terms saved"))
        );
      }
      case "rate": {
        const validation = await validator(
          contractFinancingRateValidator
        ).validate(formData);
        if (validation.error) return validationError(validation.error);
        await addFinancingRate(client, db, { ...actor, ...validation.data });
        return data(
          { success: true },
          await flash(request, success("Rate added"))
        );
      }
      case "event": {
        const validation =
          await validator(pbpEventValidator).validate(formData);
        if (validation.error) return validationError(validation.error);
        await upsertPbpEvent(client, db, { ...actor, ...validation.data });
        return data(
          { success: true },
          await flash(request, success("Event saved"))
        );
      }
      case "complete-event": {
        const validation = await validator(pbpEventCompleteValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        await completePbpEvent(client, db, { ...actor, ...validation.data });
        return data(
          { success: true },
          await flash(request, success("Event complete"))
        );
      }
      case "request": {
        const validation = await validator(financingRequestValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        const requestId = await createFinancingRequest(client, db, {
          ...actor,
          ...validation.data
        });
        throw redirect(
          path.to.contractFinancingRequest(id, requestId),
          await flash(request, success("Request created"))
        );
      }
      default:
        return data({ success: false }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    return refuse(err, "Failed to save the financing");
  }
}

export default function ContractFinancingRoute() {
  const { financing, lines, customerId } = useLoaderData<typeof loader>();
  return (
    <>
      <ContractFinancing
        financing={financing}
        lines={lines}
        customerId={customerId}
      />
      <RecordOutlet />
    </>
  );
}
