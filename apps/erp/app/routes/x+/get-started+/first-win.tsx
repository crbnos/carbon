import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  currentAnswers,
  type ImplementationRowData,
  parseIntakeRows
} from "@carbon/onboarding";
import {
  getImplementationFieldValues,
  getImplementationRowsByCollection,
  upsertCheckState,
  upsertFieldValue
} from "@carbon/onboarding/server";
import { Button, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowRight,
  LuArrowUpRight,
  LuCircleDollarSign,
  LuFileSpreadsheet,
  LuLoaderCircle,
  LuPartyPopper,
  LuRefreshCw,
  LuSparkles,
  LuTimer,
  LuWrench
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData, useNavigate } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import { buildFirstWinDraft, createFirstWinDraft } from "./first-win.server";

// First Win — right after the intake's payoff, Carbon drafts the customer's
// bread-and-butter product as a REAL part (item + BOM + routing + cost) and the
// customer fixes three things. Everything created is visibly a draft; nothing
// silently commits.

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const [rows, fieldValues] = await Promise.all([
    getImplementationRowsByCollection(client, companyId, "intake"),
    getImplementationFieldValues(client, companyId)
  ]);

  const intake = parseIntakeRows(
    (rows.data ?? []) as unknown as ImplementationRowData[]
  );
  const answers = currentAnswers(intake);

  const draftedItemId =
    fieldValues.data?.find((f) => f.fieldKey === "firstWin.itemId")?.value ??
    null;

  let existing: {
    itemId: string;
    readableId: string;
    partName: string;
    unitCost: number | null;
  } | null = null;

  if (draftedItemId) {
    const [item, cost] = await Promise.all([
      client
        .from("item")
        .select("id, name, readableIdWithRevision")
        .eq("id", draftedItemId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("itemCost")
        .select("unitCost")
        .eq("itemId", draftedItemId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (item.data) {
      existing = {
        itemId: item.data.id,
        readableId: item.data.readableIdWithRevision ?? "",
        partName: item.data.name,
        unitCost: cost.data?.unitCost ?? null
      };
    }
  }

  return {
    product: answers.product ?? null,
    uploadName: answers.uploadName ?? null,
    existing
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  if (formData.get("intent") !== "draft") {
    return data(
      { success: false as const },
      await flash(request, error(null, "Invalid intent"))
    );
  }

  // Idempotency: if a first win was already drafted and the item still exists,
  // return it instead of drafting twice.
  const fieldValues = await getImplementationFieldValues(client, companyId);
  const existingItemId = fieldValues.data?.find(
    (f) => f.fieldKey === "firstWin.itemId"
  )?.value;
  if (existingItemId) {
    const existingItem = await client
      .from("item")
      .select("id, name, readableIdWithRevision")
      .eq("id", existingItemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existingItem.data) {
      return data({
        success: true as const,
        itemId: existingItem.data.id,
        readableId: existingItem.data.readableIdWithRevision ?? "",
        partName: existingItem.data.name,
        skippedRouting: false,
        usedFallback: false
      });
    }
  }

  const rows = await getImplementationRowsByCollection(
    client,
    companyId,
    "intake"
  );
  const answers = currentAnswers(
    parseIntakeRows((rows.data ?? []) as unknown as ImplementationRowData[])
  );

  // The graceful ladder: upload → product text → deterministic shell.
  const { draft, usedFallback } = await buildFirstWinDraft(client, {
    product: answers.product ?? null,
    uploadPath: answers.uploadPath ?? null,
    uploadName: answers.uploadName ?? null
  });

  const created = await createFirstWinDraft(client, {
    companyId,
    userId,
    draft
  });
  if (created.error) {
    return data(
      { success: false as const },
      await flash(
        request,
        error(created.error, "Failed to draft your first part")
      )
    );
  }

  // Remember the draft + mark the First Win step and task done. These are
  // best-effort follow-ups: the part exists either way.
  await upsertFieldValue(client, {
    companyId,
    fieldKey: "firstWin.itemId",
    value: created.data.itemId,
    userId
  });
  await upsertFieldValue(client, {
    companyId,
    fieldKey: "firstWin.readableId",
    value: created.data.readableId,
    userId
  });
  await upsertCheckState(client, {
    companyId,
    itemKey: "prod:intake-first-win",
    kind: "productStep",
    value: "done",
    userId
  });
  await upsertCheckState(client, {
    companyId,
    itemKey: "task:intake-first-win",
    kind: "task",
    value: "done",
    userId
  });

  return data({
    success: true as const,
    itemId: created.data.itemId,
    readableId: created.data.readableId,
    partName: created.data.partName,
    skippedRouting: created.data.skippedRouting,
    usedFallback
  });
}

export default function FirstWinRoute() {
  const { t } = useLingui();
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const currencyFormatter = useCurrencyFormatter();

  const draftFetcher = useFetcher<typeof action>();
  const recalcFetcher = useFetcher<{ success: boolean; message: string }>();

  const isDrafting = draftFetcher.state !== "idle";
  const freshDraft =
    draftFetcher.data?.success === true ? draftFetcher.data : null;

  // The loader is the source of truth once the draft exists (revalidation after
  // the action refreshes it); the fetcher result covers the instant in between.
  const part = loaderData.existing
    ? loaderData.existing
    : freshDraft
      ? {
          itemId: freshDraft.itemId,
          readableId: freshDraft.readableId,
          partName: freshDraft.partName,
          unitCost: null
        }
      : null;

  // Fire the cost roll-up once after a fresh draft; revalidation then shows the
  // live unit cost from the loader.
  const recalcFiredRef = useRef(false);
  useEffect(() => {
    if (freshDraft && !recalcFiredRef.current) {
      recalcFiredRef.current = true;
      recalcFetcher.submit(null, {
        method: "post",
        action: path.to.api.itemCostRecalculate(freshDraft.itemId)
      });
    }
  }, [freshDraft, recalcFetcher]);

  // Staged progress copy while the draft is in flight.
  const stages = useMemo(
    () =>
      loaderData.uploadName
        ? [t`Reading your file…`, t`Drafting your part…`, t`Costing it…`]
        : [t`Drafting your part…`, t`Costing it…`],
    [loaderData.uploadName, t]
  );
  const [stageIndex, setStageIndex] = useState(0);
  useEffect(() => {
    if (!isDrafting) {
      setStageIndex(0);
      return;
    }
    const interval = setInterval(
      () => setStageIndex((i) => Math.min(i + 1, stages.length - 1)),
      3000
    );
    return () => clearInterval(interval);
  }, [isDrafting, stages.length]);

  const isRecalculating = recalcFetcher.state !== "idle";

  // -------------------------------------------------------------------------
  // State: done — the draft exists.
  // -------------------------------------------------------------------------
  if (part) {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-8 py-10">
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <LuPartyPopper className="size-3.5" />
            <Trans>First win</Trans>
          </div>
          <h1 className="text-3xl font-semibold">
            <Trans>That's a real part — in your Carbon</Trans>
          </h1>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Item, bill of materials, and a cost roll-up. It's our draft of
              your part — fix what's wrong, and it becomes yours.
            </Trans>
          </p>
        </div>

        {/* The part card */}
        <div className="rounded-xl border bg-card px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{part.partName}</div>
              <a
                href={path.to.part(part.itemId)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                {part.readableId}
                <LuArrowUpRight className="size-3.5" />
              </a>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                <Trans>Unit cost</Trans>
              </div>
              <div className="text-xl font-semibold tabular-nums flex items-center gap-2 justify-end">
                {isRecalculating ? (
                  <LuLoaderCircle className="size-4 animate-spin text-muted-foreground" />
                ) : null}
                {typeof part.unitCost === "number"
                  ? currencyFormatter.format(part.unitCost)
                  : "—"}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            <Trans>
              This number is only as right as the draft below it — that's why
              you fix three things.
            </Trans>
          </p>
        </div>

        {freshDraft?.usedFallback ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm text-muted-foreground">
            <Trans>
              We couldn't reach the AI drafter, so we set up a simple shell
              instead — every line is a placeholder to replace with the real
              thing.
            </Trans>
          </div>
        ) : null}
        {freshDraft?.skippedRouting ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm text-muted-foreground">
            <Trans>
              We skipped the routing for now — your factory has no location or
              work center yet. Set those up in Set Up the Basics and the routing
              takes a minute.
            </Trans>
          </div>
        ) : null}

        {/* Fix three things */}
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            <Trans>Fix three things</Trans>
          </h2>
          <FixCard
            icon={<LuWrench className="size-4" />}
            title={t`Is this the right material?`}
            detail={t`Open the bill of materials and swap any draft line for what you actually use.`}
            href={path.to.partDetails(part.itemId)}
          />
          <FixCard
            icon={<LuTimer className="size-4" />}
            title={t`Are the minutes roughly right?`}
            detail={t`Check the routing steps — rough is fine, the cost follows the minutes.`}
            href={path.to.partDetails(part.itemId)}
          />
          <FixCard
            icon={<LuCircleDollarSign className="size-4" />}
            title={t`Is that the price?`}
            detail={t`Open costing and make sure the numbers match how you actually sell it.`}
            href={path.to.partCosting(part.itemId)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="lg"
            rightIcon={<LuArrowRight />}
            onClick={() => navigate(path.to.getStartedPage("plan"))}
          >
            <Trans>Continue to your plan</Trans>
          </Button>
          <Button
            variant="secondary"
            leftIcon={
              isRecalculating ? (
                <LuLoaderCircle className="animate-spin" />
              ) : (
                <LuRefreshCw />
              )
            }
            isDisabled={isRecalculating}
            onClick={() =>
              recalcFetcher.submit(null, {
                method: "post",
                action: path.to.api.itemCostRecalculate(part.itemId)
              })
            }
          >
            <Trans>Recalculate cost</Trans>
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State: drafting — staged progress while the action runs.
  // -------------------------------------------------------------------------
  if (isDrafting) {
    return (
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6 py-24 text-center">
        <LuLoaderCircle className="size-8 animate-spin text-primary" />
        <div className="flex flex-col gap-1">
          <div className="text-lg font-medium">{stages[stageIndex]}</div>
          <p className="text-sm text-muted-foreground">
            <Trans>This usually takes under a minute.</Trans>
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State: intro.
  // -------------------------------------------------------------------------
  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          <Trans>First win</Trans>
        </div>
        <h1 className="text-3xl font-semibold">
          <Trans>Your first part in Carbon</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Let's start with your bread and butter — a product you make all the
            time. Carbon drafts it as a real part: the item, its bill of
            materials, a simple routing, and a cost.
          </Trans>
        </p>
      </div>

      {loaderData.product ? (
        <div className="rounded-xl border bg-card px-5 py-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            <Trans>From your intake</Trans>
          </div>
          {loaderData.product}
        </div>
      ) : null}

      {loaderData.uploadName ? (
        <div
          className={cn(
            "rounded-xl border bg-card px-5 py-3 text-sm",
            "flex items-center gap-2 text-muted-foreground"
          )}
        >
          <LuFileSpreadsheet className="size-4 shrink-0" />
          <Trans>
            We'll read{" "}
            <span className="font-medium text-foreground">
              {loaderData.uploadName}
            </span>{" "}
            and pick one representative product from it.
          </Trans>
        </div>
      ) : null}

      {draftFetcher.data?.success === false ? (
        <p className="text-sm text-destructive">
          <Trans>That didn't work — give it another try.</Trans>
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <draftFetcher.Form method="post">
          <input type="hidden" name="intent" value="draft" />
          <Button size="lg" type="submit" leftIcon={<LuSparkles />}>
            <Trans>Draft my part</Trans>
          </Button>
        </draftFetcher.Form>
        <p className="text-xs text-muted-foreground">
          <Trans>
            Carbon drafts it and you correct it. Every line is clearly marked as
            a draft — nothing commits until you say so.
          </Trans>
        </p>
      </div>
    </div>
  );
}

function FixCard({
  icon,
  title,
  detail,
  href
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group rounded-xl border bg-card px-5 py-4 flex items-start gap-3 hover:border-primary transition-colors"
    >
      <span className="mt-0.5 text-muted-foreground group-hover:text-primary transition-colors">
        {icon}
      </span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium flex items-center gap-1.5">
          {title}
          <LuArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
        </span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </span>
    </a>
  );
}
