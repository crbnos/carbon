// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  getLaborCategory,
  getLaborCategoryRates,
  laborCategoryRateValidator,
  laborCategoryValidator,
  upsertLaborCategory,
  upsertLaborCategoryRate
} from "~/modules/projects";
import LaborCategoryForm from "~/modules/projects/ui/LaborCategories/LaborCategoryForm";
import { path } from "~/utils/path";

const logger = getLogger("erp", "labor-category");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("Labor category ID was not found");

  const [category, rates] = await Promise.all([
    getLaborCategory(client, id, companyId),
    getLaborCategoryRates(client, id, companyId)
  ]);

  if (category.error) {
    logger.error("Failed to load a labor category", {
      companyId,
      id,
      error: category.error
    });
    throw redirect(
      path.to.laborCategories,
      await flash(
        request,
        error(category.error, "Failed to load the labor category")
      )
    );
  }
  if (rates.error) {
    logger.error("Failed to load labor category rates", {
      companyId,
      id,
      error: rates.error
    });
  }

  return { category: category.data, rates: rates.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { id } = params;
  if (!id) throw notFound("Labor category ID was not found");

  const formData = await request.formData();

  if (formData.get("intent") === "rate") {
    const validation = await validator(laborCategoryRateValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const { id: rateId, ...rate } = validation.data;
    const saved = rateId
      ? await upsertLaborCategoryRate(client, {
          ...rate,
          laborCategoryId: id,
          id: rateId,
          companyId,
          updatedBy: userId
        })
      : await upsertLaborCategoryRate(client, {
          ...rate,
          laborCategoryId: id,
          companyId,
          createdBy: userId
        });
    if (saved.error) {
      logger.error("Failed to save a labor category rate", {
        companyId,
        id,
        error: saved.error
      });
      return data(
        { success: false },
        await flash(request, error(saved.error, "Failed to save the rate"))
      );
    }
    return data({ success: true }, await flash(request, success("Rate saved")));
  }

  const validation = await validator(laborCategoryValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  const updated = await upsertLaborCategory(client, {
    ...fields,
    id,
    companyId,
    updatedBy: userId
  });
  if (updated.error) {
    logger.error("Failed to update a labor category", {
      companyId,
      id,
      error: updated.error
    });
    return data(
      {},
      await flash(
        request,
        error(updated.error, "Failed to update the labor category")
      )
    );
  }

  throw redirect(
    path.to.laborCategories,
    await flash(request, success("Labor category updated"))
  );
}

export default function LaborCategoryRoute() {
  const { category, rates } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  return (
    <LaborCategoryForm
      key={category.id}
      initialValues={{
        id: category.id,
        name: category.name,
        description: category.description ?? "",
        rdActivityRole: category.rdActivityRole ?? undefined,
        active: category.active
      }}
      rates={rates}
      onClose={() => closeRoute()}
    />
  );
}
