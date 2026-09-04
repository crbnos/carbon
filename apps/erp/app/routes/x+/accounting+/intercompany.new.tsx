import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { useCompanyToday } from "~/hooks";
import {
  createIntercompanyTransaction,
  getCompaniesInGroup,
  intercompanyTransactionValidator
} from "~/modules/accounting";
import { IntercompanyTransactionForm } from "~/modules/accounting/ui/Intercompany";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    create: "accounting"
  });

  const companies = await getCompaniesInGroup(client, companyGroupId);

  return {
    companies: companies.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(intercompanyTransactionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createIntercompanyTransaction(client, {
    ...validation.data,
    companyGroupId,
    userId
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to create IC transaction")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?${getParams(request)}`,
    await flash(request, success("IC transaction created"))
  );
}

export default function NewIntercompanyTransactionRoute() {
  const { companies } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const companyToday = useCompanyToday();
  const initialValues = {
    sourceCompanyId: "",
    targetCompanyId: "",
    amount: 0,
    currencyCode: "",
    description: "",
    debitAccountId: "",
    creditAccountId: "",
    postingDate: companyToday
  };

  return (
    <IntercompanyTransactionForm
      initialValues={initialValues}
      companies={companies}
      onClose={() => navigate(-1)}
    />
  );
}
