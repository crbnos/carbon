import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  HStack,
  Skeleton,
  Spinner,
  Status,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronRight,
  LuCircleCheck,
  LuCircleDashed,
  LuInfo,
  LuRefreshCw,
  LuTriangleAlert
} from "react-icons/lu";
import { bomParentIndexes, buildBomViewTree, visibleBomRows } from "./bom-view";
import type { OnshapePanelContext } from "./messages";
import { isPanelSessionMessage, postApplicationInit } from "./messages";
import type {
  AssemblyPlan,
  AssemblyPlanDepth,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan,
  ReleasePlanItem
} from "./plan";
import type { PlanCustomField } from "./properties";
import type { PanelRelease } from "./releases";
import type {
  ApplyFieldError,
  AssemblyReview,
  MethodDescription,
  PartApplyResult,
  PartReview,
  ReleaseReview,
  ReviewState
} from "./review";
import {
  applyCount,
  applyRequestBody,
  createReview,
  customFieldDisplayValue,
  describeMethod,
  indexFieldErrors,
  normalizeWarnings,
  patchPartStatuses
} from "./review";
import {
  clearPanelSessionToken,
  getPanelSessionToken,
  PanelUnauthorizedError,
  panelFetch,
  setPanelSessionToken
} from "./session-storage";
import type { PanelPartStatus } from "./status";

export type PanelAssemblyLine = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  purchased: boolean;
  state: "linked" | "matched" | "missing";
  itemId: string | null;
  lastSyncedAt: string | null;
};

export type PanelAssemblyStatus = {
  root: {
    partNumber: string | null;
    name: string | null;
    /**
     * Onshape's element metadata could not be read, so a null part number
     * says nothing about the assembly itself. Optional so an older status
     * response still type-checks.
     */
    identityUnavailable?: boolean;
    state: "linked" | "matched" | "missing";
    itemId: string | null;
    lastSyncedAt: string | null;
  };
  lines: PanelAssemblyLine[];
};

/*
 * `refreshing` is what separates a re-read from a first read. A refresh keeps
 * the rows it already has on screen and says so on the Refresh button, so
 * nothing moves: the section keeps its title, its buttons stay where the
 * cursor left them, and the list does not collapse and reflow. Only a first
 * read has nothing to show, and that is the one case that draws a skeleton.
 */
/**
 * Why a read failed. `forbidden` is the one failure a Retry cannot fix and the
 * one that is not an error in anything: it renders as a warning naming the
 * permission problem, with no Retry to press.
 */
type LoadFailure = { message: string; forbidden: boolean };

/*
 * `refreshFailure` is a Refresh that failed while rows were already on screen.
 * The rows stay: a transient blip used to replace a hundred-row BOM with an
 * error, destroying exactly the thing the user was reading.
 */
type PanelStatusState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      rows: PanelPartStatus[];
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
    }
  | {
      status: "ready-assembly";
      assembly: PanelAssemblyStatus;
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
    }
  | {
      status: "ready-other";
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
    }
  | { status: "error"; message: string; forbidden?: boolean };

type PanelReleasesState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      releases: PanelRelease[];
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
    }
  | { status: "error"; message: string; forbidden?: boolean };

/**
 * The panel's pages. `push` is the current element — an assembly or a part
 * studio; `releases` is the whole document, which is why it survives on an
 * element that has nothing to push.
 */
type PanelTab = "push" | "releases";

export type OnshapePanelPaths = {
  /** Popup route that mints a panel session for the signed-in user. */
  auth: string;
  /** Returns who the token belongs to. */
  me: string;
  /** DELETE revokes the token. */
  session: string;
  /** Carbon status for the current element's parts. */
  status: string;
  /** POST: plan a part push — what would happen, nothing written. */
  planPart: string;
  /** POST: plan an assembly push (items + BOM line diff), nothing written. */
  planAssembly: string;
  /** POST: plan a release push (revisions, change notice), nothing written. */
  planRelease: string;
  /** POST: apply a part plan (planId + edits + selection). */
  pushPart: string;
  /** POST: push the current assembly (items + BOM) into Carbon. */
  pushAssembly: string;
  /** Releases for the current document, grouped from Onshape revisions. */
  releases: string;
  /** POST: push one release (revisions, assets, BOMs, change notice). */
  pushRelease: string;
};

export type OnshapePanelMe = {
  userId: string;
  email: string;
  company: { id: string; name: string } | null;
};

type SessionState =
  | { status: "unknown" }
  /**
   * `popupBlocked`: the browser refused the sign-in window. That is still the
   * signed-out state — the way forward is the same button — not a Carbon
   * error; it used to render as "Carbon is not reachable" with a Retry that
   * did nothing, since there was no token to retry with.
   */
  | { status: "signed-out"; popupBlocked?: boolean }
  | { status: "loading"; token: string }
  | { status: "signed-in"; token: string; me: OnshapePanelMe }
  | { status: "error"; token: string | null; message: string };

/** What a plan route returns: the stored plan's handle and the plan itself. */
type PlanResponse<P> = {
  planId: string;
  expiresAt: string;
  plan: P;
  /** plan-release only: assemblies whose BOM could not be read. */
  warnings?: unknown;
};

/** Every panel error body is `{ error }`; a 422 apply adds per-row errors. */
type PanelErrorResponse = {
  error: string;
  fieldErrors?: ApplyFieldError[];
  /** A machine-readable refusal the panel answers with an action, not just text. */
  code?: "too-large";
};

type AssemblyPushSummary = {
  itemsCreated: number;
  itemsReused: number;
  linesWritten: number;
  /** Lines already correct; absent on a response from before they were counted. */
  linesUnchanged?: number;
  methodsTouched: number;
  /** Released methods this push superseded with a Draft version. */
  draftVersionsCreated?: string[];
  skipped: string[];
  errors: string[];
};

type ReleasePushSummary = {
  releaseName: string | null;
  revisionsCreated: number;
  itemsCreated: number;
  reused: number;
  linesWritten: number;
  methodsTouched: number;
  defaultsUpdated: number;
  changeNotice: string | null;
  alreadyPushed: boolean;
  skipped: string[];
  errors: string[];
};

/**
 * What happened to one part, with its severity carried alongside the words.
 *
 * It used to be a bare string rendered in muted grey whatever it said, so
 * "Created" and "Item saved but the Onshape link failed; push again" looked
 * identical. The assembly and release pushes had already been moved off that
 * shape; the part push had not.
 */
type PartRowOutcome = { kind: "ok" | "skipped" | "error"; text: string };

function partOutcome(result: PartApplyResult): PartRowOutcome {
  switch (result.action) {
    case "created":
      return { kind: "ok", text: "Created" };
    case "adopted":
      return { kind: "ok", text: "Linked" };
    case "updated":
      return { kind: "ok", text: "Updated" };
    case "unchanged":
      return { kind: "ok", text: "Up to date" };
    case "skipped":
      return { kind: "skipped", text: "Skipped" };
    default:
      // The full message goes in the section's alert; the row only has to
      // say that this is the one that failed.
      return { kind: "error", text: "Failed" };
  }
}

/** The section-level summary of a part push, in the shape the others use. */
function partsOutcomeText(
  results: PartApplyResult[],
  rows: Array<{ partId: string; partNumber: string | null }>,
  warnings: string[]
): PushOutcome {
  const label = (r: PartApplyResult) =>
    rows.find((row) => row.partId === r.partId)?.partNumber ??
    r.readableId ??
    r.partId;
  const count = (action: PartApplyResult["action"]) =>
    results.filter((r) => r.action === action).length;
  const parts = [
    [count("created"), "created"],
    [count("adopted"), "linked"],
    [count("updated"), "updated"],
    [count("unchanged"), "already up to date"]
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, what]) => `${n} ${what}`);
  return {
    text: parts.length > 0 ? `Parts: ${parts.join(", ")}` : "",
    skipped: results
      .filter((r) => r.action === "skipped")
      .map((r) => `${label(r)}: ${r.message ?? "skipped"}`),
    errors: results
      .filter((r) => r.action === "error")
      .map((r) => `${label(r)}: ${r.message ?? "failed"}`),
    warnings
  };
}

/**
 * What a push did. `text` is the counts, `skipped` the deliberate omissions,
 * `errors` the things that did not go through. They are kept apart because a
 * joined string renders a partial failure exactly like a clean push — the
 * unlinked-item case reported success in muted grey for a whole release.
 */
type PushOutcome = {
  text: string;
  skipped: string[];
  errors: string[];
  /**
   * Went through, but something about it needs checking — e.g. a value that
   * landed in a List custom field whose option could not be added.
   */
  warnings?: string[];
  /**
   * Things that went through but the user has to know about — a released
   * method superseded by a Draft version, which takes effect only once
   * somebody releases it. Not an error, and too consequential to bury in the
   * counts.
   */
  notes?: string[];
};

function assemblyOutcomeText(s: AssemblyPushSummary): PushOutcome {
  const unchanged = s.linesUnchanged ?? 0;
  // A push that changed nothing should say so. "0 BOM lines" reads as a
  // failure; "42 already up to date" reads as the no-op it was.
  const lines =
    s.linesWritten === 0 && unchanged > 0
      ? `${unchanged} BOM lines already up to date`
      : `${s.linesWritten} BOM lines` +
        (unchanged > 0 ? ` (${unchanged} unchanged)` : "");
  const text =
    `${s.itemsCreated} items created, ${s.itemsReused} reused, ` +
    `${lines} across ${s.methodsTouched} methods`;
  const drafts = s.draftVersionsCreated ?? [];
  return {
    text,
    skipped: s.skipped,
    errors: s.errors,
    notes:
      drafts.length > 0
        ? [`New Draft version, not yet live: ${drafts.join(", ")}`]
        : []
  };
}

