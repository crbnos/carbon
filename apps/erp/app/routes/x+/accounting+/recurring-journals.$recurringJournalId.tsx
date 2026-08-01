import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getRecurringJournalTemplate,
  recurringJournalTemplateValidator,
  upsertRecurringJournalTemplate
} from "~/modules/accounting";
import { RecurringJournalForm } from "~/modules/accounting/ui/RecurringJournals";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { recurringJournalId } = params;
  if (!recurringJournalId) throw notFound("recurringJournalId not found");

  const template = await getRecurringJournalTemplate(
    client,
    recurringJournalId
  );

  return {
    template: template?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(
    recurringJournalTemplateValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertRecurringJournalTemplate(client, {
    id,
    ...rest,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update recurring journal")
      )
    );
  }

  throw redirect(
    `${path.to.recurringJournals}?${getParams(request)}`,
    await flash(request, success("Updated recurring journal"))
  );
}

export default function EditRecurringJournalRoute() {
  const { template } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: template?.id ?? undefined,
    name: template?.name ?? "",
    description: template?.description ?? "",
    frequency: (template?.frequency ?? "Monthly") as
      | "Monthly"
      | "Quarterly"
      | "Annually",
    nextRunDate: template?.nextRunDate ?? "",
    endDate: template?.endDate ?? "",
    active: template?.active ?? true,
    lines: (template?.recurringJournalTemplateLine ?? [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((line) => ({
        id: line.id,
        accountId: line.accountId,
        description: line.description ?? "",
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        sortOrder: line.sortOrder ?? 0
      }))
  };

  return (
    <RecurringJournalForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
