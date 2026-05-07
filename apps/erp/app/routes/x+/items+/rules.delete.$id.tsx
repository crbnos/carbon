import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteItemRule, getItemRule } from "~/modules/items";
import { path } from "~/utils/path";
import { requirePlan } from "~/utils/planGate.server";
import { getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "parts" });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const { client } = await requirePermissions(request, { view: "parts" });
  const rule = await getItemRule(client, id);
  if (rule.error) {
    throw redirect(
      path.to.itemRules,
      await flash(request, error(rule.error, "Failed to load rule"))
    );
  }
  return { rule: rule.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  await requirePlan({
    request,
    client,
    companyId,
    redirectTo: path.to.itemRules
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.itemRules,
      await flash(request, error(params, "Failed to find rule id"))
    );
  }

  const result = await deleteItemRule(client, id);
  if (result.error) {
    throw redirect(
      path.to.itemRules,
      await flash(request, error(result.error, "Failed to delete rule"))
    );
  }

  throw redirect(
    path.to.itemRules,
    await flash(request, success("Rule deleted"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey as string[];
      return key[0] === "itemRules" && key[1] === companyId;
    }
  });
  return await serverAction();
}

export default function DeleteItemRuleRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  if (!rule) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteItemRule(id)}
      name={rule.name}
      text={`Delete rule "${rule.name}"? Any items currently bound to it will become unassigned. This cannot be undone.`}
      onCancel={() => navigate(-1)}
    />
  );
}
