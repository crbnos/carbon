import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nonScrapQuantityValidator } from "~/services/models";
import {
  finishJobOperation,
  insertProductionQuantity,
} from "~/services/operations.service";
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

  const serviceRole = await getCarbonServiceRole();

  // Get current job operation and production quantities to check if operation will be finished
  const [jobOperation, productionQuantities] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*")
      .eq("id", validation.data.jobOperationId)
      .maybeSingle(),
    serviceRole
      .from("productionQuantity")
      .select("*")
      .eq("type", "Production")
      .eq("jobOperationId", validation.data.jobOperationId),
  ]);

  if (jobOperation.error || !jobOperation.data) {
    return json(
      {},
      await flash(
        request,
        error(jobOperation.error, "Failed to fetch job operation")
      )
    );
  }

  const currentQuantity =
    productionQuantities.data?.reduce((acc, curr) => acc + curr.quantity, 0) ??
    0;

  const willBeFinished =
    validation.data.quantity + currentQuantity >=
    (jobOperation.data.operationQuantity ?? 0);

  if (validation.data.trackingType === "Serial") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...validation.data,
        companyId,
        userId,
      },
      region: FunctionRegion.UsEast1,
    });

    const trackedEntityId = response.data?.newTrackedEntityId;

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
      });

      if (finishOperation.error) {
        return json(
          {},
          await flash(
            request,
            error(finishOperation.error, "Failed to finish operation")
          )
        );
      }

      throw redirect(
        path.to.operations,
        await flash(request, success("Operation finished successfully"))
      );
    }

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
      region: FunctionRegion.UsEast1,
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

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
      });

      if (finishOperation.error) {
        return json(
          {},
          await flash(
            request,
            error(finishOperation.error, "Failed to finish operation")
          )
        );
      }

      throw redirect(
        path.to.operations,
        await flash(request, success("Operation finished successfully"))
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

    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: validation.data.jobOperationId,
        type: "jobOperation",
        quantity: validation.data.quantity,
        companyId,
        userId,
      },
      region: FunctionRegion.UsEast1,
    });

    if (issue.error) {
      throw json(
        insertProduction.data,
        await flash(request, error(issue.error, "Failed to issue materials"))
      );
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
      });

      if (finishOperation.error) {
        return json(
          {},
          await flash(
            request,
            error(finishOperation.error, "Failed to finish operation")
          )
        );
      }

      throw redirect(
        path.to.operations,
        await flash(request, success("Operation finished successfully"))
      );
    }

    return json(
      insertProduction.data,
      await flash(request, success("Production quantity recorded successfully"))
    );
  }
}
