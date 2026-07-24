import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getLegalSeriesById,
  legalSeriesValidator,
  upsertLegalSeries
} from "~/modules/accounting";
import { LegalSeriesForm } from "~/modules/accounting/ui/LegalSeries";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { legalSeriesId } = params;
  if (!legalSeriesId) throw notFound("legalSeriesId not found");

  const legalSeries = await getLegalSeriesById(client, legalSeriesId);

  return {
    legalSeries: legalSeries?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(legalSeriesValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateLegalSeries = await upsertLegalSeries(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateLegalSeries.error) {
    return data(
      {},
      await flash(
        request,
        error(updateLegalSeries.error, "Failed to update legal series")
      )
    );
  }

  throw redirect(
    `${path.to.legalSeries}?${getParams(request)}`,
    await flash(request, success("Updated legal series"))
  );
}

export default function EditLegalSeriesRoute() {
  const { legalSeries } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: legalSeries?.id ?? undefined,
    countryCode: legalSeries?.countryCode ?? "",
    documentType: (legalSeries?.documentType ?? "salesInvoice") as
      | "salesInvoice"
      | "creditMemo",
    code: legalSeries?.code ?? "",
    name: legalSeries?.name ?? "",
    prefix: legalSeries?.prefix ?? "",
    size: legalSeries?.size ?? 6,
    validFrom: legalSeries?.validFrom ?? "",
    validTo: legalSeries?.validTo ?? "",
    registrationRef: legalSeries?.registrationRef ?? "",
    isDefault: legalSeries?.isDefault ?? false,
    isActive: legalSeries?.isActive ?? true,
    ...getCustomFields(legalSeries?.customFields)
  };

  return (
    <LegalSeriesForm
      key={initialValues.id}
      initialValues={initialValues}
      formatLocked={Boolean(legalSeries?.firstUsedAt)}
      onClose={() => navigate(-1)}
    />
  );
}
