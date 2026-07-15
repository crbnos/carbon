import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";
import type { AccountClass, AccountIncomeBalance } from "~/modules/accounting";
import {
  getGroupAccounts,
  groupAccountValidator,
  upsertAccount
} from "~/modules/accounting";
import { GroupAccountForm } from "~/modules/accounting/ui/ChartOfAccounts";
import { path } from "~/utils/path";
import { accountsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    create: "accounting"
  });

  const groupAccounts = await getGroupAccounts(client, companyGroupId);

  return {
    groupAccounts: groupAccounts.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(groupAccountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _, ...d } = validation.data;

  const insertAccount = await upsertAccount(client, {
    ...d,
    number: null,
    isGroup: true,
    consolidatedRate: "Average",
    parentId: d.parentId || undefined,
    companyGroupId,
    createdBy: userId
  });

  if (insertAccount.error) {
    return data(
      {},
      await flash(request, error(insertAccount.error, "Failed to create group"))
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Group created"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    accountsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewGroupAccountRoute() {
  const { groupAccounts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get("parentId") ?? undefined;

  const initialValues = {
    name: "",
    parentId,
    class: "Asset" as AccountClass,
    incomeBalance: "Balance Sheet" as AccountIncomeBalance
  };

  return (
    <GroupAccountForm
      initialValues={initialValues}
      groupAccounts={groupAccounts}
      onClose={() => navigate(path.to.chartOfAccounts)}
    />
  );
}
