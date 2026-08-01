import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  recurringJournalTemplateValidator,
  upsertRecurringJournalTemplate
} from "~/modules/accounting";
import { RecurringJournalForm } from "~/modules/accounting/ui/RecurringJournals";
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
  const validation = await validator(
    recurringJournalTemplateValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: strip id for insert branch
  const { id, ...rest } = validation.data;

  const insert = await upsertRecurringJournalTemplate(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return data(
      {},
      await flash(
        request,
        error(insert.error, "Failed to create recurring journal")
      )
    );
  }

  throw redirect(
    `${path.to.recurringJournals}?${getParams(request)}`,
    await flash(request, success("Created recurring journal"))
  );
}

export default function NewRecurringJournalRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: "",
    frequency: "Monthly" as const,
    nextRunDate: "",
    endDate: "",
    active: true,
    lines: []
  };

  return (
    <RecurringJournalForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
