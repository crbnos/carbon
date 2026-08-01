import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deactivateRecurringJournalTemplate,
  getRecurringJournalTemplate
} from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { recurringJournalId } = params;
  if (!recurringJournalId) throw notFound("recurringJournalId not found");

  const template = await getRecurringJournalTemplate(
    client,
    recurringJournalId
  );
  if (template.error) {
    throw redirect(
      `${path.to.recurringJournals}?${getParams(request)}`,
      await flash(
        request,
        error(template.error, "Failed to get recurring journal")
      )
    );
  }

  return { template: template.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { recurringJournalId } = params;
  if (!recurringJournalId) {
    throw redirect(
      `${path.to.recurringJournals}?${getParams(request)}`,
      await flash(
        request,
        error(params, "Failed to get a recurring journal id")
      )
    );
  }

  const deactivate = await deactivateRecurringJournalTemplate(client, {
    id: recurringJournalId,
    updatedBy: userId
  });
  if (deactivate.error) {
    throw redirect(
      `${path.to.recurringJournals}?${getParams(request)}`,
      await flash(
        request,
        error(deactivate.error, "Failed to deactivate recurring journal")
      )
    );
  }

  throw redirect(
    `${path.to.recurringJournals}?${getParams(request)}`,
    await flash(request, success("Successfully deactivated recurring journal"))
  );
}

export default function DeactivateRecurringJournalRoute() {
  const { recurringJournalId } = useParams();
  const { template } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!recurringJournalId || !template) return null;

  const onCancel = () => navigate(path.to.recurringJournals);

  return (
    <ConfirmDelete
      action={path.to.recurringJournalDelete(recurringJournalId)}
      name={template.name}
      deleteText={t`Deactivate`}
      text={t`Are you sure you want to deactivate the recurring journal: ${template.name}? It will stop generating new journals.`}
      onCancel={onCancel}
    />
  );
}
