// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  HStack,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  LuArrowRight,
  LuChevronRight,
  LuCircleCheck,
  LuCircleDashed,
  LuInfo,
  LuRefreshCw,
  LuTriangleAlert
} from "react-icons/lu";
import { bomParentIndexes, buildBomViewTree, visibleBomRows } from "./bom-view";
import { ItemFieldSelects } from "./ItemFieldSelects";
import type { OnshapePanelContext } from "./messages";
import { isPanelSessionMessage, postApplicationInit } from "./messages";
import type {
  AssemblyPlan,
  AssemblyPlanDepth,
  ItemFieldSnapshot,
  OwnedFieldChange,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan,
  ReleasePlanItem
} from "./plan";
import type {
  PlanCustomField,
  PlanCustomFieldDefinition,
  PropertyMapEntry
} from "./properties";
import { MAPPABLE_VALUE_TYPES, propertyMapEqual } from "./properties";
import type { PanelRelease } from "./releases";
import type {
  ApplyFieldError,
  AssemblyReview,
  PartApplyResult,
  PartReview,
  ReleaseReview,
  ReviewState
} from "./review";
import {
  applyCount,
  applyRequestBody,
  clearFieldErrors,
  createReview,
  customFieldDisplayValue,
  describeMethod,
  indexFieldErrors,
  normalizeWarnings,
  patchPartStatuses,
  replenishmentMismatches
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
 * nothing moves. Only a first read has nothing to show, and that is the one
 * case that draws a skeleton.
 */
/**
 * Why a read failed. `forbidden` is the one failure a Retry cannot fix: it
 * renders as a warning naming the permission problem, with no Retry to press.
 */
type LoadFailure = { message: string; forbidden: boolean };

/*
 * `refreshFailure` is a Refresh that failed while rows were already on screen.
 * The rows stay.
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
      /** False when the connected Onshape account is in no company. */
      releaseManagementAvailable?: boolean;
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
    }
  | { status: "error"; message: string; forbidden?: boolean };

/**
 * The panel's pages. `push` is the current element — an assembly or a part
 * studio; `releases` is the whole document, which is why it survives on an
 * element that has nothing to push; `fields` is the company's property map,
 * edited from the current element's properties.
 */
type PanelTab = "push" | "releases" | "fields";

/** A property of the current element as the fields route lists it. */
type PanelFieldsProperty = {
  propertyId: string;
  name: string;
  valueType: string;
  /** Whether the value type has a Carbon type to map onto. */
  mappable: boolean;
};

type PanelFieldsData = {
  properties: PanelFieldsProperty[];
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
};

/** One entry of the draft map the Fields page posts. */
type FieldsDraftEntry = {
  onshapePropertyId: string;
  onshapeName: string;
  valueType: string;
  carbonFieldId: string;
};

type PanelFieldsState =
  | { status: "closed" }
  | { status: "loading" }
  | {
      status: "ready";
      data: PanelFieldsData;
      /**
       * The WHOLE next map, not just this element's rows: the save is a full
       * replacement, so entries mapped from other elements must ride along
       * untouched or saving here would silently unmap them.
       */
      entries: FieldsDraftEntry[];
      saving: boolean;
      refreshing?: boolean;
      refreshFailure?: LoadFailure;
      error: string | null;
      /**
       * The save landed but the field list could not be re-read. Not an
       * error: the map is saved, and only the editor's options may be stale.
       */
      warning?: string;
      /** Per-property 422 errors, keyed by onshapePropertyId. */
      fieldErrors: Record<string, string[]>;
    }
  | { status: "error"; message: string; forbidden?: boolean };

/** Radix Select refuses an empty item value, so "not mapped" is named. */
const FIELDS_NOT_MAPPED = "__not-mapped__";

/**
 * The Carbon types an Onshape value type may map onto. MAPPABLE_VALUE_TYPES
 * is a plain object, so a valueType of "constructor" would otherwise resolve
 * to Object.prototype's and crash the render on `.includes`.
 */
function mappableTypesFor(valueType: string): readonly number[] {
  if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, valueType)) return [];
  return MAPPABLE_VALUE_TYPES[valueType] ?? [];
}

/** The draft entries for a map, dropping the display-only mode. */
function fieldsDraft(map: PropertyMapEntry[]): FieldsDraftEntry[] {
  return map.map(
    ({ onshapePropertyId, onshapeName, valueType, carbonFieldId }) => ({
      onshapePropertyId,
      onshapeName,
      valueType,
      carbonFieldId
    })
  );
}

