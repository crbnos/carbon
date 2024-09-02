import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  AccountDefaultsForm,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  getDefaultAccounts,
  updateDefaultBalanceSheetAccounts,
  updateDefaultIncomeAccounts,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Defaults",
  to: path.to.accountingDefaults,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
  });

  const [defaultAccounts] = await Promise.all([
    getDefaultAccounts(client, companyId),
  ]);

  if (defaultAccounts.error || !defaultAccounts.data) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(defaultAccounts.error, "Failed to load default accounts")
      )
    );
  }

  return json({
    defaultAccounts: defaultAccounts.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "income") {
    const validation = await validator(defaultIncomeAcountValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const updateDefaults = await updateDefaultIncomeAccounts(client, {
      ...validation.data,
      companyId,
      updatedBy: userId,
    });
    if (updateDefaults.error) {
      return json(
        {},
        await flash(
          request,
          error(updateDefaults.error, "Failed to update default accounts")
        )
      );
    }

    throw redirect(
      path.to.accountingDefaults,
      await flash(request, success("Updated income statement accounts"))
    );
  } else if (intent === "balance") {
    const validation = await validator(
      defaultBalanceSheetAccountValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const updateDefaults = await updateDefaultBalanceSheetAccounts(client, {
      ...validation.data,
      companyId,
      updatedBy: userId,
    });
    if (updateDefaults.error) {
      return json(
        {},
        await flash(
          request,
          error(updateDefaults.error, "Failed to update default accounts")
        )
      );
    }

    throw redirect(
      path.to.accountingDefaults,
      await flash(request, success("Updated balance sheet accounts"))
    );
  }

  throw new Error(`Invalid intent: ${intent}`);
}

export default function AccountDefaultsRoute() {
  const { defaultAccounts } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);

  return (
    <VStack className="h-full p-4 overflow-y-auto">
      <AccountDefaultsForm
        balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
        incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
        initialValues={defaultAccounts}
      />
    </VStack>
  );
}
