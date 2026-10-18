// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { useCompanyToday } from "~/hooks";
import { intercompanyTransactionValidator } from "~/modules/accounting/accounting.models";
import { createIntercompanyTransaction } from "~/modules/accounting/accounting.service";
import { IntercompanyTransactionForm } from "~/modules/accounting/ui/Intercompany";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    create: "accounting"
  });

  const companies = await api.accounting.getCompaniesInGroup({});

  return {
    companies: companies.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await authorize(request, {
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
  const closeRoute = useCloseRoute();

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
      onClose={() => closeRoute()}
    />
  );
}
