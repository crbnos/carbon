// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useCompanyToday, useUser } from "~/hooks";
import { changeNoticeValidator } from "~/modules/items/items.models";
import { getChangeNoticeTypesList } from "~/modules/items/items.service";
import { ChangeNoticeForm } from "~/modules/items/ui/ChangeNotice";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Notices`,
  to: path.to.changeNotices,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const types = await getChangeNoticeTypesList(client, companyId);

  // "Create Change Notice" from an Issue (NCR) links here with the source in the
  // query string. Pre-link the non-conformance so the created CO references it
  // (changeOrder.nonConformanceId) — the create action reads this off the form.
  const url = new URL(request.url);
  const sourceType = url.searchParams.get("sourceType");
  const sourceId = url.searchParams.get("sourceId") ?? undefined;
  const name = url.searchParams.get("name") ?? undefined;

  const nonConformanceId =
    sourceType === "nonConformance" ? sourceId : undefined;

  return {
    types: types.data ?? [],
    nonConformanceId: nonConformanceId ?? "",
    name: name ?? ""
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(changeNoticeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.createChangeNotice({
    ...input.data,
    customFields: input.formData && setCustomFields(input.formData)
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.changeNotices);
  }
  const { id, warning } = result.data;
  return respond(
    args.request,
    warning ? { error: { message: warning } } : result
  ).redirect(path.to.changeNoticeDetails(id));
}

export default function ChangeNoticeNewRoute() {
  const { types, nonConformanceId, name } = useLoaderData<typeof loader>();
  const user = useUser();

  const companyToday = useCompanyToday();
  const initialValues = {
    id: undefined,
    changeOrderId: undefined,
    name,
    reasonForChange: "",
    description: "",
    changeOrderTypeId: "",
    assignee: user.id,
    priority: "Medium" as const,
    openDate: companyToday,
    dueDate: "",
    nonConformanceId,
    affectedItemIds: []
  };

  return (
    <NewRecordPage>
      <ChangeNoticeForm initialValues={initialValues} types={types} />
    </NewRecordPage>
  );
}
