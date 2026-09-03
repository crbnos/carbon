import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  defaultAccountValidator,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  getDefaultAccounts,
  updateDefaultBalanceSheetAccounts,
  updateDefaultIncomeAccounts
} from "~/modules/accounting";
import { AccountDefaultsForm } from "~/modules/accounting/ui/AccountDefaults";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Defaults`,
  to: path.to.accountingDefaults
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const defaultAccounts = await getDefaultAccounts(client, companyId);

  if (defaultAccounts.error || !defaultAccounts.data) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(defaultAccounts.error, "Failed to load default accounts")
      )
    );
  }

  return {
    defaultAccounts: defaultAccounts.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "all") {
    const validation = await validator(defaultAccountValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const incomeValidation = defaultIncomeAcountValidator.safeParse(
      validation.data
    );
    const balanceValidation = defaultBalanceSheetAccountValidator.safeParse(
      validation.data
    );

    if (!incomeValidation.success || !balanceValidation.success) {
      throw new Error("Failed to parse default accounts");
    }

    const [updateIncome, updateBalance] = await Promise.all([
      updateDefaultIncomeAccounts(client, {
        ...incomeValidation.data,
        companyId,
        updatedBy: userId
      }),
      updateDefaultBalanceSheetAccounts(client, {
        ...balanceValidation.data,
        companyId,
        updatedBy: userId
      })
    ]);

    if (updateIncome.error || updateBalance.error) {
      return data(
        {},
        await flash(
          request,
          error(
            updateIncome.error || updateBalance.error,
            "Failed to update default accounts"
          )
        )
      );
    }

    throw redirect(
      path.to.accountingDefaults,
      await flash(request, success("Updated default accounts"))
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
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <AccountDefaultsForm
          balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
          incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
          // @ts-expect-error TS2322 - TODO: fix type
          initialValues={defaultAccounts}
        />
      </VStack>
    </ScrollArea>
  );
}