function releaseOutcomeText(s: ReleasePushSummary): PushOutcome {
  // Skipped items are not appended to this line: it becomes the title of a
  // success alert, and "PN-77: drawing has no matching model item" read as a
  // clause of the success. They render as their own warning.
  const text = s.alreadyPushed
    ? "Revisions already in Carbon — BOMs refreshed"
    : `${s.revisionsCreated} revisions + ${s.itemsCreated} new items, ` +
      `${s.linesWritten} BOM lines` +
      (s.changeNotice ? ` · change notice ${s.changeNotice}` : "");
  return { text, skipped: s.skipped, errors: s.errors };
}

/**
 * The counts, then anything that failed. Errors are an alert rather than a
 * clause on the end of the success line: a push that created items but could
 * not link them to Onshape is repairable, and only if the user notices.
 */
function failedOutcome(message: string): PushOutcome {
  return { text: "", skipped: [], errors: [message] };
}

/**
 * A push that finished is as much news as a push that failed, so it gets the
 * same weight: the counts used to render as muted grey text beside a
 * destructive alert, which made a clean run the quietest thing on screen.
 * Success and information are Alert variants the component already has.
 */
function PushOutcomeView({ outcome }: { outcome: PushOutcome }) {
  const failed = outcome.errors.length > 0;
  return (
    <>
      {outcome.text ? (
        failed ? (
          <p className="text-xs text-muted-foreground w-full">{outcome.text}</p>
        ) : (
          <Alert variant="success">
            <LuCircleCheck />
            <AlertTitle>{outcome.text}</AlertTitle>
          </Alert>
        )
      ) : null}
      {(outcome.notes ?? []).length > 0 ? (
        <Alert variant="info">
          <LuInfo />
          <AlertTitle>Nothing live changed</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {(outcome.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {outcome.skipped.length > 0 ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            {outcome.skipped.length === 1
              ? "1 thing was skipped"
              : `${outcome.skipped.length} things were skipped`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {outcome.skipped.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {(outcome.warnings ?? []).length > 0 ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            {(outcome.warnings ?? []).length === 1
              ? "1 thing to check"
              : `${(outcome.warnings ?? []).length} things to check`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {(outcome.warnings ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>
            {outcome.errors.length === 1
              ? "1 problem — the push was not complete"
              : `${outcome.errors.length} problems — the push was not complete`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {outcome.errors.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

/**
 * The panel's loading and empty states, so the four sections cannot each
 * invent their own. A spinner rather than a sentence is the app's convention
 * (`OnshapeSync`, `AttachmentsList`); the dashed circle is the ERP's `Empty`.
 * Both stay on one line — the panel has about twenty.
 */
function PanelLoading({ children }: { children: ReactNode }) {
  return (
    <HStack spacing={2} className="w-full text-sm text-muted-foreground">
      <Spinner size={12} />
      <span>{children}</span>
    </HStack>
  );
}

/**
 * A list being read for the first time, in the shape it will take.
 *
 * Carbon's `Skeleton` (animate-pulse on `bg-muted`), laid out as the real
 * rows are — two lines of text and a badge inside the same bordered card —
 * so the list does not jump when the read lands. A refresh never shows this:
 * it has rows already, and replacing them with grey bars would be a step
 * backwards from what the user is looking at.
 */
function PanelListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="w-full divide-y divide-border rounded-md border border-border">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="flex items-center justify-between gap-2 px-3 py-2"
        >
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-24 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/**
 * What to say when a request threw instead of answering.
 *
 * `fetch` rejects with a TypeError when the request never completed — offline,
 * DNS, a dropped connection — and each browser's wording for it ("Failed to
 * fetch", "Load failed", "NetworkError when attempting to fetch resource") is
 * machine text. Matched on the wording as well as the type, so a TypeError that
 * is a genuine bug still reports itself rather than blaming the network.
 */
function thrownMessage(error: unknown): string {
  if (
    error instanceof TypeError &&
    /fetch|network|load failed/i.test(error.message)
  ) {
    return "Carbon couldn't be reached. Check your connection and try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * A warning listing things, bounded.
 *
 * Skipped BOM components arrive one per occurrence, so a real assembly lists
 * the same fastener dozens of times: a 300-line assembly produced a 314-item
 * alert several screens tall, burying the Push bar it was meant to inform.
 * Identical lines fold into one with a count, and only the first few show
 * until asked. The title counts occurrences, since that is what the push
 * leaves out.
 */
const CAPPED_WARNING_VISIBLE = 6;

function CappedWarningList({
  title,
  lines,
  description,
  variant = "warning"
}: {
  title: (count: number) => string;
  lines: string[];
  description?: string;
  variant?: "warning" | "destructive";
}) {
  const [expanded, setExpanded] = useState(false);
  const folded = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return [...counts.entries()];
  }, [lines]);
  const visible = expanded ? folded : folded.slice(0, CAPPED_WARNING_VISIBLE);
  const hidden = folded.length - visible.length;
  return (
    <Alert variant={variant}>
      <LuTriangleAlert />
      <AlertTitle>{title(lines.length)}</AlertTitle>
      <AlertDescription>
        {description ? <p className="mb-1">{description}</p> : null}
        <ul className="list-disc space-y-1 pl-4">
          {visible.map(([line, count]) => (
            <li key={line}>
              {line}
              {count > 1 ? ` (×${count})` : null}
            </li>
          ))}
        </ul>
        {hidden > 0 || expanded ? (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto p-0"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show fewer" : `Show ${hidden} more`}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * A read that failed, in the one shape every section uses.
 *
 * A permission denial is a warning with no Retry — nothing is broken, and
 * retrying cannot help. Anything else is destructive with a Retry in the alert
 * itself, beside the message it answers. `stale` marks a failed Refresh over
 * rows that are still on screen, which must say those rows are the old ones.
 */
function PanelLoadError({
  title,
  failure,
  stale,
  retrying,
  onRetry
}: {
  title: string;
  failure: LoadFailure;
  stale?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  if (failure.forbidden) {
    return (
      <Alert variant="warning">
        <LuTriangleAlert />
        <AlertTitle>You don't have permission for this</AlertTitle>
        <AlertDescription>{failure.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <LuTriangleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {failure.message}
        {/* Its own line: a message without a full stop ran straight into it. */}
        {stale ? (
          <span className="mt-1 block">Showing what was loaded before.</span>
        ) : null}
      </AlertDescription>
      {onRetry ? (
        <HStack className="mt-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onRetry}
            isDisabled={retrying}
            isLoading={retrying}
          >
            Retry
          </Button>
        </HStack>
      ) : null}
    </Alert>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <HStack
      spacing={2}
      className="w-full justify-center py-3 text-sm text-muted-foreground"
    >
      <LuCircleDashed className="size-4 shrink-0" />
      <span>{children}</span>
    </HStack>
  );
}

/**
 * The Carbon panel Onshape embeds in its element right panel.
 *
 * Phase 1 M1: proves the three legs — Onshape context arrives on the URL,
 * Onshape's SELECTION messages arrive over postMessage, and a Carbon user can
 * sign in from inside the iframe through a same-origin popup. Later milestones
 * replace the selection debug block with part status and push controls.
 */
export function OnshapePanel({
  context,
  serverOrigin,
  paths
}: {
  context: OnshapePanelContext;
  serverOrigin: string | null;
  paths: OnshapePanelPaths;
}) {
  const [session, setSession] = useState<SessionState>({ status: "unknown" });
  const [parts, setParts] = useState<PanelStatusState>({ status: "idle" });
  const [releases, setReleases] = useState<PanelReleasesState>({
    status: "idle"
  });
  const [pushingReleaseId, setPushingReleaseId] = useState<string | null>(null);
  const [releaseOutcome, setReleaseOutcome] = useState<
    Record<string, PushOutcome>
  >({});

  const canLoadParts =
    !!context.documentId &&
    !!context.wv &&
    !!context.wvId &&
    !!context.elementId;
  const canPush = canLoadParts && (context.wv === "w" || context.wv === "v");
  const [pushing, setPushing] = useState<Set<string> | null>(null);
  const [pushOutcome, setPushOutcome] = useState<
    Record<string, PartRowOutcome>
  >({});
  /** The part push's section-level result: counts, problems, warnings. */
  const [partsOutcome, setPartsOutcome] = useState<PushOutcome | null>(null);

  /*
   * Two pages, not two sections of one: the element's BOM is the daily job and
   * releases are occasional. Stacked, one stood between the user and the other.
   */
  const [tab, setTab] = useState<PanelTab>("push");

  // The plan under review, if any. Each section renders its review in place
  // of its list while one is open; a part or assembly review is scoped to the
  // element, a release review to the document.
  const [review, setReview] = useState<ReviewState | null>(null);
  const elementScope = [
    context.documentId,
    context.wv,
    context.wvId,
    context.elementId
  ].join(":");
  const documentScope = context.documentId ?? "";

  // A stored plan describes the element it was built for: when Onshape moves
  // the panel to another element or document, a review in progress is void.
  useEffect(() => {
    setReview((current) => {
      if (!current) return current;
      const expected =
        current.kind === "release" ? documentScope : elementScope;
      return current.scope === expected ? current : null;
    });
    // A refusal or outcome is about the element it was produced for.
    setAssemblyOutcome(null);
    setPartsOutcome(null);
    setPushOutcome({});
    setAssemblyTooLarge(null);
    setTab("push");
  }, [elementScope, documentScope]);

  // The review belongs to the session that planned it.
  useEffect(() => {
    if (session.status === "signed-out") {
      setReview(null);
      /*
       * Everything read under the old session goes with it: the next sign-in
       * can be a different user or company, and a section abandoned mid-read
       * by a 401 would otherwise stay `loading` with no way out.
       */
      setParts({ status: "idle" });
      setReleases({ status: "idle" });
      setTab("push");
    }
  }, [session.status]);

  const loadParts = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      // A refusal was about the BOM as it was; a re-read may have changed it.
      setAssemblyTooLarge(null);
      const fail = (message: string, forbidden: boolean) =>
        setParts((current) =>
          current.status === "ready" ||
          current.status === "ready-assembly" ||
          current.status === "ready-other"
            ? {
                ...current,
                refreshing: false,
                refreshFailure: { message, forbidden }
              }
            : { status: "error", message, forbidden }
        );
      setParts((current) =>
        current.status === "ready" ||
        current.status === "ready-assembly" ||
        current.status === "ready-other"
          ? { ...current, refreshing: true, refreshFailure: undefined }
          : { status: "loading" }
      );
      try {
        const query = new URLSearchParams({
          documentId: context.documentId as string,
          wv: context.wv as string,
          wvId: context.wvId as string,
          elementId: context.elementId as string
        });
        const response = await panelFetch(token, `${paths.status}?${query}`);
        const body = (await response.json()) as
          | { kind: "partstudio"; parts: PanelPartStatus[] }
          | { kind: "assembly"; assembly: PanelAssemblyStatus }
          | { kind: "other" }
          | { error: string };
        if (!response.ok || "error" in body) {
          fail(
            "error" in body ? body.error : `Carbon answered ${response.status}`,
            response.status === 403
          );
          return;
        }
        if (body.kind === "assembly" && body.assembly) {
          setParts({ status: "ready-assembly", assembly: body.assembly });
        } else if (body.kind === "partstudio" && Array.isArray(body.parts)) {
          setParts({ status: "ready", rows: body.parts });
        } else {
          setParts({ status: "ready-other" });
        }
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          setParts({ status: "idle" });
          return;
        }
        fail(thrownMessage(error), false);
      }
    },
    [canLoadParts, context, paths.status]
  );

  const loadReleases = useCallback(
    async (token: string) => {
      if (!context.documentId) return;
      const fail = (message: string, forbidden: boolean) =>
        setReleases((current) =>
          current.status === "ready"
            ? {
                ...current,
                refreshing: false,
                refreshFailure: { message, forbidden }
              }
            : { status: "error", message, forbidden }
        );
      setReleases((current) =>
        current.status === "ready"
          ? { ...current, refreshing: true, refreshFailure: undefined }
          : { status: "loading" }
      );
      try {
        const query = new URLSearchParams({ documentId: context.documentId });
        const response = await panelFetch(token, `${paths.releases}?${query}`);
        const body = (await response.json()) as
          | { releases: PanelRelease[] }
          | { error: string };
        if (!response.ok || "error" in body) {
          fail(
            "error" in body ? body.error : `Carbon answered ${response.status}`,
            response.status === 403
          );
          return;
        }
        setReleases({ status: "ready", releases: body.releases });
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        fail(thrownMessage(error), false);
      }
    },
    [context.documentId, paths.releases]
  );

  const loadMe = useCallback(
    async (token: string) => {
      setSession({ status: "loading", token });
      try {
        const response = await panelFetch(token, paths.me);
        if (!response.ok) {
          setSession({
            status: "error",
            token,
            message: `Carbon answered ${response.status}`
          });
          return;
        }
        const me = (await response.json()) as OnshapePanelMe;
        setSession({ status: "signed-in", token, me });
        void loadParts(token);
        void loadReleases(token);
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setSession({
          status: "error",
          token,
          message: thrownMessage(error)
        });
      }
    },
    [paths.me, loadParts, loadReleases]
  );

  // Boot: tell Onshape we are ready, restore a stored token, and listen for
  // both Onshape (selection) and our own popup (session token).
  useEffect(() => {
    if (serverOrigin) postApplicationInit(context, serverOrigin);

    const stored = getPanelSessionToken();
    if (stored) {
      void loadMe(stored);
    } else {
      setSession({ status: "signed-out" });
    }

    const onMessage = (event: MessageEvent) => {
      /*
       * Onshape's own messages are ignored. The context the panel works from
       * arrives as query parameters, and the client events on this channel
       * (SELECTION and friends) drive nothing yet — the branch exists so an
       * Onshape message can never be read as a session token below.
       */
      if (serverOrigin && event.origin === serverOrigin) return;
      if (
        event.origin === window.location.origin &&
        isPanelSessionMessage(event.data)
      ) {
        setPanelSessionToken(event.data.token);
        void loadMe(event.data.token);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [context, serverOrigin, loadMe]);

  /**
   * Plan a part push: Onshape is read once, nothing is written, and the plan
   * opens the review. The push buttons show busy meanwhile, as they did when
   * the write itself ran here; a failed plan reports on the rows the way a
   * failed push did, with no review left open to hide it.
   */
  const planParts = useCallback(
    async (token: string, partIds: string[]) => {
      if (!canPush || partIds.length === 0) return;
      setPushing(new Set(partIds));
      setPartsOutcome(null);
      try {
        const response = await panelFetch(token, paths.planPart, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: context.documentId,
            wv: context.wv,
            wvId: context.wvId,
            elementId: context.elementId,
            partIds
          })
        });
        const body = (await response.json()) as
          | PlanResponse<PartPlan>
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          // One failure, so one alert. Copying the message onto every selected
          // row said the same sentence fourteen times in grey.
          setReview(null);
          setPartsOutcome(
            failedOutcome(
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
            )
          );
          return;
        }
        setReview(
          createReview({
            planId: body.planId,
            expiresAt: body.expiresAt,
            scope: elementScope,
            plan: body.plan
          })
        );
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setReview(null);
        setPartsOutcome(failedOutcome(thrownMessage(error)));
      } finally {
        setPushing(null);
      }
    },
    [canPush, context, paths.planPart, elementScope]
  );

  const [assemblyOutcome, setAssemblyOutcome] = useState<PushOutcome | null>(
    null
  );
  /** The plan route refused the whole tree as too large; holds its message. */
  const [assemblyTooLarge, setAssemblyTooLarge] = useState<string | null>(null);
  /*
   * The whole tree by default. Choosing a depth per push was a question the
   * panel could not help anyone answer: the cost it trades away (one request's
   * size) is invisible until the push is too big, and the result it trades away
   * (a real BOM below the top level) is the thing the user came for.
   *
   * So `top` is offered only at the moment it is the answer — when the route
   * refuses the whole tree as too large. The refusal counts distinct part
   * numbers across the WHOLE tree whatever is already in Carbon, so pushing
   * sub-assemblies first never lowers it; a level-only push is the one way out.
   */
  const planAssembly = useCallback(
    async (token: string, depth: AssemblyPlanDepth = "all") => {
      if (!canPush) return;
      setPushing(new Set(["__assembly__"]));
      setAssemblyOutcome(null);
      setAssemblyTooLarge(null);
      try {
        const response = await panelFetch(token, paths.planAssembly, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: context.documentId,
            wv: context.wv,
            wvId: context.wvId,
            elementId: context.elementId,
            depth
          })
        });
        const body = (await response.json()) as
          | PlanResponse<AssemblyPlan>
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          setReview(null);
          if ("error" in body && body.code === "too-large") {
            setAssemblyTooLarge(body.error);
            return;
          }
          setAssemblyOutcome(
            failedOutcome(
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
            )
          );
          return;
        }
        setReview(
          createReview({
            planId: body.planId,
            expiresAt: body.expiresAt,
            scope: elementScope,
            plan: body.plan
          })
        );
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setReview(null);
        setAssemblyOutcome(failedOutcome(thrownMessage(error)));
      } finally {
        setPushing(null);
      }
    },
    [canPush, context, paths.planAssembly, elementScope]
  );

  const planRelease = useCallback(
    async (token: string, releaseId: string) => {
      setPushingReleaseId(releaseId);
      try {
        const response = await panelFetch(token, paths.planRelease, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: context.documentId, releaseId })
        });
        const body = (await response.json()) as
          | PlanResponse<ReleasePlan>
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          setReview(null);
          setReleaseOutcome((prev) => ({
            ...prev,
            [releaseId]: failedOutcome(
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
            )
          }));
          return;
        }
        setReview(
          createReview({
            planId: body.planId,
            expiresAt: body.expiresAt,
            scope: documentScope,
            plan: body.plan,
            warnings: normalizeWarnings(body.warnings)
          })
        );
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setReview(null);
        setReleaseOutcome((prev) => ({
          ...prev,
          [releaseId]: failedOutcome(thrownMessage(error))
        }));
      } finally {
        setPushingReleaseId(null);
      }
    },
    [context.documentId, paths.planRelease, documentScope]
  );

  /**
   * Apply the reviewed plan. The server takes the stored plan once, merges
   * the edits and writes; nothing is read from Onshape. A 422 pins errors to
   * rows, a 410 means the plan expired and only a new review can continue,
   * and success renders the outcome lines a direct push rendered. A part
   * apply patches the list from the results instead of re-reading Onshape;
   * assembly and release reload as before.
   */
  const applyReview = useCallback(
    async (token: string) => {
      if (!review || review.applying) return;
      const current = review;
      setReview({ ...current, applying: true, error: null, fieldErrors: {} });
      const path =
        current.kind === "part"
          ? paths.pushPart
          : current.kind === "assembly"
            ? paths.pushAssembly
            : paths.pushRelease;
      try {
        const response = await panelFetch(token, path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(applyRequestBody(current))
        });
        const body = (await response.json()) as
          | { results: PartApplyResult[]; warnings?: string[] }
          | { summary: AssemblyPushSummary | ReleasePushSummary }
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          setReview({
            ...current,
            applying: false,
            error:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`,
            fieldErrors:
              response.status === 422 && "fieldErrors" in body
                ? indexFieldErrors(body.fieldErrors)
                : {},
            expired: response.status === 410
          });
          return;
        }
        setReview(null);
        if (current.kind === "part") {
          const results = "results" in body ? body.results : [];
          setPushOutcome((prev) => ({
            ...prev,
            ...Object.fromEntries(
              results.map((r) => [r.partId, partOutcome(r)])
            )
          }));
          // The route computes `warnings` and says they must NOT be silent;
          // they were never read here, so they were.
          setPartsOutcome(
            partsOutcomeText(
              results,
              current.plan.rows,
              "warnings" in body ? (body.warnings ?? []) : []
            )
          );
          setParts((prev) =>
            prev.status === "ready"
              ? {
                  status: "ready",
                  rows: patchPartStatuses(prev.rows, current, results)
                }
              : prev
          );
        } else if (current.kind === "assembly") {
          const summary = (body as { summary: AssemblyPushSummary }).summary;
          setAssemblyOutcome(assemblyOutcomeText(summary));
          await loadParts(token);
        } else {
          const summary = (body as { summary: ReleasePushSummary }).summary;
          setReleaseOutcome((prev) => ({
            ...prev,
            [current.plan.releaseId]: releaseOutcomeText(summary)
          }));
          await loadReleases(token);
          await loadParts(token);
        }
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setReview({
          ...current,
          applying: false,
          error: thrownMessage(error)
        });
      }
    },
    [
      review,
      paths.pushPart,
      paths.pushAssembly,
      paths.pushRelease,
      loadParts,
      loadReleases
    ]
  );

  const cancelReview = () => setReview(null);

  /** After a 410: the same plan request again, which replaces the review. */
  const replan = (token: string) => {
    if (!review) return;
    if (review.kind === "part") {
      void planParts(
        token,
        review.plan.rows.map((row) => row.partId)
      );
    } else if (review.kind === "assembly") {
      // The same depth the expired review was built at, not the default.
      void planAssembly(token, review.plan.depth);
    } else {
      void planRelease(token, review.plan.releaseId);
    }
  };

  const signIn = () => {
    const width = 480;
    const height = 680;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 3);
    const popup = window.open(
      paths.auth,
      "carbon-onshape-auth",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`
    );
    setSession(
      popup
        ? { status: "signed-out" }
        : { status: "signed-out", popupBlocked: true }
    );
  };

  const signOut = async () => {
    const token = "token" in session ? session.token : null;
    clearPanelSessionToken();
    setSession({ status: "signed-out" });
    if (token) {
      try {
        await panelFetch(token, paths.session, { method: "DELETE" });
      } catch {
        // Already gone server-side; nothing to do.
      }
    }
  };

  /*
   * Not every page applies to every element. A drawing has no parts, but it
   * belongs to a document that has releases.
   */
  const availableTabs = useMemo<PanelTab[]>(() => {
    if (session.status !== "signed-in") return [];
    const tabs: PanelTab[] = [];
    if (canLoadParts) tabs.push("push");
    if (context.documentId) tabs.push("releases");
    return tabs;
  }, [session.status, canLoadParts, context.documentId]);

  /*
   * Onshape moves the panel between elements, so a page can vanish under the
   * user: an assembly's Assembly and Fields pages are gone on a drawing.
   * Fall back to the first page that still exists rather than render nothing.
   */
  useEffect(() => {
    const first = availableTabs[0];
    if (first && !availableTabs.includes(tab)) setTab(first);
  }, [availableTabs, tab]);

  // The first page names what it holds, which is only known once the status
  // read says which kind of element this is.
  const pushTabLabel =
    parts.status === "ready-assembly"
      ? "Assembly"
      : parts.status === "ready"
        ? "Parts"
        : "Push";

  /*
   * Before sign-in the panel IS the sign-in: `availableTabs` is empty until
   * there is a session, every pane renders null, and the only thing to say is
   * who is asking and how to answer. Returning here rather than threading the
   * empty Tabs shell around it is what lets the block own the full height —
   * inside the scrolling body it centred within its own content box, which
   * left it stranded near the top of a tall, empty panel.
   *
   * Every hook has already run above; this is the last branch before render.
   */
  if (session.status === "signed-out" || session.status === "unknown") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 p-4">
        {!serverOrigin ? (
          <Alert variant="warning" className="max-w-sm">
            <LuTriangleAlert />
            <AlertTitle>Open this panel from Onshape</AlertTitle>
          </Alert>
        ) : null}
        {session.status === "signed-out" && session.popupBlocked ? (
          <Alert variant="warning" className="max-w-sm">
            <LuTriangleAlert />
            <AlertTitle>Your browser blocked the sign-in window</AlertTitle>
            <AlertDescription>
              Allow pop-ups for this page, then press Sign in to Carbon again.
            </AlertDescription>
          </Alert>
        ) : null}
        <PanelSignIn
          onSignIn={signIn}
          disabled={session.status === "unknown"}
        />
      </div>
    );
  }

  return (
    /*
     * Three bands: a header that stays put, one scrolling body, and whatever
     * action bar the active section pins to the bottom. The body is the ONLY
     * scroller — `min-h-0` is what lets it shrink inside the flex column
     * instead of pushing the header off the top.
     *
     * The Tabs root has to be the outermost element: the tab strip belongs to
     * the pinned band and the panes belong to the scrolling one, and Radix
     * requires both inside the same root.
     */
    <Tabs
      value={tab}
      onValueChange={(value) =>
        (value === "push" || value === "releases") && setTab(value)
      }
      className="flex h-full min-h-0 flex-col"
    >
      {/*
       * The top band: the pages, and which Carbon company this panel writes
       * into with the way out. The company is not cosmetic — a user in more
       * than one has no other way to tell where a push will land. Pinned, not
       * scrolled with the pane: the push view is a long list.
       */}
      <HStack className="w-full shrink-0 justify-between gap-2 border-b border-border px-4 py-2">
        {availableTabs.length > 1 ? (
          <TabsList>
            {availableTabs.includes("push") ? (
              <TabsTrigger value="push">{pushTabLabel}</TabsTrigger>
            ) : null}
            {availableTabs.includes("releases") ? (
              <TabsTrigger value="releases">Releases</TabsTrigger>
            ) : null}
          </TabsList>
        ) : (
          <span />
        )}
        {session.status === "signed-in" ? (
          <HStack spacing={1} className="min-w-0">
            <span
              className="truncate text-xs text-muted-foreground"
              title={session.me.email}
            >
              {session.me.company?.name ?? session.me.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </HStack>
        ) : null}
      </HStack>

      <VStack spacing={4} className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Not broken, just opened outside its host: a warning, as on the
            sign-in screen. */}
        {!serverOrigin ? (
          <Alert variant="warning">
            <LuTriangleAlert />
            <AlertTitle>Open this panel from Onshape</AlertTitle>
          </Alert>
        ) : null}

        {session.status === "loading" ? (
          <PanelLoading>Connecting to Carbon…</PanelLoading>
        ) : null}

        {session.status === "error" ? (
          <Alert variant="destructive">
            <LuTriangleAlert />
            <AlertTitle>Carbon is not reachable</AlertTitle>
            <AlertDescription>{session.message}</AlertDescription>
            <HStack className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => session.token && loadMe(session.token)}
                // Never render a button that does nothing.
                isDisabled={!session.token}
              >
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={signOut}>
                Sign in again
              </Button>
            </HStack>
          </Alert>
        ) : null}

        <TabsContent value="push" className="w-full">
          <VStack spacing={4} className="w-full">
            {/* A first read does not yet know whether this element is an
                assembly or a part studio, so it claims neither: a skeleton
                where the title will be, and the list's own shape below it.
                Naming it "Parts in this element" was wrong half the time and
                moved every row when the truth arrived. */}
            {session.status === "signed-in" &&
            canLoadParts &&
            !review &&
            (parts.status === "loading" || parts.status === "idle") ? (
              <VStack spacing={2} className="w-full">
                <HStack className="w-full justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-8 w-20" />
                </HStack>
                <PanelListSkeleton />
              </VStack>
            ) : null}

            {session.status === "signed-in" &&
            canLoadParts &&
            (parts.status === "ready-assembly" ||
              parts.status === "ready-other") ? (
              parts.status === "ready-assembly" ? (
                review?.kind === "assembly" ? (
                  <AssemblyReviewSection
                    review={review}
                    onCancel={cancelReview}
                    onApply={() => applyReview(session.token)}
                    onReplan={() => replan(session.token)}
                    replanning={!!pushing}
                  />
                ) : (
                  <AssemblySection
                    locked={!!review}
                    assembly={parts.assembly}
                    canPush={canPush}
                    busy={!!pushing}
                    refreshing={!!parts.refreshing}
                    outcome={assemblyOutcome}
                    tooLarge={assemblyTooLarge}
                    refreshFailure={parts.refreshFailure}
                    onPush={() => planAssembly(session.token)}
                    onPushLevel={() => planAssembly(session.token, "top")}
                    onRefresh={() => loadParts(session.token)}
                  />
                )
              ) : (
                <PanelEmpty>Nothing to push in this element</PanelEmpty>
              )
            ) : null}

            {session.status === "signed-in" &&
            canLoadParts &&
            parts.status !== "ready-assembly" &&
            parts.status !== "ready-other" &&
            (!!review ||
              (parts.status !== "loading" && parts.status !== "idle")) ? (
              review?.kind === "part" ? (
                <PartReviewSection
                  review={review}
                  onCancel={cancelReview}
                  onApply={() => applyReview(session.token)}
                  onReplan={() => replan(session.token)}
                  replanning={!!pushing}
                />
              ) : (
                <PartsSection
                  locked={!!review}
                  parts={parts}
                  canPush={canPush}
                  pushing={pushing}
                  pushOutcome={pushOutcome}
                  outcome={partsOutcome}
                  onRefresh={() => loadParts(session.token)}
                  onPush={(partIds) => planParts(session.token, partIds)}
                />
              )
            ) : null}
          </VStack>
        </TabsContent>

        <TabsContent value="releases" className="w-full">
          {session.status === "signed-in" && context.documentId ? (
            review?.kind === "release" ? (
              <ReleaseReviewSection
                review={review}
                onCancel={cancelReview}
                onApply={() => applyReview(session.token)}
                onReplan={() => replan(session.token)}
                replanning={!!pushingReleaseId}
              />
            ) : (
              <ReleasesSection
                locked={!!review}
                releases={releases}
                pushingReleaseId={pushingReleaseId}
                outcome={releaseOutcome}
                onPush={(releaseId) => planRelease(session.token, releaseId)}
                onRefresh={() => loadReleases(session.token)}
              />
            )
          ) : null}
        </TabsContent>
      </VStack>
    </Tabs>
  );
}

function AssemblySection({
  assembly,
  canPush,
  busy,
  refreshing,
  locked,
  outcome,
  tooLarge,
  refreshFailure,
  onPush,
  onPushLevel,
  onRefresh
}: {
  assembly: PanelAssemblyStatus;
  canPush: boolean;
  busy: boolean;
  /** A re-read is in flight; the rows on screen are the previous ones. */
  refreshing: boolean;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  outcome: PushOutcome | null;
  /** The whole-tree push was refused as too large: the route's message. */
  tooLarge: string | null;
  /** A Refresh failed; the BOM on screen is the one loaded before it. */
  refreshFailure?: LoadFailure;
  onPush: () => void;
  /** Plan the root's own BOM only — the way out of a too-large refusal. */
  onPushLevel: () => void;
  onRefresh: () => void;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <HStack spacing={2}>
          <span className="text-sm font-medium">
            {assembly.root.partNumber ?? assembly.root.name ?? "Assembly"}
          </span>
          <PartStateBadge state={assembly.root.state} />
        </HStack>
        <HStack spacing={1}>
          {canPush ? (
            <Button
              size="sm"
              onClick={onPush}
              isDisabled={busy || locked || refreshing}
              isLoading={busy}
            >
              {assembly.root.state === "linked"
                ? "Re-push assembly"
                : "Push assembly"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isDisabled={busy || refreshing}
            isLoading={refreshing}
            leftIcon={<LuRefreshCw />}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {/* Two different causes, two different fixes: one is in Onshape, the
          other is a read that will probably succeed on Refresh. */}
      {!assembly.root.partNumber ? (
        assembly.root.identityUnavailable ? (
          <Alert variant="warning">
            <LuTriangleAlert />
            <AlertTitle>Couldn't read this assembly's part number</AlertTitle>
            <AlertDescription>
              Onshape didn't return it this time. Refresh to try again.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning">
            <LuTriangleAlert />
            <AlertTitle>This assembly has no part number</AlertTitle>
            <AlertDescription>
              Set one on the assembly in Onshape, then press Refresh.
            </AlertDescription>
          </Alert>
        )
      ) : null}

      {refreshFailure ? (
        <PanelLoadError
          title="Couldn't refresh the BOM"
          failure={refreshFailure}
          stale
          retrying={refreshing}
          onRetry={onRefresh}
        />
      ) : null}

      {/* A refusal, not a failure: nothing is broken, and it carries the one
          action that gets the user past it. */}
      {tooLarge ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>This assembly is too large for one push</AlertTitle>
          <AlertDescription>{tooLarge}</AlertDescription>
          <HStack className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={onPushLevel}
              isDisabled={busy || locked || refreshing}
              isLoading={busy}
            >
              Push this level only
            </Button>
          </HStack>
        </Alert>
      ) : null}

      {outcome ? <PushOutcomeView outcome={outcome} /> : null}

      {assembly.lines.length === 0 ? (
        <PanelEmpty>The BOM is empty</PanelEmpty>
      ) : (
        <AssemblyBomList lines={assembly.lines} disabled={refreshing} />
      )}
    </VStack>
  );
}

/**
 * The current assembly's BOM, as Onshape's structured BOM table shows it.
 *
 * Structured opens at the top level only. The rows are the assembly's own
 * children, and a sub-assembly says how many lines it is hiding so the choice
 * to open it is an informed one — a deep tree is hundreds of rows in a panel
 * about twenty tall, and the old view rendered all of them at once.
 *
 * Open sub-assemblies are tracked rather than collapsed ones, the opposite of
 * the ERP's `TreeView`. There the default is to show the tree; here the default
 * is to bound it, and a set of open indexes is what survives a refresh
 * cleanly — a BOM that changed underneath keeps whatever indexes still exist
 * and silently drops the rest.
 */
function AssemblyBomList({
  lines,
  disabled
}: {
  lines: PanelAssemblyLine[];
  /*
   * A re-read is in flight, so the rows on screen are about to be replaced.
   * Expanding a list while it is being refetched only means doing it twice.
   */
  disabled: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildBomViewTree(lines), [lines]);
  const structured = useMemo(() => visibleBomRows(tree, open), [tree, open]);
  const parents = useMemo(() => bomParentIndexes(tree), [tree]);

  const toggle = (index: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const allOpen = parents.length > 0 && parents.every((i) => open.has(i));

  return (
    <VStack spacing={2} className="w-full">
      {parents.length > 0 ? (
        <HStack className="w-full justify-end">
          <Button
            variant="link"
            size="sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(parents))}
            isDisabled={disabled}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </HStack>
      ) : null}
      <ul className="w-full divide-y divide-border rounded-md border border-border">
        {structured.map((row) => (
          <li key={row.line.index} className="px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <HStack
                spacing={1}
                className="min-w-0"
                style={{ paddingLeft: `${(row.level - 1) * 14}px` }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(row.line.index)}
                    disabled={disabled}
                    aria-expanded={row.open}
                    aria-label={`${row.open ? "Collapse" : "Expand"} ${
                      row.line.partNumber ?? row.line.index
                    }`}
                    className="shrink-0 text-muted-foreground transition-transform hover:text-foreground active:scale-[0.96] active:duration-75"
                  >
                    <LuChevronRight
                      className={cn(
                        "size-3.5 transition-transform",
                        row.open && "rotate-90"
                      )}
                    />
                  </button>
                ) : (
                  /* Leaves keep the chevron's width so part numbers stay on
                     one column instead of stepping in and out. */
                  <span className="size-3.5 shrink-0" aria-hidden />
                )}
                <BomLineText
                  line={row.line}
                  quantity={row.line.quantity}
                  note={
                    row.hasChildren && !row.open
                      ? `${row.descendantCount} inside`
                      : null
                  }
                />
              </HStack>
              <PartStateBadge state={row.line.state} />
            </div>
          </li>
        ))}
      </ul>
    </VStack>
  );
}

/** A BOM line's two lines of text. */
function BomLineText({
  line,
  quantity,
  note
}: {
  line: PanelAssemblyLine;
  /** Per-parent in the structured view, rolled up in the flat one. */
  quantity: number;
  note: string | null;
}) {
  return (
    <div className="min-w-0">
      <p
        className="text-sm truncate"
        title={line.name ?? line.partNumber ?? line.index}
      >
        {line.name ?? line.partNumber ?? line.index}
        <span className="tabular-nums text-muted-foreground">
          {" "}
          × {quantity}
        </span>
      </p>
      <p className="text-xs text-muted-foreground truncate">
        {line.partNumber ?? "No part number"}
        {line.purchased ? " · purchased" : ""}
        {note ? ` · ${note}` : ""}
      </p>
    </div>
  );
}

function PartsSection({
  parts,
  canPush,
  pushing,
  locked,
  pushOutcome,
  outcome,
  onRefresh,
  onPush
}: {
  parts:
    | { status: "idle" }
    | { status: "loading" }
    | {
        status: "ready";
        rows: PanelPartStatus[];
        refreshing?: boolean;
        refreshFailure?: LoadFailure;
      }
    | { status: "error"; message: string; forbidden?: boolean };
  canPush: boolean;
  pushing: Set<string> | null;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  pushOutcome: Record<string, PartRowOutcome>;
  outcome: PushOutcome | null;
  onRefresh: () => void;
  onPush: (partIds: string[]) => void;
}) {
  // Defensive against a half-migrated state shape (stale HMR closures can
  // deliver ready without rows): never crash the panel over it.
  const rows =
    parts.status === "ready" && Array.isArray(parts.rows) ? parts.rows : [];
  const pushableIds = rows.filter((r) => r.partNumber).map((r) => r.partId);
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Parts in this element</span>
        <HStack spacing={1}>
          {canPush && pushableIds.length > 0 ? (
            <Button
              size="sm"
              onClick={() => onPush(pushableIds)}
              isDisabled={
                !!pushing ||
                locked ||
                parts.status === "loading" ||
                (parts.status === "ready" && !!parts.refreshing)
              }
              isLoading={!!pushing && pushing.size > 1}
            >
              Push all
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isDisabled={parts.status === "loading" || !!pushing}
            isLoading={parts.status === "ready" && !!parts.refreshing}
            leftIcon={<LuRefreshCw />}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {parts.status === "loading" || parts.status === "idle" ? (
        <PanelListSkeleton />
      ) : null}

      {parts.status === "error" ? (
        <PanelLoadError
          title="Couldn't load part status"
          failure={{ message: parts.message, forbidden: !!parts.forbidden }}
          onRetry={onRefresh}
        />
      ) : null}

      {parts.status === "ready" && parts.refreshFailure ? (
        <PanelLoadError
          title="Couldn't refresh part status"
          failure={parts.refreshFailure}
          stale
          retrying={!!parts.refreshing}
          onRetry={onRefresh}
        />
      ) : null}

      {outcome ? <PushOutcomeView outcome={outcome} /> : null}

      {parts.status === "ready" && rows.length === 0 ? (
        <PanelEmpty>This element has no parts</PanelEmpty>
      ) : null}

      {parts.status === "ready" && rows.length > 0 ? (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {rows.map((part) => (
            <li
              key={part.partId}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm truncate" title={part.name}>
                  {part.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {part.partNumber ?? "No part number"}
                  {part.revision ? ` · Rev ${part.revision}` : ""}
                  {part.state === "linked" && part.item
                    ? ` → ${part.item.readableId}`
                    : ""}
                  {part.state === "matched" && part.item
                    ? " · number already used in Carbon"
                    : ""}
                </p>
              </div>
              <HStack spacing={2} className="shrink-0">
                {pushOutcome[part.partId] ? (
                  <span
                    className={cn(
                      "text-xs",
                      pushOutcome[part.partId]?.kind === "error"
                        ? "font-medium text-destructive"
                        : pushOutcome[part.partId]?.kind === "skipped"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    )}
                  >
                    {pushOutcome[part.partId]?.text}
                  </span>
                ) : null}
                <PartStateBadge state={part.state} />
                {canPush ? (
                  <Button
                    size="sm"
                    variant={part.state === "linked" ? "ghost" : "secondary"}
                    onClick={() => onPush([part.partId])}
                    isDisabled={
                      !!pushing ||
                      locked ||
                      !part.partNumber ||
                      (parts.status === "ready" && !!parts.refreshing)
                    }
                    isLoading={!!pushing && pushing.has(part.partId)}
                    title={
                      part.partNumber
                        ? undefined
                        : "Set a part number in Onshape first"
                    }
                  >
                    {part.state === "linked" ? "Re-push" : "Push"}
                  </Button>
                ) : null}
              </HStack>
            </li>
          ))}
        </ul>
      ) : null}
    </VStack>
  );
}

function ReleasesSection({
  releases,
  pushingReleaseId,
  locked,
  outcome,
  onPush,
  onRefresh
}: {
  releases: PanelReleasesState;
  pushingReleaseId: string | null;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  outcome: Record<string, PushOutcome>;
  onPush: (releaseId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Releases</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          isDisabled={releases.status === "loading" || !!pushingReleaseId}
          isLoading={releases.status === "ready" && !!releases.refreshing}
          leftIcon={<LuRefreshCw />}
        >
          Refresh
        </Button>
      </HStack>

      {releases.status === "loading" || releases.status === "idle" ? (
        <PanelListSkeleton rows={3} />
      ) : null}

      {releases.status === "error" ? (
        <PanelLoadError
          title="Couldn't load releases"
          failure={{
            message: releases.message,
            forbidden: !!releases.forbidden
          }}
          onRetry={onRefresh}
        />
      ) : null}

      {releases.status === "ready" && releases.refreshFailure ? (
        <PanelLoadError
          title="Couldn't refresh releases"
          failure={releases.refreshFailure}
          stale
          retrying={!!releases.refreshing}
          onRetry={onRefresh}
        />
      ) : null}

      {releases.status === "ready" && releases.releases.length === 0 ? (
        <PanelEmpty>No releases yet</PanelEmpty>
      ) : null}

      {releases.status === "ready" && releases.releases.length > 0 ? (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {releases.releases.map((release) => {
            const models = release.items.filter(
              (item) => item.elementType === 0 || item.elementType === 1
            );
            const drawings = release.items.length - models.length;
            const releaseOutcome = outcome[release.releaseId];
            return (
              <li key={release.releaseId} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className="text-sm truncate"
                      title={release.releaseName ?? "Release"}
                    >
                      {release.releaseName ?? "Release"}
                      {release.createdAt
                        ? ` · ${new Date(release.createdAt).toLocaleDateString()}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {models
                        .map(
                          (item) => `${item.partNumber} Rev ${item.revision}`
                        )
                        .join(", ")}
                      {drawings > 0 ? ` · ${drawings} drawing(s)` : ""}
                    </p>
                  </div>
                  <HStack spacing={2} className="shrink-0">
                    <ReleaseStateBadge state={release.state} />
                    <Button
                      size="sm"
                      variant={
                        release.state === "pushed" ? "ghost" : "secondary"
                      }
                      onClick={() => onPush(release.releaseId)}
                      isDisabled={
                        !!pushingReleaseId ||
                        locked ||
                        (releases.status === "ready" && !!releases.refreshing)
                      }
                      isLoading={pushingReleaseId === release.releaseId}
                    >
                      {release.state === "pushed"
                        ? "Re-push release"
                        : "Push release"}
                    </Button>
                  </HStack>
                </div>
                {releaseOutcome ? (
                  <div className="mt-1 space-y-1">
                    <PushOutcomeView outcome={releaseOutcome} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Review (plan → apply)
// ---------------------------------------------------------------------------

type ReviewSectionProps<R extends ReviewState> = {
  review: R;
  onCancel: () => void;
  onApply: () => void;
  onReplan: () => void;
  /** A plan request after expiry is in flight. */
  replanning: boolean;
};

/**
 * The push button, pinned to the bottom of the scrolling body, so the number
 * of items about to be written stays in view however long the summary runs.
 */
function ReviewActionBar({
  review,
  replanning,
  onApply
}: {
  review: ReviewState;
  replanning: boolean;
  onApply: () => void;
}) {
  const count = applyCount(review);
  return (
    <div className="sticky bottom-0 -mx-4 mt-1 w-[calc(100%+--spacing(8))] border-t border-border bg-background px-4 py-2">
      <Button
        className="w-full"
        onClick={onApply}
        isDisabled={review.applying || review.expired || count === 0}
        isLoading={review.applying || replanning}
      >
        {count === 0 ? "Nothing to push" : `Push ${count} to Carbon`}
      </Button>
    </div>
  );
}

/** The apply error, with the only way out an expired plan has: plan again. */
function ReviewError({
  review,
  replanning,
  onReplan
}: {
  review: ReviewState;
  replanning: boolean;
  onReplan: () => void;
}) {
  if (!review.error) return null;
  return (
    <Alert variant="destructive">
      <LuTriangleAlert />
      <AlertTitle>Couldn't push</AlertTitle>
      <AlertDescription>{review.error}</AlertDescription>
      {review.expired ? (
        <HStack className="mt-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onReplan}
            isDisabled={replanning}
            isLoading={replanning}
          >
            Review again
          </Button>
        </HStack>
      ) : null}
    </Alert>
  );
}

function toneClass(tone: MethodDescription["tone"]): string {
  if (tone === "warning") return "text-xs text-amber-600 dark:text-amber-400";
  if (tone === "muted") return "text-xs text-muted-foreground";
  return "text-xs";
}

/** Title and Cancel, shared by every review. */
function ReviewHeader({
  busy,
  onCancel
}: {
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <HStack className="w-full justify-between">
      <span className="text-sm font-medium">Review → Carbon</span>
      <Button variant="ghost" size="sm" onClick={onCancel} isDisabled={busy}>
        Cancel
      </Button>
    </HStack>
  );
}

/**
 * What the push will do, in one line of counts.
 *
 * The review is a summary, not a form. Every value it shows comes from
 * Onshape or from the company's push defaults, and the way to change one is
 * to change it there and review again — the panel does not keep a second
 * editor for data Onshape already edits.
 */
function ReviewSummary({ counts }: { counts: Array<[number, string]> }) {
  const parts = counts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  return (
    <p className="w-full text-sm">
      {parts.length > 0 ? parts.join(" · ") : "Nothing to change"}
    </p>
  );
}

/** The settings a created item gets, as one line. */
function proposedSummary(proposed: ProposedItem): string {
  return [
    proposed.replenishmentSystem,
    proposed.defaultMethodType,
    proposed.itemTrackingType,
    proposed.unitOfMeasureCode
  ].join(" · ");
}

/**
 * The mapped custom fields a row will write, read-only. An update or link
 * lists only the owned fields, the emptied ones included: an owned null
 * clears the Carbon value, so the review has to say so.
 */
function RowFields({
  isCreate,
  fields,
  problems
}: {
  isCreate: boolean;
  fields: PlanCustomField[] | undefined;
  problems: string[] | undefined;
}) {
  const shown = (fields ?? []).filter(
    (field) => isCreate || field.mode === "owned"
  );
  if (shown.length === 0 && !problems?.length) return null;
  return (
    <div className="mt-1 w-full">
      {shown.map((field) => (
        <p
          key={field.fieldId}
          className="w-full truncate text-xs text-muted-foreground"
        >
          {isCreate || field.value !== null
            ? `${field.name}: ${customFieldDisplayValue(field)}`
            : `${field.name}: will be cleared`}
        </p>
      ))}
      {/* A value that cannot coerce is reported and skipped, never written. */}
      {problems?.map((problem) => (
        <p
          key={problem}
          className="w-full text-xs text-amber-600 dark:text-amber-400"
        >
          {problem}
        </p>
      ))}
    </div>
  );
}

function PartPlanBadge({ row }: { row: PartPlanRow }) {
  switch (row.action) {
    case "create":
      return (
        <Status color="blue" disableTooltip>
          Create
        </Status>
      );
    case "adopt":
      return (
        <Status color="red" disableTooltip>
          Conflict
        </Status>
      );
    case "update":
      return (
        <Status color="green" disableTooltip>
          Update
        </Status>
      );
    case "unchanged":
      return (
        <Status color="gray" disableTooltip>
          Up to date
        </Status>
      );
    case "skip-no-part-number":
      return (
        <Status color="gray" disableTooltip>
          Skipped
        </Status>
      );
  }
}

function PartReviewSection({
  review,
  onCancel,
  onApply,
  onReplan,
  replanning
}: ReviewSectionProps<PartReview>) {
  const { plan } = review;
  const busy = review.applying || replanning;
  const count = (action: PartPlanRow["action"]) =>
    plan.rows.filter((row) => row.action === action).length;
  const conflicts = plan.rows.filter((row) => row.action === "adopt");

  return (
    <VStack spacing={2} className="w-full">
      <ReviewHeader busy={busy} onCancel={onCancel} />
      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      {plan.rows.length === 0 ? (
        <PanelEmpty>None of the selected parts are in this element</PanelEmpty>
      ) : (
        <>
          <ReviewSummary
            counts={[
              [count("create"), "created"],
              [count("adopt"), "linked"],
              [count("update"), "updated"],
              [count("unchanged"), "up to date"],
              [count("skip-no-part-number"), "skipped"]
            ]}
          />

          {conflicts.length > 0 ? (
            <CappedWarningList
              variant="destructive"
              title={(n) =>
                n === 1
                  ? "1 part shares a part number with an existing Carbon item"
                  : `${n} parts share a part number with an existing Carbon item`
              }
              description="Pushing links them and overwrites their name, description and Onshape-owned custom fields with Onshape's. If any of them is a different part, renumber it in Onshape before pushing."
              lines={conflicts.map(
                (row) =>
                  `${row.partNumber} · ${row.item?.name ?? row.name} in Carbon`
              )}
            />
          ) : null}

          {count("skip-no-part-number") > 0 ? (
            <Alert variant="warning">
              <LuTriangleAlert />
              <AlertTitle>
                {count("skip-no-part-number") === 1
                  ? "1 part has no part number"
                  : `${count("skip-no-part-number")} parts have no part number`}
              </AlertTitle>
              <AlertDescription>
                Set a part number in Onshape, then review again.
              </AlertDescription>
            </Alert>
          ) : null}

          <ul className="w-full divide-y divide-border rounded-md border border-border">
            {plan.rows.map((row) => (
              <li key={row.partId} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm" title={row.name}>
                      {row.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.partNumber ?? "No part number"}
                      {row.revision ? ` · Rev ${row.revision}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <PartPlanBadge row={row} />
                  </div>
                </div>
                {row.action === "create" && row.proposed ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {proposedSummary(row.proposed)}
                  </p>
                ) : null}
                {(row.action === "update" || row.action === "adopt") &&
                row.changes.length > 0 ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {row.changes
                      .map(
                        (change) =>
                          `${change.field}: ${change.from ?? "—"} → ${change.to ?? "—"}`
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {row.action === "create" ||
                row.action === "update" ||
                row.action === "adopt" ? (
                  <RowFields
                    isCreate={row.action === "create"}
                    fields={row.customFields}
                    problems={row.customFieldProblems}
                  />
                ) : null}
              </li>
            ))}
          </ul>

          <ReviewActionBar
            review={review}
            replanning={replanning}
            onApply={onApply}
          />
        </>
      )}
    </VStack>
  );
}

function AssemblyReviewSection({
  review,
  onCancel,
  onApply,
  onReplan,
  replanning
}: ReviewSectionProps<AssemblyReview>) {
  const { plan } = review;
  const busy = review.applying || replanning;

  const created =
    plan.items.filter((item) => item.action === "create").length +
    (plan.root.action === "create" ? 1 : 0);
  const conflicts = [
    ...(plan.root.conflict
      ? [`${plan.root.partNumber} · ${plan.root.name ?? "this assembly"}`]
      : []),
    ...plan.items
      .filter((item) => item.conflict)
      .map((item) =>
        item.name ? `${item.partNumber} · ${item.name}` : item.partNumber
      )
  ];
  const reused =
    plan.items.filter((item) => item.action === "reuse" && !item.conflict)
      .length + (plan.root.action === "reuse" && !plan.root.conflict ? 1 : 0);

  /*
   * What the push will NOT write, and what it writes somewhere that is not
   * live, are both decided before Push — so they sit above it rather than
   * inside the collapsed method list.
   */
  const described = plan.methods.map((method) =>
    describeMethod(method, review.excluded)
  );
  const wontWrite = [
    ...described.filter((d) => d.tone === "warning").map((d) => d.text),
    ...plan.skipped
  ];
  const drafts = described.filter((d) => d.tone === "notice");

  return (
    <VStack spacing={2} className="w-full">
      <ReviewHeader busy={busy} onCancel={onCancel} />
      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      <ReviewSummary
        counts={[
          [created, "created"],
          [conflicts.length, "linked"],
          [reused, "already in Carbon"],
          [
            plan.methods.length,
            plan.methods.length === 1 ? "BOM written" : "BOMs written"
          ]
        ]}
      />

      {conflicts.length > 0 ? (
        <CappedWarningList
          variant="destructive"
          title={(n) =>
            n === 1
              ? "1 part shares a part number with an existing Carbon item"
              : `${n} parts share a part number with an existing Carbon item`
          }
          description={`Pushing links them to these Onshape parts and uses them in the BOM. Any that are assemblies get Onshape's BOM lines written into their make methods${plan.root.conflict ? ", and the assembly's Onshape-owned custom fields are overwritten" : ""}. If any of them is a different part, renumber it in Onshape before pushing.`}
          lines={conflicts}
        />
      ) : null}
      {wontWrite.length > 0 ? (
        <CappedWarningList
          title={(n) =>
            n === 1
              ? "1 thing won't be written"
              : `${n} things won't be written`
          }
          lines={wontWrite}
        />
      ) : null}
      {drafts.length > 0 ? (
        <Alert variant="info">
          <LuInfo />
          <AlertTitle>
            {drafts.length === 1
              ? "1 released method gets a new Draft version"
              : `${drafts.length} released methods get new Draft versions`}
          </AlertTitle>
          <AlertDescription>
            Nothing live changes until someone releases them in Carbon.
          </AlertDescription>
        </Alert>
      ) : null}

      {plan.depth === "top" && plan.deeper ? (
        <Alert variant="info">
          <LuInfo />
          <AlertTitle>
            {plan.deeper.partCount > 0
              ? `This level only — ${plan.deeper.partCount} parts below are not in this push`
              : "This level only"}
          </AlertTitle>
          {plan.deeper.subAssemblies.length > 0 ? (
            <AlertDescription>
              Not included: {plan.deeper.subAssemblies.join(", ")}
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <ul className="w-full divide-y divide-border rounded-md border border-border">
        {/* The root first: it is what is being pushed. */}
        <li className="px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium"
                title={plan.root.name ?? plan.root.partNumber}
              >
                {plan.root.name ?? plan.root.partNumber}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {plan.root.partNumber}
                {plan.root.revision ? ` · Rev ${plan.root.revision}` : ""}
                {" · this assembly"}
              </p>
            </div>
            <div className="shrink-0">
              <ItemActionBadge
                action={plan.root.action === "create" ? "create" : "reuse"}
                conflict={plan.root.conflict}
              />
            </div>
          </div>
          {plan.root.action === "create" && plan.root.proposed ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {proposedSummary(plan.root.proposed)}
            </p>
          ) : null}
          <RowFields
            isCreate={plan.root.action === "create"}
            fields={plan.root.customFields}
            problems={plan.root.customFieldProblems}
          />
        </li>
        {plan.items.map((item) => (
          <li key={item.partNumber} className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className="truncate text-sm"
                  title={item.name ?? item.partNumber}
                >
                  {item.name ?? item.partNumber}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.partNumber}
                  {item.revision ? ` · Rev ${item.revision}` : ""}
                  {item.purchased ? " · purchased" : ""}
                  {item.isAssembly ? " · assembly" : ""}
                </p>
              </div>
              <div className="shrink-0">
                <ItemActionBadge
                  action={item.action === "create" ? "create" : "reuse"}
                  conflict={item.conflict}
                />
              </div>
            </div>
            {item.action === "create" && item.proposed ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {proposedSummary(item.proposed)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <details className="w-full">
        <summary className="cursor-pointer px-1 text-xs font-medium text-muted-foreground">
          Make methods · {plan.methods.length}
        </summary>
        <VStack spacing={1} className="mt-1 w-full">
          {described.map((description, index) => (
            <p
              key={plan.methods[index]?.parentPartNumber ?? index}
              className={toneClass(description.tone)}
            >
              {description.text}
            </p>
          ))}
        </VStack>
      </details>

      <ReviewActionBar
        review={review}
        replanning={replanning}
        onApply={onApply}
      />
    </VStack>
  );
}

function releaseItemLabel(item: ReleasePlanItem): string {
  switch (item.action) {
    case "revision":
      return `Rev ${item.revision} from Rev ${item.baseRevision ?? "?"}`;
    case "create":
      return "new item";
    case "reuse":
      return `already Rev ${item.revision}`;
    case "drawing":
      return `drawing → ${item.partNumber}`;
    case "drawing-unmatched":
      return "drawing has no model item";
  }
}

function ReleasePlanBadge({ item }: { item: ReleasePlanItem }) {
  switch (item.action) {
    case "revision":
      return (
        <Status color="blue" disableTooltip>
          New revision
        </Status>
      );
    case "create":
      return (
        <Status color="blue" disableTooltip>
          Create
        </Status>
      );
    case "reuse":
      return (
        <Status color="green" disableTooltip>
          In Carbon
        </Status>
      );
    case "drawing":
    case "drawing-unmatched":
      return (
        <Status color="gray" disableTooltip>
          Drawing
        </Status>
      );
  }
}

function ReleaseReviewSection({
  review,
  onCancel,
  onApply,
  onReplan,
  replanning
}: ReviewSectionProps<ReleaseReview>) {
  const { plan } = review;
  const busy = review.applying || replanning;
  const count = (action: ReleasePlanItem["action"]) =>
    plan.items.filter((item) => item.action === action).length;
  const childrenCreated = plan.children.filter(
    (child) => child.action === "create"
  ).length;
  const activeCount = plan.items.filter(
    (item) => item.methodStatus === "active"
  ).length;
  /*
   * Fixed behaviour, stated rather than chosen: a release push records a
   * change notice when it creates revisions, and the new revisions become the
   * default. Both follow from the release having been approved in Onshape.
   */
  const outcomes = [
    review.changeNotice
      ? `Records change notice "${review.changeNotice.name}"`
      : null,
    count("revision") + count("create") > 0
      ? "New revisions become the default"
      : null
  ].filter((line): line is string => !!line);

  return (
    <VStack spacing={2} className="w-full">
      <ReviewHeader busy={busy} onCancel={onCancel} />
      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      <p className="w-full text-xs text-muted-foreground">
        {plan.releaseName ?? "Release"}
      </p>
      <ReviewSummary
        counts={[
          [
            count("revision"),
            count("revision") === 1 ? "new revision" : "new revisions"
          ],
          [count("create") + childrenCreated, "created"],
          [count("reuse"), "already in Carbon"]
        ]}
      />
      {outcomes.length > 0 ? (
        <p className="w-full text-xs text-muted-foreground">
          {outcomes.join(" · ")}
        </p>
      ) : null}

      {/*
       * Not a failure: the route deliberately keeps going when a BOM cannot be
       * read, and the apply leaves that method exactly as it is.
       */}
      {review.warnings.length > 0 ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            {review.warnings.length === 1
              ? "Couldn't read 1 BOM from Onshape"
              : `Couldn't read ${review.warnings.length} BOMs from Onshape`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {review.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p className="mt-1">
              Their BOM lines in Carbon will be left as they are. Cancel and
              review again to retry.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {activeCount > 0 ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            {activeCount === 1
              ? "1 item is released in Carbon"
              : `${activeCount} items are released in Carbon`}
          </AlertTitle>
          <AlertDescription>
            This push won't change their BOM lines. Open a change notice in
            Carbon to modify them.
          </AlertDescription>
        </Alert>
      ) : null}

      <ul className="w-full divide-y divide-border rounded-md border border-border">
        {plan.items.map((item) => (
          <li
            key={`${item.elementId}:${item.partNumber}:${item.revision}`}
            className="px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {item.partNumber}
                  <span className="text-muted-foreground">
                    {" "}
                    Rev {item.revision}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {releaseItemLabel(item)}
                </p>
              </div>
              <ReleasePlanBadge item={item} />
            </div>
            {item.methodStatus === "active" ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Released — BOM lines won't change
              </p>
            ) : null}
            {item.action === "create" && item.proposed ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {proposedSummary(item.proposed)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {plan.children.length > 0 ? (
        <VStack spacing={1} className="w-full">
          <span className="text-xs font-medium">
            BOM children not in this release
          </span>
          <ul className="w-full divide-y divide-border rounded-md border border-border">
            {plan.children.map((child) => (
              <li key={child.partNumber} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm"
                      title={child.name ?? child.partNumber}
                    >
                      {child.name ?? child.partNumber}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {child.partNumber}
                      {child.revision ? ` · Rev ${child.revision}` : ""}
                      {child.purchased ? " · purchased" : ""}
                    </p>
                  </div>
                  <ItemActionBadge
                    action={child.action === "create" ? "create" : "reuse"}
                  />
                </div>
                {child.action === "create" && child.proposed ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {proposedSummary(child.proposed)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}

      <ReviewActionBar
        review={review}
        replanning={replanning}
        onApply={onApply}
      />
    </VStack>
  );
}

/**
 * Every state pill in the panel is a `Status`, the app's own state badge —
 * a Badge carrying the state's icon — rather than a bare Badge, so a part's
 * state reads the same here as on the item page it links to.
 *
 * `disableTooltip` throughout: `Status` otherwise wraps each badge in a Radix
 * Tooltip whose content is the label already on screen, and a review can run
 * to hundreds of rows. The panel keeps per-row cost to a checkbox, two lines
 * of text and a badge.
 */
function ReleaseStateBadge({ state }: { state: PanelRelease["state"] }) {
  if (state === "pushed")
    return (
      <Status color="green" disableTooltip>
        In Carbon
      </Status>
    );
  if (state === "partial")
    return (
      <Status color="yellow" disableTooltip>
        Partial
      </Status>
    );
  return (
    <Status color="gray" disableTooltip>
      Not in Carbon
    </Status>
  );
}

/**
 * Linked: pushed from this Onshape part. Conflict: Carbon has an item with the
 * same part number that was never linked to it — equal numbers are not proof
 * of the same part, and a push would write into that item. Unlinked: Carbon
 * has nothing for it, and a push creates it.
 */
function PartStateBadge({ state }: { state: PanelPartStatus["state"] }) {
  if (state === "linked")
    return (
      <Status color="green" disableTooltip>
        Linked
      </Status>
    );
  if (state === "matched")
    return (
      <Status color="red" disableTooltip>
        Conflict
      </Status>
    );
  return (
    <Status color="gray" disableTooltip>
      Unlinked
    </Status>
  );
}

/**
 * Create / Reuse, the two outcomes an assembly or release component has — and
 * Conflict, a reuse found by part number alone.
 */
function ItemActionBadge({
  action,
  conflict
}: {
  action: "create" | "reuse";
  conflict?: boolean;
}) {
  if (action === "reuse" && conflict) {
    return (
      <Status color="red" disableTooltip>
        Conflict
      </Status>
    );
  }
  return action === "create" ? (
    <Status color="blue" disableTooltip>
      Create
    </Status>
  ) : (
    <Status color="green" disableTooltip>
      Reuse
    </Status>
  );
}

/**
 * The whole panel before sign-in: the Carbon mark and the way in, centred.
 *
 * Nothing else belongs here. A lone button in the top-left of an otherwise
 * blank column read as a half-loaded page rather than a deliberate state; the
 * caller centres this in the panel.
 *
 * The mark, the light/dark pair and the `w-24` are lifted from Carbon's own
 * sign-in surfaces (`_oauth+/authorize.tsx`, `_public+/invite.$code.tsx`,
 * `_public+/verify.tsx`) so this reads as the same product asking. It is
 * served from the app's own origin, which the panel is framed from, so the
 * absolute path resolves without the panel bundling an asset of its own.
 */
function PanelSignIn({
  onSignIn,
  disabled
}: {
  onSignIn: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full max-w-[220px] flex-col items-center gap-6">
      <img
        src="/carbon-mark-light.svg"
        alt="Carbon"
        className="w-24 dark:hidden"
      />
      <img
        src="/carbon-mark-dark.svg"
        alt="Carbon"
        className="hidden w-24 dark:block"
      />
      <Button className="w-full" onClick={onSignIn} isDisabled={disabled}>
        Sign in to Carbon
      </Button>
    </div>
  );
}
