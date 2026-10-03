// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import type { ClientDocumentLine } from "~/components/DocumentLineEditor";
import { useRouteData } from "~/hooks";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";
import {
  getReimbursement,
  isReimbursementLocked,
  ReimbursementEditForm,
  reimbursementLinesValidator,
  reimbursementUpdateValidator,
  updateReimbursement,
  upsertReimbursementLines
} from "~/modules/invoicing";
import {
  linesBalanceHeader,
  postReimbursement,
  REIMBURSEMENT_UNBALANCED_MESSAGE
} from "~/modules/invoicing/reimbursement.server";
import type { loader as reimbursementLoader } from "~/routes/x+/reimbursements+/$reimbursementId";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

/**
 * The document and its dimensions come from the page loader
 * (`$reimbursementId.tsx`), which runs on /edit too. This loader exists for the
 * two server-side gates: the update permission and the Draft-only lock, so it
 * reads nothing but the status.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { reimbursementId } = params;
  if (!reimbursementId) throw new Error("Could not find reimbursementId");

  const reimbursement = await client
    .from("reimbursement")
    .select("status")
    .eq("id", reimbursementId)
    .eq("companyId", companyId)
    .single();

  if (reimbursement.error || !reimbursement.data) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(reimbursement.error, "Failed to load reimbursement")
      )
    );
  }

  // This is what makes "a Posted reimbursement is not editable" true for a
  // direct URL, not just a hidden button. The RLS policy and the
  // reimbursement_draft_guard trigger are the backstops behind it.
  await requireUnlocked({
    request,
    isLocked: isReimbursementLocked(reimbursement.data.status),
    redirectTo: path.to.reimbursement(reimbursementId),
    message: "A posted reimbursement cannot be edited"
  });

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { reimbursementId } = params;
  if (!reimbursementId) throw new Error("Could not find reimbursementId");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const validation = await validator(reimbursementUpdateValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  // Hard-guard the status before any write: a readable message beats the raw
  // 55000 the reimbursement_draft_guard trigger would raise.
  const existing = await getReimbursement(client, companyId, reimbursementId);
  if (existing.error || !existing.data) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(existing.error, "Failed to load reimbursement")
      )
    );
  }
  if (existing.data.status !== "Draft") {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(
        request,
        error(null, "A posted reimbursement cannot be edited")
      )
    );
  }

  let parsedLines: unknown;
  try {
    parsedLines = JSON.parse(formData.get("lines") as string);
  } catch {
    return data({}, await flash(request, error(null, "Invalid lines data")));
  }

  const lines = reimbursementLinesValidator.safeParse(parsedLines);
  if (!lines.success) {
    return data(
      {},
      await flash(
        request,
        error(
          lines.error,
          lines.error.issues[0]?.message ?? "Invalid lines data"
        )
      )
    );
  }

  // The totals guard, BEFORE any server-function call.
  const willPost = intent === "save-and-post";
  if (
    willPost &&
    !linesBalanceHeader(
      validation.data.amount,
      lines.data.map((line) => line.amount)
    )
  ) {
    throw redirect(
      path.to.reimbursementEdit(reimbursementId),
      await flash(request, error(null, REIMBURSEMENT_UNBALANCED_MESSAGE))
    );
  }

  const update = await updateReimbursement(client, {
    ...validation.data,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update reimbursement")
      )
    );
  }

  try {
    // The Kysely client is built HERE and passed in — a route may import a
    // `.server` module, a `*.service.ts` may not (`no-db-client-in-service`).
    await upsertReimbursementLines(getDatabaseClient(), {
      reimbursementId,
      companyId,
      createdBy: userId,
      lines: lines.data
    });
  } catch (err) {
    return data(
      {},
      await flash(
        request,
        error(err, (err as Error).message ?? "Failed to save coding lines")
      )
    );
  }

  if (willPost) {
    const result = await postReimbursement({
      reimbursementId,
      companyId,
      userId
    });
    if (result.error) {
      throw redirect(
        path.to.reimbursement(reimbursementId),
        await flash(request, error(null, result.error))
      );
    }
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, success("Reimbursement posted"))
    );
  }

  throw redirect(
    path.to.reimbursement(reimbursementId),
    await flash(request, success("Reimbursement updated"))
  );
}

function generateKey() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Hydrates the editor's client lines from the stored rows, joining the embedded
 * `reimbursementLineDimension` pairs against the configured dimension list so
 * the badges have names to render. The two legacy columns ride along untouched.
 */
function toClientLines(
  lines: {
    id: string;
    accountId: string;
    description: string | null;
    amount: number;
    sequence: number;
    costCenterId: string | null;
    projectId: string | null;
    reimbursementLineDimension?:
      | { dimensionId: string; valueId: string }[]
      | null;
  }[],
  dimensions: DimensionWithValues[]
): ClientDocumentLine[] {
  return [...lines]
    .sort((a, b) => a.sequence - b.sequence)
    .map((line) => ({
      key: generateKey(),
      id: line.id,
      accountId: line.accountId,
      description: line.description ?? "",
      amount: Number(line.amount),
      costCenterId: line.costCenterId,
      projectId: line.projectId,
      // Every stored pair is kept, INCLUDING one whose dimension is no longer
      // active. `upsertReimbursementLines` replaces the lines wholesale — it
      // deletes them and reinserts only what the editor submitted — so dropping
      // an unresolvable pair here meant a plain Save silently erased coding the
      // user was never shown. The ids are all the server needs; the names are
      // only for rendering, so fall back to the raw ids.
      dimensions: (line.reimbursementLineDimension ?? []).map((pair) => {
        const dimension = dimensions.find(
          (d) => d.dimensionId === pair.dimensionId
        );
        const value = dimension?.values.find((v) => v.id === pair.valueId);
        return {
          dimensionId: pair.dimensionId,
          dimensionName: dimension?.dimensionName ?? pair.dimensionId,
          valueId: pair.valueId,
          valueName: value?.name ?? pair.valueId
        };
      })
    }));
}

export default function ReimbursementEditRoute() {
  const { reimbursementId } = useParams();
  if (!reimbursementId) throw new Error("Could not find reimbursementId");

  const routeData = useRouteData<
    Awaited<ReturnType<typeof reimbursementLoader>>
  >(path.to.reimbursement(reimbursementId));
  if (!routeData?.reimbursement) {
    throw new Error("Could not find reimbursement in routeData");
  }
  const { reimbursement, dimensions } = routeData;

  const initialLines = toClientLines(
    reimbursement.reimbursementLine ?? [],
    dimensions
  );

  return (
    <ReimbursementEditForm
      key={reimbursement.id}
      reimbursementId={reimbursement.id}
      initialValues={{
        id: reimbursement.id,
        reimbursementDate: reimbursement.reimbursementDate,
        currencyCode: reimbursement.currencyCode,
        exchangeRate: reimbursement.exchangeRate,
        amount: reimbursement.amount,
        reference: reimbursement.reference ?? undefined,
        notes: reimbursement.notes ?? undefined
      }}
      initialLines={initialLines}
      dimensions={dimensions}
    />
  );
}
