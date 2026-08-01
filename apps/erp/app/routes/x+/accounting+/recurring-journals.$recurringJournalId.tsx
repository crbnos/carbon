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
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { recurringJournalId } = params;
  if (!recurringJournalId) throw notFound("recurringJournalId not found");

  const template = await getRecurringJournalTemplate(
    client,
    recurringJournalId,
    companyId
  );
  // Surface the failure / missing record instead of collapsing it to null —
  // otherwise the form silently switches to create mode and duplicates.
  if (template.error || !template.data) {
    throw redirect(
      `${path.to.recurringJournals}?${getParams(request)}`,
      await flash(
        request,
        error(template.error, "Failed to get recurring journal")
      )
    );
  }

  return {
    template: template.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { recurringJournalId } = params;
  if (!recurringJournalId) throw notFound("recurringJournalId not found");

  const formData = await request.formData();
  const validation = await validator(
    recurringJournalTemplateValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;
  // The record identity is the route segment, never the client-controlled body
  // id — reject a mismatch so a POST to /…/A cannot update template B.
  if (id && id !== recurringJournalId) {
    return data(
      {},
      await flash(
        request,
        error(
          { id, recurringJournalId },
          "Recurring journal id does not match the route"
        )
      )
    );
  }

  const update = await upsertRecurringJournalTemplate(client, {
    id: recurringJournalId,
    ...rest,
    companyId,
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
