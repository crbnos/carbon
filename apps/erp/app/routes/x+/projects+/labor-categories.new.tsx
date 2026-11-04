// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { laborCategoryValidator } from "~/modules/projects/projects.models";
import LaborCategoryForm from "~/modules/projects/ui/LaborCategories/LaborCategoryForm";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(laborCategoryValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { id: _id, ...fields } = input.data;
  const created = await api.projects.upsertLaborCategory(fields);
  if (created.error) {
    return data(
      {},
      await flash(args.request, error(null, created.error.message))
    );
  }

  // Open the new category, so its first cost rate can be added.
  throw redirect(
    path.to.laborCategory(created.data.id),
    await flash(args.request, success("Labor category created"))
  );
}

export default function NewLaborCategoryRoute() {
  const closeRoute = useCloseRoute();
  return (
    <LaborCategoryForm
      initialValues={{ name: "", description: "", active: true }}
      onClose={() => closeRoute()}
    />
  );
}
