// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  financingApproveValidator,
  financingOverrideValidator
} from "@carbon/ee/contract-financing";
import {
  approveFinancingRequest,
  FinancingError,
  getFinancingRequest,
  overrideRequestLine,
  submitFinancingRequest,
  withdrawFinancingRequest
} from "@carbon/ee/contract-financing.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate, useParams } from "react-router";
import ContractFinancingRequest from "~/modules/sales/ui/Contracts/ContractFinancingRequest.ee";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-financing-request");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id, requestId } = params;
  if (!id || !requestId) throw new Error("Could not find the request");

  const [detail, contract] = await Promise.all([
    getFinancingRequest(getDatabaseClient(), {
      companyId,
      customerContractId: id,
      requestId
    }),
    client
      .from("customerContract")
      .select("customerId")
      .eq("id", id)
      .eq("companyId", companyId)
      .single()
  ]);
  if (!detail) {
    throw redirect(
      path.to.contractFinancing(id),
      await flash(request, error(null, "The request does not exist"))
    );
  }
  return { request: detail, customerId: contract.data?.customerId ?? null };
}

/**
 * Intents: `override` (a Draft line), `submit`, `approve`, `withdraw` and
 * `record-payment`, which opens a new contract deposit for the approved
 * amount.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });
  const { id, requestId } = params;
  if (!id || !requestId) throw new Error("Could not find the request");
  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.contractFinancing(id),
    feature: "GOVERNMENT_CONTRACTING"
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actor = { companyId, userId, customerContractId: id, requestId };
  const db = getDatabaseClient();

  try {
    switch (intent) {
      case "override": {
        const validation = await validator(financingOverrideValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        await overrideRequestLine(client, db, {
          ...actor,
          ...validation.data
        });
        return data(
          { success: true },
          await flash(request, success("Line saved"))
        );
      }
      case "submit": {
        const number = await submitFinancingRequest(client, db, actor);
        return data(
          { success: true },
          await flash(request, success(`Submitted as request ${number}`))
        );
      }
      case "approve": {
        const validation = await validator(financingApproveValidator).validate(
          formData
        );
        if (validation.error) return validationError(validation.error);
        await approveFinancingRequest(client, db, {
          ...actor,
          approvedAmount: validation.data.approvedAmount
        });
        return data(
          { success: true },
          await flash(request, success("Request approved"))
        );
      }
      case "withdraw": {
        await withdrawFinancingRequest(client, db, actor);
        throw redirect(
          path.to.contractFinancing(id),
          await flash(request, success("Request withdrawn"))
        );
      }
      case "record-payment": {
        const detail = await getFinancingRequest(db, {
          companyId,
          customerContractId: id,
          requestId
        });
        const contract = await client
          .from("customerContract")
          .select("customerId")
          .eq("id", id)
          .eq("companyId", companyId)
          .single();
        if (
          !detail ||
          detail.status !== "Approved" ||
          !contract.data?.customerId
        ) {
          return data(
            { success: false },
            await flash(
              request,
              error(null, "Only an Approved request takes a payment")
            )
          );
        }
        const query = new URLSearchParams({
          customerId: contract.data.customerId,
          customerContractId: id,
          financingRequestId: requestId,
          amount: String(detail.approvedAmount ?? detail.requestedAmount)
        });
        throw redirect(`${path.to.paymentNew}?${query}`);
      }
      default:
        return data({ success: false }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    if (
      !(err instanceof FinancingError) &&
      !(err instanceof EntitlementError)
    ) {
      logger.error("Failed to change the financing request", {
        companyId,
        requestId,
        error: err
      });
    }
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof FinancingError
            ? err.message
            : "Failed to change the request"
        )
      )
    );
  }
}

export default function ContractFinancingRequestRoute() {
  const { request } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const navigate = useNavigate();
  if (!id) throw new Error("Could not find id");
  return (
    <ContractFinancingRequest
      contractId={id}
      request={request}
      onClose={() => navigate(path.to.contractFinancing(id))}
    />
  );
}
