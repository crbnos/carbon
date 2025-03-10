import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nonScrapQuantityValidator } from "~/services/models";
import { insertProductionQuantity } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // this is a serial part
  if (validation.data.trackingType === "Serial") {
    const serviceRole = await getCarbonServiceRole();
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...validation.data,
        companyId,
        userId,
      },
    });

    const trackedEntityId = response.data?.newTrackedEntityId;

    if (trackedEntityId) {
      throw redirect(
        `${path.to.operation(
          validation.data.jobOperationId
        )}?trackedEntityId=${trackedEntityId}`
      );
    }

    throw redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else if (validation.data.trackingType === "Batch") {
    const serviceRole = await getCarbonServiceRole();
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        ...validation.data,
        companyId,
        userId,
      },
    });

    if (response.error) {
      return json(
        {},
        await flash(
          request,
          error(response.error, "Failed to complete job operation")
        )
      );
    }

    throw redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else {
    const { trackedEntityId, trackingType, ...data } = validation.data;
    const insertProduction = await insertProductionQuantity(client, {
      ...data,
      companyId,
      createdBy: userId,
    });

    if (insertProduction.error) {
      return json(
        {},
        await flash(
          request,
          error(insertProduction.error, "Failed to record production quantity")
        )
      );
    }

    return json(
      insertProduction.data,
      await flash(request, success("Production quantity recorded successfully"))
    );
  }
}
