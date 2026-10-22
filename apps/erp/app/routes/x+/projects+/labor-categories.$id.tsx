// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
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
  laborCategoryRateValidator,
  laborCategoryValidator
} from "~/modules/projects/projects.models";
import {
  getLaborCategory,
  getLaborCategoryRates
} from "~/modules/projects/projects.service";
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
  const { id } = params;
  if (!id) throw notFound("Labor category ID was not found");

  const api = await carbon(request);
  const formData = await request.formData();

  if (formData.get("intent") === "rate") {
    // A grid cell posts `quiet` and reads `{ error }` instead of a flash.
    const quiet = formData.get("quiet") === "true";
    const validation = await validator(laborCategoryRateValidator).validate(
      formData
    );
    if (validation.error) {
      if (quiet) {
        return data(
          {
            success: false,
            error:
              Object.values(validation.error.fieldErrors ?? {})[0] ??
              "The rate is invalid"
          },
          { status: 400 }
        );
      }
      return validationError(validation.error);
    }

    const saved = await api.projects.upsertLaborCategoryRate({
      ...validation.data,
      laborCategoryId: id
    });
    if (saved.error) {
      if (quiet) {
        return data(
          { success: false, error: saved.error.message },
          { status: 400 }
        );
      }
      return data(
        { success: false },
        await flash(request, error(null, saved.error.message))
      );
    }
    if (quiet) return data({ success: true, error: null });
    return data({ success: true }, await flash(request, success("Rate saved")));
  }

  const validation = await validator(laborCategoryValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const updated = await api.projects.upsertLaborCategory({
    ...validation.data,
    id
  });
  if (updated.error) {
    return data({}, await flash(request, error(null, updated.error.message)));
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