export type OnshapePanelPaths = {
  /** Popup route that mints a panel session for the signed-in user. */
  auth: string;
  /** Returns who the token belongs to. */
  me: string;
  /** GET: the element's Onshape properties, the map and the custom fields. POST: save the map. */
  fields: string;
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
  /** Settings update: the Fields page is shown only to users who hold it. */
  canEditFields: boolean;
};

type SessionState =
  | { status: "unknown" }
  /**
   * `popupBlocked`: the browser refused the sign-in window. That is still the
   * signed-out state — the way forward is the same button — not a Carbon
   * error.
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
  /** Lines added by hand that now follow Onshape. */
  linesTakenOver?: number;
  /** Reused items whose descriptions now match Onshape. */
  descriptionsUpdated?: number;
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

/** What happened to one part, with its severity carried alongside the words. */
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
  rows: Array<{ partId: string; partNumber: string | null }>
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
      .map((r) => `${label(r)}: ${r.message ?? "failed"}`)
  };
}

/**
 * What a push did. `text` is the counts, `skipped` the deliberate omissions,
 * `errors` the things that did not go through. They are kept apart because a
 * joined string renders a partial failure exactly like a clean push.
 */
type PushOutcome = {
  text: string;
  skipped: string[];
  errors: string[];
  /**
   * Things that went through but the user has to know about — a released
   * method superseded by a Draft version (not live until released), or lines
   * added by hand that now follow Onshape.
   */
  notes?: string[];
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function assemblyOutcomeText(s: AssemblyPushSummary): PushOutcome {
  const unchanged = s.linesUnchanged ?? 0;
  // A push that changed nothing should say so. "0 BOM lines" reads as a
  // failure; "42 already up to date" reads as the no-op it was.
  const lines =
    s.linesWritten === 0 && unchanged > 0
      ? `${plural(unchanged, "BOM line")} already up to date`
      : plural(s.linesWritten, "BOM line") +
        (unchanged > 0 ? ` (${unchanged} unchanged)` : "");
  const text =
    `${plural(s.itemsCreated, "item")} created, ${s.itemsReused} reused, ` +
    `${lines} across ${plural(s.methodsTouched, "method")}`;
  const drafts = s.draftVersionsCreated ?? [];
  const takenOver = s.linesTakenOver ?? 0;
  const described = s.descriptionsUpdated ?? 0;
  return {
    text,
    skipped: s.skipped,
    errors: s.errors,
    notes: [
      ...(drafts.length > 0
        ? [`New Draft version, not yet live: ${drafts.join(", ")}`]
        : []),
      ...(described > 0
        ? [
            `${plural(described, "item")} now ${described === 1 ? "has" : "have"} Onshape's short and long descriptions`
          ]
        : []),
      ...(takenOver > 0
        ? [
            `${plural(takenOver, "line")} added by hand in Carbon now ${takenOver === 1 ? "follows" : "follow"} Onshape`
          ]
        : [])
    ]
  };
}

function releaseOutcomeText(s: ReleasePushSummary): PushOutcome {
  // Skipped items are not appended to this line: it becomes the title of a
  // success alert. They render as their own warning.
  const text = s.alreadyPushed
    ? "Revisions already in Carbon — BOMs refreshed"
    : `${s.revisionsCreated} revisions + ${s.itemsCreated} new items, ` +
      `${s.linesWritten} BOM lines` +
      (s.changeNotice ? ` · change notice ${s.changeNotice}` : "");
  return { text, skipped: s.skipped, errors: s.errors };
}

function failedOutcome(message: string): PushOutcome {
  return { text: "", skipped: [], errors: [message] };
}

/**
 * A push that finished is as much news as a push that failed, so it gets the
 * same weight.
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
        // Each note says what it is: a Draft version is not live yet, a
        // taken-over line is. One heading for both would misstate one of them.
        <Alert variant="info">
          <LuInfo />
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

function PanelLoading({ children }: { children: ReactNode }) {
  return (
    <HStack spacing={2} className="w-full text-sm text-muted-foreground">
      <Spinner size={12} />
      <span>{children}</span>
    </HStack>
  );
}

/** A list being read for the first time, in the shape it will take. */
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
 * the same fastener dozens of times. Identical lines fold into one with a
 * count, and only the first few show until asked. The title counts
 * occurrences, since that is what the push leaves out.
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
 * A read that failed, in the one shape every section uses. `stale` marks a
 * failed Refresh over rows that are still on screen, which must say those rows
 * are the old ones.
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

/** The Carbon panel Onshape embeds in its element right panel. */
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
  /** The part push's section-level result: counts and problems. */
  const [partsOutcome, setPartsOutcome] = useState<PushOutcome | null>(null);

  const [tab, setTab] = useState<PanelTab>("push");

  // Loaded when the page is opened.
  const [fields, setFields] = useState<PanelFieldsState>({ status: "closed" });

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
    // The Fields page lists THIS element's properties.
    setFields({ status: "closed" });
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
      setFields({ status: "closed" });
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
        // A configured part's part number, and so its identity in Carbon,
        // depends on the configuration the element is open in.
        if (context.configuration) {
          query.set("configuration", context.configuration);
        }
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
          | { releases: PanelRelease[]; releaseManagementAvailable?: boolean }
          | { error: string };
        if (!response.ok || "error" in body) {
          fail(
            "error" in body ? body.error : `Carbon answered ${response.status}`,
            response.status === 403
          );
          return;
        }
        setReleases({
          status: "ready",
          releases: body.releases,
          releaseManagementAvailable: body.releaseManagementAvailable
        });
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
  // our own popup (session token).
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
       * arrives as query parameters. The branch exists so an Onshape message
       * can never be read as a session token below.
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
   * opens the review.
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
            configuration: context.configuration,
            partIds
          })
        });
        const body = (await response.json()) as
          | PlanResponse<PartPlan>
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          // One failure, so one alert.
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
   * The whole tree by default. `top` is offered only when the route refuses
   * the whole tree as too large. The refusal counts distinct part numbers
   * across the WHOLE tree whatever is already in Carbon, so pushing
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
            configuration: context.configuration,
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
   * rows; a 410 means the plan expired and only a new review can continue. A
   * part apply patches the list from the results instead of re-reading
   * Onshape; assembly and release reload.
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
        // No timeout: the push keeps writing after the panel stops waiting,
        // and its plan is spent, so a timeout would misreport it as failed.
        const response = await panelFetch(
          token,
          path,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(applyRequestBody(current))
          },
          null
        );
        const body = (await response.json()) as
          | { results: PartApplyResult[] }
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
          setPartsOutcome(partsOutcomeText(results, current.plan.rows));
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

  /**
   * Record a manufacturing-field edit for one review row, keyed as the plan is
   * (partId for parts, part number for assemblies and releases). Merged sparsely
   * over any edit already there; the apply diffs against the live value, so a
   * value set back to its original writes nothing. For a part review the row is
   * also selected — editing a linked/unchanged row is intent to push it, and it
   * would otherwise be unticked and its edit dropped by `applyRequestBody`.
   */
  const editItem = useCallback(
    (key: string, patch: Partial<ItemFieldSnapshot>) => {
      setReview((current) => {
        if (!current) return current;
        const edits = {
          ...current.edits,
          [key]: { ...(current.edits[key] ?? {}), ...patch }
        };
        if (current.kind === "part") {
          const selected = new Set(current.selected);
          selected.add(key);
          return { ...current, edits, selected };
        }
        return { ...current, edits };
      });
    },
    []
  );

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

  const loadFields = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      /*
       * Every landing commits only while this read is still the one the page
       * is waiting for: a move to another element leaves `closed` behind and
       * must not be undone when the answer arrives. A Refresh keeps the
       * previous rows on screen and so stays `ready` with `refreshing` set.
       */
      const fail = (message: string, forbidden: boolean) =>
        setFields((current) =>
          current.status === "ready" && current.refreshing
            ? {
                ...current,
                refreshing: false,
                refreshFailure: { message, forbidden }
              }
            : current.status === "loading"
              ? { status: "error", message, forbidden }
              : current
        );
      setFields((current) =>
        current.status === "ready"
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
        const response = await panelFetch(token, `${paths.fields}?${query}`);
        const body = (await response.json()) as
          | PanelFieldsData
          | { error: string };
        if (!response.ok || "error" in body) {
          fail(
            "error" in body ? body.error : `Carbon answered ${response.status}`,
            response.status === 403
          );
          return;
        }
        setFields((current) =>
          current.status === "loading" ||
          (current.status === "ready" && !!current.refreshing)
            ? {
                status: "ready",
                data: body,
                // A re-read is the company's map as it now stands, so it
                // replaces the draft rather than merging with it.
                entries: fieldsDraft(body.map),
                saving: false,
                error: null,
                fieldErrors: {}
              }
            : current
        );
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        fail(thrownMessage(error), false);
      }
    },
    [canLoadParts, context, paths.fields]
  );

  /**
   * Save the property map. A 422 pins errors to properties; success re-seeds
   * the draft from what the server now holds, so nothing is left to save.
   */
  const saveFields = useCallback(
    async (token: string) => {
      if (fields.status !== "ready" || fields.saving) return;
      const current = fields;
      setFields({
        ...current,
        saving: true,
        error: null,
        warning: undefined,
        fieldErrors: {}
      });
      // Lands only on the save still in flight: a move to another element
      // resets the page to `closed`, which must not be undone by the answer.
      const land = (next: PanelFieldsState) =>
        setFields((latest) =>
          latest.status === "ready" && latest.saving ? next : latest
        );
      try {
        const response = await panelFetch(token, paths.fields, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: current.entries })
        });
        const body = (await response.json()) as
          | {
              map: PropertyMapEntry[];
              definitions: PlanCustomFieldDefinition[] | null;
              warning?: string;
            }
          | PanelErrorResponse;
        if (!response.ok || "error" in body) {
          land({
            ...current,
            saving: false,
            error:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`,
            fieldErrors:
              response.status === 422 && "fieldErrors" in body
                ? indexFieldErrors(body.fieldErrors)
                : {}
          });
          return;
        }
        land({
          ...current,
          data: {
            ...current.data,
            map: body.map,
            // Null when the save landed but the re-read failed: keep the
            // definitions already on screen rather than emptying every select.
            definitions: body.definitions ?? current.data.definitions
          },
          entries: fieldsDraft(body.map),
          saving: false,
          error: null,
          warning: body.warning,
          fieldErrors: {}
        });
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        land({ ...current, saving: false, error: thrownMessage(error) });
      }
    },
    [fields, paths.fields]
  );

  /** Map one property to a field, or unmap it; every other entry survives. */
  const mapFieldsProperty = (
    property: PanelFieldsProperty,
    selection: string
  ) =>
    setFields((current) => {
      if (current.status !== "ready") return current;
      const entries = current.entries.filter(
        (entry) => entry.onshapePropertyId !== property.propertyId
      );
      if (selection !== FIELDS_NOT_MAPPED) {
        entries.push({
          onshapePropertyId: property.propertyId,
          onshapeName: property.name,
          valueType: property.valueType,
          carbonFieldId: selection
        });
      }
      return {
        ...current,
        entries,
        error: null,
        fieldErrors: clearFieldErrors(current.fieldErrors, property.propertyId)
      };
    });

  /*
   * Not every page applies to every element. A drawing has no parts, but it
   * belongs to a document that has releases. Fields needs an element with
   * properties to list, and settings update to save.
   */
  const availableTabs = useMemo<PanelTab[]>(() => {
    if (session.status !== "signed-in") return [];
    const tabs: PanelTab[] = [];
    if (canLoadParts) tabs.push("push");
    if (context.documentId) tabs.push("releases");
    if (
      canLoadParts &&
      session.me.canEditFields &&
      (parts.status === "ready" || parts.status === "ready-assembly")
    ) {
      tabs.push("fields");
    }
    return tabs;
  }, [session, canLoadParts, context.documentId, parts.status]);

  // Opening the Fields page is what loads it, so a panel that never opens it
  // spends no Onshape reads on it.
  useEffect(() => {
    if (tab !== "fields" || session.status !== "signed-in") return;
    if (fields.status === "closed") void loadFields(session.token);
  }, [tab, session, fields.status, loadFields]);

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
   * there is a session. Returning here rather than threading the empty Tabs
   * shell around it is what lets the block own the full height.
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
        (value === "push" || value === "releases" || value === "fields") &&
        setTab(value)
      }
      className="flex h-full min-h-0 flex-col"
    >
      {/*
       * The company is not cosmetic — a user in more than one has no other
       * way to tell where a push will land.
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
            {availableTabs.includes("fields") ? (
              <TabsTrigger value="fields">Fields</TabsTrigger>
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
                where the title will be, and the list's own shape below it. */}
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
                    onEditItem={editItem}
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
                  onEditItem={editItem}
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
                onEditItem={editItem}
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

        <TabsContent value="fields" className="w-full">
          {session.status === "signed-in" && fields.status !== "closed" ? (
            <FieldsSection
              state={fields}
              onMap={mapFieldsProperty}
              onRefresh={() => loadFields(session.token)}
              onSave={() => saveFields(session.token)}
            />
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
  refreshing: boolean;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  outcome: PushOutcome | null;
  tooLarge: string | null;
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
 * Structured opens at the top level only, and a sub-assembly says how many
 * lines it is hiding.
 *
 * Open sub-assemblies are tracked rather than collapsed ones, the opposite of
 * the ERP's `TreeView`: a set of open indexes is what survives a refresh
 * cleanly — a BOM that changed underneath keeps whatever indexes still exist
 * and silently drops the rest.
 */
function AssemblyBomList({
  lines,
  disabled
}: {
  lines: PanelAssemblyLine[];
  /* A re-read is in flight, so the rows on screen are about to be replaced. */
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
                     one column. */
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

function BomLineText({
  line,
  quantity,
  note
}: {
  line: PanelAssemblyLine;
  /** Per-parent. */
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
        {line.state === "matched" ? " · number already used in Carbon" : ""}
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
        <PanelEmpty>
          {releases.releaseManagementAvailable === false
            ? "No releases. Releases need an Onshape company account; a revision letter on a part is only a property."
            : "No releases yet"}
        </PanelEmpty>
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
// Fields (Onshape properties → Carbon custom fields)
// ---------------------------------------------------------------------------

/**
 * The company's property map, edited from the current element's properties.
 * Onshape only lists properties from inside a document, which is why this
 * page is the one setting the panel keeps.
 */
function FieldsSection({
  state,
  onMap,
  onRefresh,
  onSave
}: {
  state: Exclude<PanelFieldsState, { status: "closed" }>;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onRefresh: () => void;
  onSave: () => void;
}) {
  const header = (
    <HStack className="w-full justify-between">
      <span className="text-sm font-medium">Custom fields</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        isDisabled={
          state.status === "loading" ||
          (state.status === "ready" && state.saving)
        }
        isLoading={state.status === "ready" && !!state.refreshing}
        leftIcon={<LuRefreshCw />}
      >
        Refresh
      </Button>
    </HStack>
  );

  if (state.status === "loading") {
    return (
      <VStack spacing={2} className="w-full">
        {header}
        <FieldsColumnLabels />
        <PanelListSkeleton />
      </VStack>
    );
  }
  if (state.status === "error") {
    return (
      <VStack spacing={2} className="w-full">
        {header}
        <PanelLoadError
          title="Couldn't load properties"
          failure={{ message: state.message, forbidden: !!state.forbidden }}
          onRetry={onRefresh}
        />
      </VStack>
    );
  }

  const { data } = state;
  const entryFor = (propertyId: string) =>
    state.entries.find((entry) => entry.onshapePropertyId === propertyId);
  /*
   * Only what the user can act on: a USER, BLOB or computed property has no
   * Carbon field it can coerce into. An already-mapped property stays listed
   * even if its type is not mappable, since the save posts the whole map and
   * hiding the entry would leave it riding along with no way to remove it.
   */
  const visibleProperties = data.properties.filter(
    (property) => property.mappable || !!entryFor(property.propertyId)
  );
  // The save posts the whole map, so a 422 can name a property mapped from
  // another element. It has no row here, so it renders on its own.
  const rendered = new Set(
    visibleProperties.map((property) => property.propertyId)
  );
  const otherElementErrors = Object.entries(state.fieldErrors)
    .filter(([propertyId]) => !rendered.has(propertyId))
    .map(([propertyId, messages]) => ({
      propertyId,
      name: entryFor(propertyId)?.onshapeName || propertyId,
      messages
    }));
  const dirty = !propertyMapEqual(state.entries, data.map);
  const busy = state.saving || !!state.refreshing;

  return (
    <VStack spacing={2} className="w-full">
      {header}
      <p className="text-xs text-muted-foreground">
        Every push writes a mapped property into its Carbon field. Mappings are
        for the whole company, not this element.
      </p>
      {state.refreshFailure ? (
        <PanelLoadError
          title="Couldn't refresh properties"
          failure={state.refreshFailure}
          stale
          retrying={!!state.refreshing}
          onRetry={onRefresh}
        />
      ) : null}
      {state.warning ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>Custom field list may be out of date</AlertTitle>
          <AlertDescription>{state.warning}</AlertDescription>
        </Alert>
      ) : null}
      {state.error ? (
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>Couldn't save the map</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {otherElementErrors.map(({ propertyId, name, messages }) =>
        messages.map((message) => (
          <p
            key={`${propertyId}:${message}`}
            className="w-full text-xs text-destructive"
          >
            {name}: {message}
          </p>
        ))
      )}
      {visibleProperties.length === 0 ? (
        <PanelEmpty>No mappable properties</PanelEmpty>
      ) : (
        <>
          <FieldsColumnLabels />
          <div className="w-full rounded-lg border border-border">
            <ul className="flex w-full flex-col divide-y divide-border">
              {visibleProperties.map((property) => (
                <FieldsRow
                  key={property.propertyId}
                  property={property}
                  entry={entryFor(property.propertyId)}
                  definitions={data.definitions}
                  errors={state.fieldErrors[property.propertyId]}
                  disabled={busy}
                  onMap={onMap}
                />
              ))}
            </ul>
          </div>
        </>
      )}
      {/* Pinned like a review's push button; see ReviewActionBar. */}
      <div className="sticky -bottom-4 -mx-4 mt-1 w-[calc(100%+--spacing(8))] border-t border-border bg-card px-4 py-2">
        <Button
          className="w-full"
          onClick={onSave}
          isDisabled={!dirty || busy}
          isLoading={state.saving}
        >
          {dirty ? "Save mappings" : "No changes"}
        </Button>
      </div>
    </VStack>
  );
}

const FIELDS_CONTROL_WIDTH = "w-[180px]";

function FieldsColumnLabels() {
  return (
    <div className="flex w-full items-center gap-3 px-3">
      <Label className="min-w-0 flex-1">Onshape property</Label>
      {/* Spacer for the rows' arrow, so the labels sit over their columns. */}
      <span aria-hidden className="size-4 shrink-0" />
      <Label className={cn("shrink-0", FIELDS_CONTROL_WIDTH)}>
        Carbon custom field
      </Label>
    </div>
  );
}

function FieldsRow({
  property,
  entry,
  definitions,
  errors,
  disabled,
  onMap
}: {
  property: PanelFieldsProperty;
  entry: FieldsDraftEntry | undefined;
  definitions: PlanCustomFieldDefinition[];
  errors: string[] | undefined;
  disabled: boolean;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
}) {
  // Only fields of a type the value can coerce into are offered; an already
  // mapped field stays listed even when its type no longer matches, so the
  // current mapping is visible rather than a blank select.
  const allowed = mappableTypesFor(property.valueType);
  const options = definitions.filter(
    (definition) =>
      allowed.includes(definition.dataTypeId) ||
      definition.id === entry?.carbonFieldId
  );
  // A mapping whose Carbon field has since been deleted has no definition to
  // name it, so it shows as a disabled option the user can map away from.
  const deletedFieldId =
    entry?.carbonFieldId &&
    !options.some((definition) => definition.id === entry.carbonFieldId)
      ? entry.carbonFieldId
      : null;
  return (
    <li className="flex w-full flex-col gap-1 px-3 py-2">
      <div className="flex w-full items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium" title={property.name}>
            {property.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {property.valueType}
            {property.mappable ? null : " · no Carbon type to map onto"}
          </span>
        </div>
        <LuArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <div className={cn("shrink-0", FIELDS_CONTROL_WIDTH)}>
          <Select
            value={entry?.carbonFieldId ?? FIELDS_NOT_MAPPED}
            onValueChange={(value) => onMap(property, value)}
            disabled={disabled}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={`Map ${property.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FIELDS_NOT_MAPPED}>Not mapped</SelectItem>
              {options.map((definition) => (
                <SelectItem key={definition.id} value={definition.id}>
                  {definition.name}
                </SelectItem>
              ))}
              {deletedFieldId ? (
                <SelectItem value={deletedFieldId} disabled>
                  Deleted field
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>
      {errors?.map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </li>
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
  onEditItem: (key: string, patch: Partial<ItemFieldSnapshot>) => void;
  /** A plan request after expiry is in flight. */
  replanning: boolean;
};

/**
 * The push button, pinned to the bottom of the scrolling body.
 *
 * `-bottom-4` cancels the body's `p-4`: sticky pins to the scrollport inset by
 * its padding, so `bottom-0` left a 16px strip below the bar where rows
 * scrolled past. It is the last child of every review, so nothing sits in
 * that padding at the end of the list.
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
    <div className="sticky -bottom-4 -mx-4 mt-1 w-[calc(100%+--spacing(8))] border-t border-border bg-card px-4 py-2">
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

/** What the push will do, in one line of counts. */
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

/**
 * What the three manufacturing dropdowns start from: the item's current values
 * for anything Carbon already has, else the proposal a create would write.
 * Null for a row that resolves to no item (a skip, a drawing).
 */
function fieldBaseline(row: {
  proposed?: ProposedItem | null;
  current?: ItemFieldSnapshot | null;
}): ItemFieldSnapshot | null {
  if (row.current) return row.current;
  if (row.proposed) {
    return {
      replenishmentSystem: row.proposed.replenishmentSystem,
      defaultMethodType: row.proposed.defaultMethodType,
      itemTrackingType: row.proposed.itemTrackingType
    };
  }
  return null;
}

/** Carbon's labels for the two item texts Onshape owns. */
const TEXT_FIELD_LABEL: Record<OwnedFieldChange["field"], string> = {
  name: "short description",
  description: "long description"
};

function textChangeLine(changes: OwnedFieldChange[]): string {
  return changes
    .map(
      (change) =>
        `${TEXT_FIELD_LABEL[change.field]}: ${change.from ?? "—"} → ${change.to ?? "—"}`
    )
    .join(" · ");
}

/** The Short and Long Descriptions a push overwrites, read-only. */
function TextChanges({ changes }: { changes: OwnedFieldChange[] | undefined }) {
  if (!changes?.length) return null;
  const line = textChangeLine(changes);
  return (
    <p className="mt-1 truncate text-xs text-muted-foreground" title={line}>
      {line}
    </p>
  );
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
  onEditItem,
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
              description="Pushing links them and overwrites their short and long descriptions and Onshape-owned custom fields with Onshape's. If any of them is a different part, renumber it in Onshape before pushing."
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
              <li key={row.partId} className="bg-card px-3 py-2">
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
                {row.action === "update" || row.action === "adopt" ? (
                  <TextChanges changes={row.changes} />
                ) : null}
                {(() => {
                  const baseline = fieldBaseline(row);
                  return baseline ? (
                    <ItemFieldSelects
                      baseline={baseline}
                      edit={review.edits[row.partId]}
                      disabled={busy}
                      onChange={(patch) => onEditItem(row.partId, patch)}
                    />
                  ) : null;
                })()}
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
  onEditItem,
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

  const described = plan.methods.map((method) =>
    describeMethod(method, review.excluded)
  );
  const wontWrite = [
    ...described.filter((d) => d.tone === "warning").map((d) => d.text),
    ...plan.skipped
  ];
  const drafts = plan.methods.filter(
    (_, index) => described[index]?.tone === "notice"
  );
  const newDrafts = drafts.filter(
    (method) => method.reusedDraftVersion == null
  ).length;
  // Lines added by hand in Carbon: one for a part Onshape also lists is taken
  // over (its quantity follows Onshape, its operation and scrap stay); one for
  // a part Onshape doesn't list stays, so that BOM won't match Onshape.
  // An excluded part's line is not taken over, so it stays.
  const writtenMethods = plan.methods.filter(
    (method) =>
      method.status !== "missing" &&
      !review.excluded.has(method.parentPartNumber)
  );
  const takenOver = writtenMethods.flatMap((method) =>
    method.takesOver
      .filter((line) => !review.excluded.has(line.readableId))
      .map(
        (line) =>
          `${method.parentPartNumber}: ${line.readableId} ×${line.quantity}` +
          (line.quantity === line.onshapeQuantity
            ? ", quantity unchanged"
            : ` → ×${line.onshapeQuantity}`)
      )
  );
  const textChanges = [
    ...(plan.root.changes?.length && !review.excluded.has(plan.root.partNumber)
      ? [`${plan.root.partNumber}: ${textChangeLine(plan.root.changes)}`]
      : []),
    ...plan.items
      .filter(
        (item) => item.changes?.length && !review.excluded.has(item.partNumber)
      )
      .map(
        (item) => `${item.partNumber}: ${textChangeLine(item.changes ?? [])}`
      )
  ];
  const buyOrMake = replenishmentMismatches(
    plan,
    review.edits,
    review.excluded
  );
  const keptManual = writtenMethods.flatMap((method) =>
    [
      ...method.keeps,
      ...method.takesOver.filter((line) => review.excluded.has(line.readableId))
    ].map(
      (line) =>
        `${method.parentPartNumber}: ${line.readableId} ×${line.quantity}`
    )
  );

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
          [conflicts.length, "matched by part number"],
          [reused, "already in Carbon"],
          [plan.methods.length, plan.methods.length === 1 ? "BOM" : "BOMs"]
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
          description={`The push uses them in the BOM. The assembly being pushed and any part not yet linked to Onshape are linked to these Onshape parts; a part already linked to another Onshape part keeps that link. Any that are assemblies get Onshape's BOM lines written into their make methods${plan.root.conflict ? ", and the assembly's Onshape-owned custom fields are overwritten" : ""}. If any of them is a different part, renumber it in Onshape before pushing.`}
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
            {newDrafts === drafts.length
              ? drafts.length === 1
                ? "1 released method gets a new Draft version"
                : `${drafts.length} released methods get new Draft versions`
              : newDrafts === 0
                ? drafts.length === 1
                  ? "1 released method is written into its Draft version"
                  : `${drafts.length} released methods are written into their Draft versions`
                : `${drafts.length} released methods are written into Draft versions, ${newDrafts} of them new`}
          </AlertTitle>
          <AlertDescription>
            Nothing live changes until someone releases them in Carbon.
          </AlertDescription>
        </Alert>
      ) : null}

      {buyOrMake.length > 0 ? (
        <CappedWarningList
          title={(n) =>
            n === 1
              ? "1 item's Buy or Make doesn't match Onshape"
              : `${n} items' Buy or Make doesn't match Onshape`
          }
          description="Carbon decides Buy or Make for an item it already has. Change Replenishment on the item below, or the sub-assembly's Subassembly BOM behavior in Onshape."
          lines={buyOrMake}
        />
      ) : null}

      {textChanges.length > 0 ? (
        <CappedWarningList
          title={(n) =>
            n === 1
              ? "1 item takes Onshape's short and long descriptions"
              : `${n} items take Onshape's short and long descriptions`
          }
          description="These items are linked to their Onshape parts, so their descriptions are managed in Onshape from now on."
          lines={textChanges}
        />
      ) : null}

      {takenOver.length > 0 ? (
        <CappedWarningList
          title={(n) =>
            n === 1
              ? "1 line added by hand in Carbon will follow Onshape"
              : `${n} lines added by hand in Carbon will follow Onshape`
          }
          description="Onshape's BOM lists these parts too, so the push updates each line to Onshape's quantity instead of adding a second one. Its operation and scrap stay, and later pushes keep it in step with Onshape."
          lines={takenOver}
        />
      ) : null}

      {keptManual.length > 0 ? (
        <CappedWarningList
          title={(n) =>
            n === 1
              ? "1 line added by hand in Carbon stays"
              : `${n} lines added by hand in Carbon stay`
          }
          description="Onshape's BOM doesn't list these parts, so the push leaves them and these BOMs won't match Onshape."
          lines={keptManual}
        />
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
        <li className="bg-card px-3 py-2">
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
            {/* Create/Reuse is not actionable, so it is not shown. */}
            {plan.root.conflict ? (
              <div className="shrink-0">
                <ItemActionBadge action="reuse" conflict />
              </div>
            ) : null}
          </div>
          {(() => {
            const baseline = fieldBaseline(plan.root);
            return baseline ? (
              <ItemFieldSelects
                baseline={baseline}
                edit={review.edits[plan.root.partNumber]}
                disabled={busy}
                onChange={(patch) => onEditItem(plan.root.partNumber, patch)}
              />
            ) : null;
          })()}
          <TextChanges changes={plan.root.changes} />
          <RowFields
            isCreate={plan.root.action === "create"}
            fields={plan.root.customFields}
            problems={plan.root.customFieldProblems}
          />
        </li>
        {plan.items.map((item) => (
          <li key={item.partNumber} className="bg-card px-3 py-2">
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
                  {item.shownAsUnit
                    ? " · purchased (Show Assembly only)"
                    : item.purchased
                      ? " · purchased"
                      : ""}
                  {item.isAssembly ? " · assembly" : ""}
                </p>
              </div>
              {item.conflict ? (
                <div className="shrink-0">
                  <ItemActionBadge action="reuse" conflict />
                </div>
              ) : null}
            </div>
            <TextChanges changes={item.changes} />
            {(() => {
              const baseline = fieldBaseline(item);
              return baseline ? (
                <ItemFieldSelects
                  baseline={baseline}
                  edit={review.edits[item.partNumber]}
                  disabled={busy}
                  onChange={(patch) => onEditItem(item.partNumber, patch)}
                />
              ) : null;
            })()}
          </li>
        ))}
      </ul>

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
  onEditItem,
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
            className="bg-card px-3 py-2"
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
            {(() => {
              const baseline = fieldBaseline(item);
              return baseline ? (
                <ItemFieldSelects
                  baseline={baseline}
                  edit={review.edits[item.partNumber]}
                  disabled={busy}
                  onChange={(patch) => onEditItem(item.partNumber, patch)}
                />
              ) : null;
            })()}
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
              <li key={child.partNumber} className="bg-card px-3 py-2">
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
                {(() => {
                  const baseline = fieldBaseline(child);
                  return baseline ? (
                    <ItemFieldSelects
                      baseline={baseline}
                      edit={review.edits[child.partNumber]}
                      disabled={busy}
                      onChange={(patch) => onEditItem(child.partNumber, patch)}
                    />
                  ) : null;
                })()}
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
 * Every state pill in the panel is a `Status`, so a part's state reads the
 * same here as on the item page it links to.
 *
 * `disableTooltip` throughout: `Status` otherwise wraps each badge in a Radix
 * Tooltip whose content is the label already on screen, and a review can run
 * to hundreds of rows.
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
      <Status
        color="red"
        tooltip="Carbon already has an item with this part number, not linked to this one in Onshape. Pushing uses that item."
      >
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
 * The whole panel before sign-in: the Carbon mark and the way in.
 *
 * The mark is served from the app's own origin, which the panel is framed
 * from, so the absolute path resolves without the panel bundling an asset of
 * its own.
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
