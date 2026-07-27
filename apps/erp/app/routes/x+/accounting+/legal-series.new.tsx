import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { legalSeriesValidator, upsertLegalSeries } from "~/modules/accounting";
import { LegalSeriesForm } from "~/modules/accounting/ui/LegalSeries";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();

  const validation = await validator(legalSeriesValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped from the insert payload
  const { id, ...rest } = validation.data;

  const insertLegalSeries = await upsertLegalSeries(client, {
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertLegalSeries.error) {
    return data(
      {},
      await flash(
        request,
        error(insertLegalSeries.error, "Failed to insert legal series")
      )
    );
  }

  throw redirect(
    `${path.to.legalSeries}?${getParams(request)}`,
    await flash(request, success("Legal series created"))
  );
}

export default function NewLegalSeriesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    countryCode: "",
    documentType: "salesInvoice" as const,
    code: "",
    name: "",
    prefix: "",
    size: 6,
    validFrom: "",
    validTo: "",
    registrationRef: "",
    isDefault: false,
    isActive: true
  };

  return (
    <LegalSeriesForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
