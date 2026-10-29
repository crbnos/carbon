// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { z } from "zod";
import { useRouteData } from "~/hooks";
import { journalEntryValidator } from "~/modules/accounting/accounting.models";
import type { JournalEntry } from "~/modules/accounting/types";
import { JournalEntryForm } from "~/modules/accounting/ui/JournalEntries";
import type {
  DimensionWithValues,
  JournalLineDimensionValue
} from "~/modules/accounting/ui/JournalEntries/types";
import { path } from "~/utils/path";

// The lines ride as one JSON field; the operation checks each of them.
const form = journalEntryValidator.extend({
  intent: z.enum(["save", "post"]).optional(),
  lines: z.string().transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid lines data" });
      return z.NEVER;
    }
  })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, {
    params: ["journalEntryId"]
  });
  if ("invalid" in input) return input.invalid;
  const { journalEntryId } = input.params;
  const { intent, postingDate, description, lines } = input.data;
  const api = await carbon(args.request);
  const result = await api.accounting.saveJournalEntry({
    journalEntryId,
    postingDate,
    description,
    lines: lines as never,
    post: intent === "post"
  });
  return respond(args.request, result).redirect(
    path.to.journalEntryDetails(journalEntryId),
    {
      message: result.data?.posted
        ? "Journal entry posted"
        : "Journal entry saved"
    }
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
      // Re-mount after every save (the save bumps updatedAt): lines added in
      // the form carry client ids until the loader returns their stored ones.
      key={`${routeData.journalEntry.id}:${routeData.journalEntry.updatedAt ?? ""}`}
      journalEntryId={journalEntryId}
      status={routeData.journalEntry.status}
      sourceType={routeData.journalEntry.sourceType ?? "Manual"}
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
