import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { JournalEntry } from "~/modules/accounting";
import {
  postJournalEntry,
  saveJournalEntryWithLines
} from "~/modules/accounting";
import { JournalEntryForm } from "~/modules/accounting/ui/JournalEntries";
import type {
  DimensionWithValues,
  JournalLineDimensionValue
} from "~/modules/accounting/ui/JournalEntries/types";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId, companyGroupId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const postingDate = formData.get("postingDate") as string;
  const description = formData.get("description") as string;
  const linesJson = formData.get("lines") as string;

  if (!postingDate) {
    return data(
      {},
      await flash(request, error(null, "Posting date is required"))
    );
  }

  let lines: Array<{
    accountId: string;
    description?: string;
    debit: number;
    credit: number;
    dimensions?: Array<{ dimensionId: string; valueId: string }>;
  }>;

  try {
    lines = JSON.parse(linesJson);
  } catch {
    return data({}, await flash(request, error(null, "Invalid lines data")));
  }

  // Validate lines
  for (const line of lines) {
    if (!line.accountId) {
      return data(
        {},
        await flash(request, error(null, "Each line must have an account"))
      );
    }
    if (
      (line.debit <= 0 && line.credit <= 0) ||
      (line.debit > 0 && line.credit > 0)
    ) {
      return data(
        {},
        await flash(
          request,
          error(null, "Each line must have either a debit or credit amount")
        )
      );
    }
  }

  const saveResult = await saveJournalEntryWithLines(client, {
    journalEntryId,
    postingDate,
    description,
    updatedBy: userId,
    lines,
    companyId,
    companyGroupId
  });

  if (saveResult.error) {
    return data(
      {},
      await flash(
        request,
        error(saveResult.error, "Failed to save journal entry")
      )
    );
  }

  if (intent === "post") {
    const postResult = await postJournalEntry(client, journalEntryId, userId);
    if (postResult.error) {
      return data(
        {},
        await flash(
          request,
          error(postResult.error, "Failed to post journal entry")
        )
      );
    }

    throw redirect(
      path.to.journalEntryDetails(journalEntryId),
      await flash(request, success("Journal entry posted"))
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Journal entry saved"))
  );
}

export default function JournalEntryDetailsRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
    companies: { id: string; name: string }[];
    dimensions: DimensionWithValues[];
    lineDimensions: Record<string, JournalLineDimensionValue[]>;
    sourceDocument: { readableId: string; to: string } | null;
  }>(path.to.journalEntry(journalEntryId));

  if (!routeData?.journalEntry)
    throw new Error("Could not find journal entry in routeData");

  const isPosted = routeData.journalEntry.status !== "Draft";

  const initialLines = (routeData.journalEntry.journalLine ?? []).map(
    (line) => {
      const amount = Number(line.amount);
      const accountClass = line.account?.class ?? "Asset";
      return {
        id: line.id,
        accountId: line.accountId ?? "",
        description: line.description ?? "",
        debit: toDisplayDebit(amount, accountClass) || null,
        credit: toDisplayCredit(amount, accountClass) || null,
        dimensions: [] as JournalLineDimensionValue[]
      };
    }
  );

  return (
    <JournalEntryForm
      key={routeData.journalEntry.id}
      journalEntryId={journalEntryId}
      displayId={routeData.journalEntry.journalEntryId}
      status={routeData.journalEntry.status}
      sourceType={routeData.journalEntry.sourceType ?? "Manual"}
      sourceDocument={routeData.sourceDocument ?? null}
      reversedById={routeData.journalEntry.reversedById}
      initialValues={{
        id: routeData.journalEntry.id,
        companyId: routeData.journalEntry.companyId,
        sourceType: routeData.journalEntry.sourceType ?? "Manual",
        postingDate: routeData.journalEntry.postingDate,
        description: routeData.journalEntry.description ?? ""
      }}
      initialLines={initialLines}
      companies={routeData.companies ?? []}
      dimensions={routeData.dimensions ?? []}
      lineDimensions={routeData.lineDimensions ?? {}}
      isDisabled={isPosted}
    />
  );
}
