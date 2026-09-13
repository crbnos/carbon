import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  HStack,
  Input,
  Label,
  PulsingDot,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Status,
  Subheading,
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
import {
  bomParentIndexes,
  buildBomViewTree,
  flattenBomView,
  visibleBomRows
} from "./bom-view";
import type { OnshapePanelContext } from "./messages";
import { isPanelSessionMessage, postApplicationInit } from "./messages";
import type {
  AssemblyPlan,
  AssemblyPlanDepth,
  ItemEdit,
  PartPlan,
  PartPlanRow,
  PlanOptions,
  ProposedItem,
  ReleasePlan,
  ReleasePlanItem
} from "./plan";
import { ITEM_REPLENISHMENT_SYSTEMS, ITEM_TRACKING_TYPES } from "./plan";
import type { OnshapePushDefaults } from "./preferences";
import { pushDefaultsEqual, reconcilePushDefaults } from "./preferences";
import type {
  PlanCustomField,
  PlanCustomFieldDefinition,
  PropertyMapEntry,
  UnmappedProperty
} from "./properties";
import {
  CUSTOM_FIELD_DATA_TYPES,
  MAPPABLE_VALUE_TYPES,
  propertyMapEqual
} from "./properties";
import type { PanelRelease } from "./releases";
import type {
  ApplyFieldError,
  AssemblyReview,
  EditableItemField,
  MethodDescription,
  PartApplyResult,
  PartReview,
  ReleaseReview,
  ReviewState
} from "./review";
import {
  applyCount,
  applyCustomFieldEdit,
  applyItemEdit,
  applyRequestBody,
  clearFieldErrors,
  createReview,
  customFieldDisplayValue,
  customFieldEditValue,
  describeMethod,
  editedItem,
  indexFieldErrors,
  methodTypesFor,
  normalizeWarnings,
  patchPartStatuses,
  withMember
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
  /** Saving needs settings update; the editor is read-only without it. */
  canEdit: boolean;
};

/**
 * One entry of the draft map the Fields editor posts — a PropertyMapEntry
 * except that a field being created has no id yet: the server creates it and
 * resolves `create` into `carbonFieldId`.
 */
type FieldsDraftEntry = {
  onshapePropertyId: string;
  onshapeName: string;
  valueType: string;
  mode: "owned" | "default";
  carbonFieldId?: string;
};

type PushDefaultsState =
  | { status: "idle" }
  | {
      status: "editing";
      draft: OnshapePushDefaults;
      /**
       * What the company actually holds — the draft as last loaded or saved.
       * The page's one Save writes only the sections that differ from their
       * baseline, so each section needs its own.
       */
      baseline: OnshapePushDefaults;
      saving: boolean;
      error: string | null;
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
      /** A re-read is in flight; the rows on screen are the previous ones. */
      refreshing?: boolean;
      /** A re-read failed; the rows on screen are the previous ones. */
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

/**
 * The panel's pages. `push` is the current element — an assembly or a part
 * studio; `releases` is the whole document, which is why it survives on an
 * element that has nothing to push; `settings` is the company, which is why it
 * survives everywhere.
 */
type PanelTab = "push" | "releases" | "settings";

/**
 * Radix Select refuses an empty value, and "no unit chosen" is a real choice —
 * it means "resolve from the company's list at plan time", which is what a
 * company that deleted EA relies on.
 */
const UNIT_FROM_COMPANY = "__company-default__";

/** Radix Select refuses empty item values, so the two specials are named. */
const FIELDS_NOT_MAPPED = "__not-mapped__";
/** Same reason: the review's Yes/No and List editors need an unset choice. */
const CUSTOM_FIELD_UNSET = "__unset__";

/**
 * The Carbon types an Onshape value type may map onto. MAPPABLE_VALUE_TYPES
 * is a plain object, so a valueType of "constructor" would otherwise resolve
 * to Object.prototype's and crash the render on `.includes`.
 */
function mappableTypesFor(valueType: string): readonly number[] {
  if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, valueType)) return [];
  return MAPPABLE_VALUE_TYPES[valueType] ?? [];
}

export type OnshapePanelPaths = {
  /** Popup route that mints a panel session for the signed-in user. */
  auth: string;
  /** Returns who the token belongs to. */
  me: string;
  /** DELETE revokes the token. */
  session: string;
  /** Carbon status for the current element's parts. */
  status: string;
  /** GET: Onshape properties + Carbon fields + the map. POST: save the map. */
  fields: string;
  /** POST: save the company's push defaults. */
  preferences: string;
  /** POST: plan a part push — what would happen, editable, nothing written. */
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
  /** Company push defaults, editable on the Settings page. */
  pushDefaults: OnshapePushDefaults;
  /** The company's units, for the default-unit choice. */
  unitsOfMeasure: Array<{ code: string; name: string }>;
  /**
   * Whether this user may save anything on the Settings page. One flag for
   * the page because it has one Save, and both of its writes need the same
   * `settings.update` permission.
   */
  canEditSettings: boolean;
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
  lines
}: {
  title: (count: number) => string;
  lines: string[];
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
    <Alert variant="warning">
      <LuTriangleAlert />
      <AlertTitle>{title(lines.length)}</AlertTitle>
      <AlertDescription>
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
        {stale ? " Showing what was loaded before." : null}
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

  // The Fields editor (Onshape properties → Carbon custom fields). One shared
  // section for the whole panel: the map is company-wide, not per element.
  /*
   * The push defaults, as a draft. They arrive with identity (`panel.me`), so
   * the Settings page never waits on a read of its own; the draft is seeded
   * from that and saved as a whole, the way the integration settings form did.
   */
  const [pushDefaults, setPushDefaults] = useState<PushDefaultsState>({
    status: "idle"
  });
  const [fields, setFields] = useState<PanelFieldsState>({ status: "closed" });
  /*
   * Three pages, not three sections of one. They share nothing on screen and
   * are used on different days: the element's BOM is the daily job, releases
   * are occasional, and the property map is set up once. Stacked, each one
   * stood between the user and the next.
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
    // The Fields editor lists the CURRENT element's properties while its
    // draft is the whole company map: left open across a move it would edit
    // one element's map against another element's property list.
    setFields({ status: "closed" });
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
       * Everything read under the old session goes with it. The next sign-in
       * can be a different user or company, and `showTab` only reloads a
       * section that is `closed` or `error` — so a kept property map was shown
       * for, and saved against, the wrong company; and a section abandoned
       * mid-read by a 401 stayed `loading` or `saving` with no way out.
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
        // eslint-disable-next-line no-console
        console.debug("[onshape-panel] status", {
          ok: response.ok,
          kind: (body as { kind?: string }).kind
        });
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
        fail(error instanceof Error ? error.message : String(error), false);
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
        fail(error instanceof Error ? error.message : String(error), false);
      }
    },
    [context.documentId, paths.releases]
  );

  const loadFields = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      /*
       * Every landing commits only while this read is still the one the
       * section is waiting for: hiding it, or a move to another element,
       * leaves `closed` behind and must not be undone when the answer arrives.
       * A Refresh keeps the previous rows on screen and so stays `ready` with
       * `refreshing` set — that is also a read in flight. Both the response
       * path and the throw path go through this; the throw path once checked
       * only `loading`, so a Refresh that threw spun forever and disabled Save.
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
        const awaitingRead = (current: PanelFieldsState) =>
          current.status === "loading" ||
          (current.status === "ready" && !!current.refreshing);
        if (!response.ok || "error" in body) {
          fail(
            "error" in body ? body.error : `Carbon answered ${response.status}`,
            response.status === 403
          );
          return;
        }
        setFields((current) =>
          awaitingRead(current)
            ? {
                status: "ready",
                data: body,
                // A re-read is the company's map as it now stands, so it
                // replaces the draft rather than merging with it.
                entries: body.map.map((entry) => ({ ...entry })),
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
        fail(error instanceof Error ? error.message : String(error), false);
      }
    },
    [canLoadParts, context, paths.fields]
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
        setPushDefaults({
          status: "editing",
          draft: me.pushDefaults,
          baseline: me.pushDefaults,
          saving: false,
          error: null
        });
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
          message: error instanceof Error ? error.message : String(error)
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
        setPartsOutcome(
          failedOutcome(error instanceof Error ? error.message : String(error))
        );
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
        setAssemblyOutcome(
          failedOutcome(error instanceof Error ? error.message : String(error))
        );
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
          [releaseId]: failedOutcome(
            error instanceof Error ? error.message : String(error)
          )
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
          error: error instanceof Error ? error.message : String(error)
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

  const editReviewItem = (
    key: string,
    proposed: ProposedItem,
    field: EditableItemField,
    value: string
  ) =>
    setReview((current) =>
      current
        ? {
            ...current,
            edits: applyItemEdit(current.edits, key, proposed, field, value),
            fieldErrors: clearFieldErrors(current.fieldErrors, key)
          }
        : current
    );

  const editReviewCustomField = (
    key: string,
    rowFields: PlanCustomField[],
    fieldId: string,
    value: string
  ) =>
    setReview((current) =>
      current
        ? {
            ...current,
            edits: applyCustomFieldEdit(
              current.edits,
              key,
              rowFields,
              fieldId,
              value
            ),
            fieldErrors: clearFieldErrors(current.fieldErrors, key)
          }
        : current
    );

  const selectPart = (partId: string, selected: boolean) =>
    setReview((current) =>
      current?.kind === "part"
        ? {
            ...current,
            selected: withMember(current.selected, partId, selected)
          }
        : current
    );

  /** Bulk tick/untick, one state update however many rows the filter covers. */
  const selectManyParts = (partIds: string[], selected: boolean) =>
    setReview((current) => {
      if (current?.kind !== "part") return current;
      const next = new Set(current.selected);
      for (const partId of partIds) {
        if (selected) next.add(partId);
        else next.delete(partId);
      }
      return { ...current, selected: next };
    });

  const includeAssemblyItem = (partNumber: string, included: boolean) =>
    setReview((current) =>
      current?.kind === "assembly"
        ? {
            ...current,
            excluded: withMember(current.excluded, partNumber, !included)
          }
        : current
    );

  /** Bulk include/exclude for assembly components, one state update. */
  const includeManyAssemblyItems = (partNumbers: string[], included: boolean) =>
    setReview((current) => {
      if (current?.kind !== "assembly") return current;
      const next = new Set(current.excluded);
      for (const partNumber of partNumbers) {
        if (included) next.delete(partNumber);
        else next.add(partNumber);
      }
      return { ...current, excluded: next };
    });

  const editChangeNotice = (field: "name" | "description", value: string) =>
    setReview((current) => {
      if (current?.kind !== "release" || !current.changeNotice) return current;
      const changeNotice =
        field === "name"
          ? { ...current.changeNotice, name: value }
          : {
              ...current.changeNotice,
              description: value === "" ? null : value
            };
      return {
        ...current,
        changeNotice,
        fieldErrors: clearFieldErrors(current.fieldErrors, "changeNotice")
      };
    });

  const setMakeDefault = (makeDefault: boolean) =>
    setReview((current) =>
      current?.kind === "release" ? { ...current, makeDefault } : current
    );

  const setCreateChangeNotice = (createChangeNotice: boolean) =>
    setReview((current) =>
      current?.kind === "release"
        ? {
            ...current,
            createChangeNotice,
            // Dropping the notice drops its validation errors with it.
            fieldErrors: createChangeNotice
              ? current.fieldErrors
              : clearFieldErrors(current.fieldErrors, "changeNotice")
          }
        : current
    );

  /**
   * Save the property map: the whole entries list, a full replacement. A 422
   * pins errors to properties; success re-seeds the draft from what the server
   * now holds, so the page stays where it is with nothing left to save.
   *
   * Returns whether it wrote, because the page's one Save may be driving both
   * sections and only reports success if every write it made succeeded.
   */
  const saveFields = useCallback(
    async (token: string): Promise<boolean> => {
      if (fields.status !== "ready" || fields.saving) return false;
      const current = fields;
      setFields({
        ...current,
        saving: true,
        error: null,
        warning: undefined,
        fieldErrors: {}
      });
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
          setFields({
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
          return false;
        }
        // The map the server answers with, not the draft that was posted: the
        // two agree, and taking the server's leaves no way for the baseline to
        // drift from the row.
        setFields({
          ...current,
          data: {
            ...current.data,
            map: body.map,
            // Null when the save landed but the re-read failed: keep the
            // definitions already on screen rather than emptying every select.
            definitions: body.definitions ?? current.data.definitions
          },
          entries: body.map.map((entry) => ({ ...entry })),
          saving: false,
          error: null,
          warning: body.warning,
          fieldErrors: {}
        });
        return true;
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return false;
        }
        setFields({
          ...current,
          saving: false,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    },
    [fields, paths.fields]
  );

  /** Replace one property's draft entry; every other entry survives. */
  const editFieldsEntry = (
    propertyId: string,
    updater: (entry: FieldsDraftEntry | undefined) => FieldsDraftEntry | null
  ) =>
    setFields((current) => {
      if (current.status !== "ready") return current;
      const existing = current.entries.find(
        (entry) => entry.onshapePropertyId === propertyId
      );
      const next = updater(existing);
      const entries = current.entries.filter(
        (entry) => entry.onshapePropertyId !== propertyId
      );
      if (next) entries.push(next);
      return {
        ...current,
        entries,
        error: null,
        fieldErrors: clearFieldErrors(current.fieldErrors, propertyId)
      };
    });

  const mapFieldsProperty = (
    property: PanelFieldsProperty,
    selection: string
  ) =>
    editFieldsEntry(property.propertyId, (entry) => {
      if (selection === FIELDS_NOT_MAPPED) return null;
      const base = {
        onshapePropertyId: property.propertyId,
        onshapeName: property.name,
        valueType: property.valueType,
        mode: entry?.mode ?? ("owned" as const)
      };
      return { ...base, carbonFieldId: selection };
    });

  const editPushDefault = <K extends keyof OnshapePushDefaults>(
    key: K,
    value: OnshapePushDefaults[K]
  ) =>
    setPushDefaults((current) =>
      current.status === "editing"
        ? {
            ...current,
            // The ERP refuses a replenishment/method pair its own Part form
            // would, so changing the replenishment re-resolves the method the
            // same way `parsePushDefaults` does on the way in.
            draft: reconcilePushDefaults({ ...current.draft, [key]: value }),
            error: null
          }
        : current
    );

  /** As `saveFields`: reports whether it wrote, for the page's one Save. */
  const savePushDefaults = async (token: string): Promise<boolean> => {
    if (pushDefaults.status !== "editing" || pushDefaults.saving) return false;
    const current = pushDefaults;
    setPushDefaults({ ...current, saving: true, error: null });
    try {
      const response = await panelFetch(token, paths.preferences, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultUnitOfMeasureCode: current.draft.unitOfMeasureCode ?? "",
          defaultReplenishmentSystem: current.draft.replenishmentSystem,
          defaultMethodTypeForMake: current.draft.methodTypeForMake,
          defaultMethodTypeForBuy: current.draft.methodTypeForBuy,
          defaultItemTrackingType: current.draft.itemTrackingType
        })
      });
      const body = (await response.json()) as
        | { defaults: unknown }
        | PanelErrorResponse;
      if (!response.ok || "error" in body) {
        setPushDefaults({
          ...current,
          saving: false,
          error:
            "error" in body ? body.error : `Carbon answered ${response.status}`
        });
        return false;
      }
      setPushDefaults({
        ...current,
        baseline: current.draft,
        saving: false,
        error: null
      });
      return true;
    } catch (error) {
      if (error instanceof PanelUnauthorizedError) {
        setSession({ status: "signed-out" });
        return false;
      }
      setPushDefaults({
        ...current,
        saving: false,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  };

  const setFieldsMode = (propertyId: string, mode: "owned" | "default") =>
    editFieldsEntry(propertyId, (entry) => (entry ? { ...entry, mode } : null));

  /*
   * The Settings page has one Save, so what is unsaved is a property of the
   * page rather than of a section. Both sections write the same integration
   * row, and a page with two buttons made the user guess which one their edit
   * belonged to — worse, a page where both were visible at once suggested two
   * independent saves where there is one decision.
   */
  const pushDefaultsDirty =
    pushDefaults.status === "editing" &&
    !pushDefaultsEqual(pushDefaults.draft, pushDefaults.baseline);
  const fieldsDirty =
    fields.status === "ready" &&
    !propertyMapEqual(fields.entries, fields.data.map);
  const settingsSaving =
    (pushDefaults.status === "editing" && pushDefaults.saving) ||
    (fields.status === "ready" && fields.saving);
  const settingsBusy =
    settingsSaving || (fields.status === "ready" && !!fields.refreshing);

  /**
   * Save whatever the page has changed, in one action.
   *
   * Sequential, and the second write is attempted even if the first failed:
   * they are separate keys of the same row, so a rejected unit code must not
   * silently drop a property map the user also edited. Both sections keep
   * their own error, so a partial failure says which half to look at.
   */
  /*
   * The outcome of a save is reported in the Save bar itself, not a toast.
   * The toaster sits bottom-right, which in a panel this narrow is on top of
   * the very bar the user just pressed; and a failure rendered only at the top
   * of its section could be a long scroll away from the button.
   */
  const [settingsSaved, setSettingsSaved] = useState(false);
  const saveSettings = async (token: string) => {
    if (settingsBusy) return;
    setSettingsSaved(false);
    const wrote: boolean[] = [];
    if (pushDefaultsDirty) wrote.push(await savePushDefaults(token));
    if (fieldsDirty) wrote.push(await saveFields(token));
    setSettingsSaved(wrote.length > 0 && wrote.every(Boolean));
  };
  const settingsSaveFailure =
    pushDefaults.status === "editing" && pushDefaults.error
      ? fields.status === "ready" && fields.error
        ? "Push defaults and the property map couldn't be saved — see above."
        : "Push defaults couldn't be saved — see above."
      : fields.status === "ready" && fields.error
        ? "The property map couldn't be saved — see above."
        : null;

  /*
   * Selecting Fields is what loads it, so opening the panel still costs one
   * status read. A previous load that errored is retried on the way back in —
   * Radix does not fire this for the tab already showing, so there is no loop.
   */
  const showTab = (next: PanelTab, token: string) => {
    setTab(next);
    if (
      next === "settings" &&
      canLoadParts &&
      (fields.status === "closed" || fields.status === "error")
    ) {
      void loadFields(token);
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
   * Not every page applies to every element. A drawing has no parts and no
   * properties to map, but it belongs to a document that has releases.
   */
  const availableTabs = useMemo<PanelTab[]>(() => {
    if (session.status !== "signed-in") return [];
    const tabs: PanelTab[] = [];
    if (canLoadParts) tabs.push("push");
    if (context.documentId) tabs.push("releases");
    // Settings is the company, not the element: it holds the connection and
    // the push defaults, which are worth reaching from anywhere.
    tabs.push("settings");
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
          <Alert variant="destructive">
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
        session.status === "signed-in" &&
        (value === "push" || value === "releases" || value === "settings") &&
        showTab(value, session.token)
      }
      className="flex h-full min-h-0 flex-col"
    >
      {/*
       * The tab strip IS the top band. There was a header above it carrying a
       * Carbon mark, the word "Carbon" and a connected dot, and all three were
       * redundant: Onshape already labels the panel in its own icon rail, and
       * the connection now states itself properly on Settings — which company,
       * which user — instead of as a green dot. That row was ~44px of a panel
       * about twenty rows tall.
       *
       * Pinned, not scrolled with the pane: the push view is a long list, and
       * a tab strip you have to scroll back up to reach is not a tab strip.
       * One page needs no strip at all — an element with nothing but releases
       * is not a choice.
       */}
      {availableTabs.length > 1 ? (
        <HStack className="w-full shrink-0 justify-between border-b border-border px-4 py-2">
          <TabsList>
            {availableTabs.includes("push") ? (
              <TabsTrigger value="push">{pushTabLabel}</TabsTrigger>
            ) : null}
            {availableTabs.includes("releases") ? (
              <TabsTrigger value="releases">Releases</TabsTrigger>
            ) : null}
            {availableTabs.includes("settings") ? (
              <TabsTrigger value="settings">Settings</TabsTrigger>
            ) : null}
          </TabsList>
        </HStack>
      ) : null}

      <VStack spacing={4} className="min-h-0 flex-1 overflow-y-auto p-4">
        {!serverOrigin ? (
          <Alert variant="destructive">
            <LuTriangleAlert />
            <AlertTitle>Open this panel from Onshape</AlertTitle>
          </Alert>
        ) : null}

        <ContextSummary context={context} />

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
                    onEdit={editReviewItem}
                    onInclude={includeAssemblyItem}
                    onIncludeMany={includeManyAssemblyItems}
                    onEditCustomField={editReviewCustomField}
                    onOpenFields={() => showTab("settings", session.token)}
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
                  onEdit={editReviewItem}
                  onSelect={selectPart}
                  onSelectMany={selectManyParts}
                  onEditCustomField={editReviewCustomField}
                  onOpenFields={() => showTab("settings", session.token)}
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
                onEdit={editReviewItem}
                onChangeNotice={editChangeNotice}
                onCreateChangeNotice={setCreateChangeNotice}
                onMakeDefault={setMakeDefault}
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

        <TabsContent value="settings" className="w-full">
          {session.status === "signed-in" ? (
            /*
             * Laid out as Carbon's own integration settings form is: flat
             * sections under an eyebrow heading and a rule, fields at
             * `spacing={4}`, and one Save pinned at the foot of the page.
             * Cards were the other candidate — Carbon's full-page settings
             * use them — but three of them stacked in a 500px panel is more
             * chrome than content, and the drawer form is the narrow-surface
             * precedent.
             */
            <VStack spacing={4} className="w-full">
              <ConnectionSection me={session.me} onSignOut={signOut} />

              <PushDefaultsSection
                me={session.me}
                state={pushDefaults}
                onChange={editPushDefault}
              />

              {/* The property map is a company setting whose candidate rows
                  happen to come from the element in view — so it lives here,
                  and is absent on an element that has no properties. */}
              {canLoadParts ? (
                <PanelSettingsSection
                  title="Custom fields"
                  description="Onshape properties are pushed into the Carbon custom field each one is mapped to. Create the field in Carbon first, then map it here."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => loadFields(session.token)}
                      isDisabled={settingsBusy || fields.status === "loading"}
                      isLoading={
                        fields.status === "ready" && !!fields.refreshing
                      }
                      leftIcon={<LuRefreshCw />}
                    >
                      Refresh
                    </Button>
                  }
                >
                  {/* `closed` is the instant between selecting the tab and the
                      fetch starting, and it reads as the same wait. */}
                  {fields.status === "closed" ? (
                    <VStack spacing={2} className="w-full">
                      <FieldsColumnLabels />
                      <PanelListSkeleton />
                    </VStack>
                  ) : (
                    <FieldsSection
                      state={fields}
                      onMap={mapFieldsProperty}
                      onMode={setFieldsMode}
                      onRetry={() => loadFields(session.token)}
                    />
                  )}
                </PanelSettingsSection>
              ) : null}
            </VStack>
          ) : null}
        </TabsContent>
      </VStack>

      {/*
       * Settings' Save is a pinned band of the panel, the mirror of the tab
       * strip at the top — not a sticky element inside the scrolling body.
       * Sticky inside it pins to the body's CONTENT edge, so the body's own
       * bottom padding left a strip of list showing beneath the bar.
       *
       * Outside `TabsContent` but inside the Tabs root, because it belongs to
       * the panel's frame rather than to the pane that scrolls.
       */}
      {tab === "settings" && session.status === "signed-in" ? (
        <SettingsActionBar
          canEdit={session.me.canEditSettings}
          dirty={pushDefaultsDirty || fieldsDirty}
          busy={settingsBusy}
          saving={settingsSaving}
          saved={settingsSaved && !(pushDefaultsDirty || fieldsDirty)}
          failure={settingsSaveFailure}
          onSave={() => saveSettings(session.token)}
        />
      ) : null}
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
              Onshape didn't return it this time. Press Refresh to try again.
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
 * The current assembly's BOM, structured or flat, the way Onshape's own BOM
 * table offers it.
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
   * The view controls go with them: changing how a list is grouped while it
   * is being refetched only means doing it twice.
   */
  disabled: boolean;
}) {
  const [view, setView] = useState<"structured" | "flat">("structured");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildBomViewTree(lines), [lines]);
  const structured = useMemo(() => visibleBomRows(tree, open), [tree, open]);
  const flat = useMemo(() => flattenBomView(lines), [lines]);
  const parents = useMemo(() => bomParentIndexes(tree), [tree]);

  const toggle = (index: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const allOpen = parents.length > 0 && parents.every((i) => open.has(i));

  return (
    /*
     * Two views of the same list are tabs in Carbon — `TabsList` switches views
     * inside a card or drawer across the app (`QuoteLinePricingHistory`,
     * `OpportunityNotes`, `IntegrationForm`). This used to be a pill-styled
     * `ToggleGroup` copied from `DateSelect`, the one place in the app that
     * styles one that way; `ToggleGroup` elsewhere is for filters, and this is
     * not a filter. Sized down so it reads as subordinate to the page tabs.
     */
    <Tabs
      value={view}
      onValueChange={(value) =>
        (value === "structured" || value === "flat") && setView(value)
      }
      className="flex w-full flex-col gap-2"
    >
      <HStack className="w-full justify-between">
        <TabsList className="p-0.5">
          <TabsTrigger
            value="structured"
            disabled={disabled}
            className="px-2.5 py-0.5 text-xs"
          >
            Structured
          </TabsTrigger>
          <TabsTrigger
            value="flat"
            disabled={disabled}
            className="px-2.5 py-0.5 text-xs"
          >
            Flat
          </TabsTrigger>
        </TabsList>
        {view === "structured" && parents.length > 0 ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(parents))}
            isDisabled={disabled}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        ) : null}
      </HStack>

      {/* One panel for whichever view is active, so the active tab's
          `aria-controls` points at a panel that exists. */}
      <TabsContent value={view} className="w-full">
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {view === "structured"
            ? structured.map((row) => (
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
                        /* Leaves keep the chevron's width so part numbers stay
                         on one column instead of stepping in and out. */
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
              ))
            : flat.map((row) => (
                <li
                  key={row.line.partNumber ?? row.line.index}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <BomLineText
                    line={row.line}
                    quantity={row.totalQuantity}
                    note={
                      row.occurrences > 1 ? `${row.occurrences} places` : null
                    }
                  />
                  <PartStateBadge state={row.line.state} />
                </li>
              ))}
        </ul>
      </TabsContent>
    </Tabs>
  );
}

/** A BOM line's two lines of text, shared by both views. */
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
                    ? ` · matches ${part.item.readableId}`
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
// Fields (Onshape properties → Carbon custom fields)
// ---------------------------------------------------------------------------

/**
 * The company's property map, edited in place: one row per property of the
 * current element, a select of the part custom fields it can feed (or a
 * field to create), and who owns the value afterwards. Saving replaces the
 * whole map; entries mapped from other elements are preserved by the draft
 * (see PanelFieldsState.entries).
 */
function FieldsSection({
  state,
  onMap,
  onMode,
  onRetry
}: {
  state: Exclude<PanelFieldsState, { status: "closed" }>;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onMode: (propertyId: string, mode: "owned" | "default") => void;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    /*
     * The column labels are static, so they render while the rows load: they
     * are what the page IS, and holding them back only moved the list down
     * when the read landed.
     */
    return (
      <VStack spacing={2} className="w-full">
        <FieldsColumnLabels />
        <PanelListSkeleton />
      </VStack>
    );
  }
  if (state.status === "error") {
    return (
      <PanelLoadError
        title="Couldn't load properties"
        failure={{ message: state.message, forbidden: !!state.forbidden }}
        onRetry={onRetry}
      />
    );
  }
  const { data } = state;
  const entryFor = (propertyId: string) =>
    state.entries.find((entry) => entry.onshapePropertyId === propertyId);
  /*
   * Only what the user can act on. A COMPUTED, CATEGORY, USER or BLOB
   * property has no Carbon field it can coerce into, so its row was a dead
   * "cannot be mapped" line — and on a real element those outnumbered the
   * mappable ones.
   *
   * An already-mapped property stays listed even if its type is not mappable
   * (a map written before a type changed, or by hand). The save posts the
   * whole map, so hiding an entry would leave it riding along invisibly with
   * no way to remove it.
   */
  const visibleProperties = data.properties.filter(
    (property) => property.mappable || !!entryFor(property.propertyId)
  );
  // The save posts the whole map, so a 422 can name a property mapped from
  // another element. There is no row here to pin it to, and unpinned it would
  // be invisible — Save would just fail — so it renders on its own, named
  // from the draft entry. Keyed on the VISIBLE rows: an error pinned to a row
  // the filter dropped would be pinned to nothing.
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
  return (
    <VStack spacing={2} className="w-full">
      {state.refreshFailure ? (
        <PanelLoadError
          title="Couldn't refresh properties"
          failure={state.refreshFailure}
          stale
          retrying={!!state.refreshing}
          onRetry={onRetry}
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
            className="text-xs text-destructive w-full"
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
                  disabled={!data.canEdit || state.saving || !!state.refreshing}
                  onMap={onMap}
                  onMode={onMode}
                />
              ))}
            </ul>
          </div>
        </>
      )}
    </VStack>
  );
}

/**
 * Which side is which is not guessable from the rows: both halves are field
 * names. Naming the columns is the whole legend the editor needs — and it is
 * shown while the rows load, so the list lands in place.
 */
/**
 * One section of the Settings page: an eyebrow heading, a sentence saying what
 * it decides, and its controls — the shape Carbon's own integration settings
 * form uses for a settings group (`SettingsGroup` in `IntegrationForm`).
 *
 * The rule above the heading is what separates the sections, so the first one
 * on the page asks for `first` and does without it.
 */
function PanelSettingsSection({
  title,
  description,
  action,
  first,
  children
}: {
  title: string;
  description: string;
  /** A control that belongs to the section, not to a field in it. */
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("w-full", !first && "border-t border-border pt-4")}>
      <div className="flex w-full items-start justify-between gap-2 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Subheading as="h2" variant="light" className="block">
            {title}
          </Subheading>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Which Carbon this panel is writing into, and the way out.
 *
 * The company is not cosmetic: a user who belongs to more than one has no
 * other way to tell which one a push will land in, and the answer only arrives
 * with the token. Sign out lives here rather than in a header because it is
 * the rarest action in the panel and the header was costing a row of list.
 */
function ConnectionSection({
  me,
  onSignOut
}: {
  me: OnshapePanelMe;
  onSignOut: () => void;
}) {
  return (
    <PanelSettingsSection
      first
      title="Connection"
      description="The Carbon company and user every push from this panel is recorded against."
    >
      {/* The row reads as a setting with its control on the right, the way
          Carbon's own settings rows do (see the Production settings page). */}
      <HStack className="w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <HStack spacing={2} className="min-w-0">
            <PulsingDot
              inactive
              variant="green"
              aria-label="Connected to Carbon"
              className="shrink-0"
            />
            <span
              className="truncate text-sm font-medium"
              title={me.company?.name ?? ""}
            >
              {me.company?.name ?? "No company"}
            </span>
          </HStack>
          <span
            className="truncate text-xs text-muted-foreground"
            title={me.email}
          >
            {me.email}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onSignOut}
          className="shrink-0"
        >
          Sign out
        </Button>
      </HStack>
    </PanelSettingsSection>
  );
}

/**
 * The five defaults a push applies to an item it creates.
 *
 * Each is a DEFAULT, not a rule: the review step still lets a person change
 * any of them per push. They used to be editable only on the integration page
 * in Carbon, which meant leaving the CAD document to change one.
 */
function PushDefaultsSection({
  me,
  state,
  onChange
}: {
  me: OnshapePanelMe;
  state: PushDefaultsState;
  onChange: <K extends keyof OnshapePushDefaults>(
    key: K,
    value: OnshapePushDefaults[K]
  ) => void;
}) {
  if (state.status !== "editing") return null;
  const { draft } = state;
  // Read-only without `settings.update`, as the property map already is:
  // editing five selects only to find there is no Save was a dead end.
  const busy = state.saving || !me.canEditSettings;
  return (
    <PanelSettingsSection
      title="Push defaults"
      description="Applied to items a push creates. Every one can still be changed per item while reviewing a push."
    >
      <VStack spacing={4} className="w-full">
        {state.error ? (
          <Alert variant="destructive">
            <LuTriangleAlert />
            <AlertTitle>Couldn't save the defaults</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <EditorSelect
          label="Unit of measure"
          value={draft.unitOfMeasureCode ?? UNIT_FROM_COMPANY}
          options={[
            /* Null means "decide from the company's list" at plan time, which
               is what a company that deleted EA relies on. */
            { value: UNIT_FROM_COMPANY, label: "First in the company's list" },
            ...me.unitsOfMeasure.map((unit) => ({
              value: unit.code,
              label: `${unit.name} (${unit.code})`
            }))
          ]}
          onChange={(value) =>
            onChange(
              "unitOfMeasureCode",
              value === UNIT_FROM_COMPANY ? null : value
            )
          }
          disabled={busy}
        />
        <EditorSelect
          label="Replenishment for designed parts"
          value={draft.replenishmentSystem}
          options={ITEM_REPLENISHMENT_SYSTEMS.map((value) => ({
            value,
            label: value
          }))}
          onChange={(value) =>
            onChange(
              "replenishmentSystem",
              value as OnshapePushDefaults["replenishmentSystem"]
            )
          }
          disabled={busy}
        />
        <EditorSelect
          label="Method for designed parts"
          value={draft.methodTypeForMake}
          options={methodTypesFor(draft).map((value) => ({
            value,
            label: value
          }))}
          onChange={(value) =>
            onChange(
              "methodTypeForMake",
              value as OnshapePushDefaults["methodTypeForMake"]
            )
          }
          disabled={busy}
        />
        <EditorSelect
          label="Method for purchased parts"
          value={draft.methodTypeForBuy}
          options={methodTypesFor({ replenishmentSystem: "Buy" }).map(
            (value) => ({ value, label: value })
          )}
          onChange={(value) =>
            onChange(
              "methodTypeForBuy",
              value as OnshapePushDefaults["methodTypeForBuy"]
            )
          }
          disabled={busy}
        />
        <EditorSelect
          label="Tracking type"
          value={draft.itemTrackingType}
          options={ITEM_TRACKING_TYPES.map((value) => ({
            value,
            label: value
          }))}
          onChange={(value) =>
            onChange(
              "itemTrackingType",
              value as OnshapePushDefaults["itemTrackingType"]
            )
          }
          disabled={busy}
        />
      </VStack>
    </PanelSettingsSection>
  );
}

/**
 * The right-hand control block's width, shared by the rows and the column
 * labels above them so the two columns actually line up. Fixed rather than a
 * fraction: the select has to hold a Carbon field name, and the property
 * names on the left vary far more in length than the fields do.
 *
 * Wide enough for both controls a mapped row shows — at 220px the ownership
 * select rendered as "Own…".
 */
const FIELDS_CONTROL_WIDTH = "w-[252px]";
/** Fits "Default", the longer of the two ownership words, without truncating. */
const FIELDS_MODE_WIDTH = "w-[104px]";

/**
 * Which side is which is not guessable from the rows alone — both halves are
 * field names — so the columns are named, aligned over the columns they
 * describe, and each row carries an arrow in Onshape → Carbon order.
 */
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
  onMap,
  onMode
}: {
  property: PanelFieldsProperty;
  entry: FieldsDraftEntry | undefined;
  definitions: PlanCustomFieldDefinition[];
  errors: string[] | undefined;
  disabled: boolean;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onMode: (propertyId: string, mode: "owned" | "default") => void;
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
  // name it: with no item for the value the trigger renders blank, so the
  // mapping shows as a disabled option the user can map away from.
  const deletedFieldId =
    entry?.carbonFieldId &&
    !options.some((definition) => definition.id === entry.carbonFieldId)
      ? entry.carbonFieldId
      : null;
  const selection = entry?.carbonFieldId ?? FIELDS_NOT_MAPPED;
  /*
   * A property whose type has no Carbon target is only listed at all because
   * something already maps it, and the reason for listing it is that the save
   * posts the whole map — so it has to be possible to map it away. It gets the
   * select too; the options are just the field it already points at.
   */
  const editable = property.mappable || !!entry;
  return (
    <li className="flex w-full flex-col gap-1 px-3 py-2">
      <div className="flex w-full items-center gap-3">
        {/* `leading-tight` on both lines: the panel is about fifteen rows
            tall, so the default line height cost a row of list per screen. */}
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium" title={property.name}>
            {property.name}
          </span>
          {/* The Onshape type, as provenance under the name rather than as a
              badge beside it: it is read far less often than the name, and a
              badge on every row read as a column of noise. */}
          <span className="truncate text-xs text-muted-foreground">
            {property.valueType}
            {property.mappable ? null : " · no Carbon type to map onto"}
          </span>
        </div>
        <LuArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            FIELDS_CONTROL_WIDTH
          )}
        >
          {editable ? (
            <>
              <Select
                value={selection}
                onValueChange={(value) => onMap(property, value)}
                disabled={disabled}
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-0 flex-1"
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
              {/* Only a mapped row has an ownership to choose, and reserving
                  the space when there is none would leave every unmapped row
                  with a hole in it. */}
              {entry ? (
                <Select
                  value={entry.mode}
                  onValueChange={(value) =>
                    onMode(
                      property.propertyId,
                      value === "default" ? "default" : "owned"
                    )
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    size="sm"
                    className={cn("shrink-0", FIELDS_MODE_WIDTH)}
                    aria-label={`${property.name} ownership`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owned">Owned</SelectItem>
                    <SelectItem value="default">Default</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Not mappable</span>
          )}
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
  /** A plan request after expiry is in flight. */
  replanning: boolean;
  onEdit: (
    key: string,
    proposed: ProposedItem,
    field: EditableItemField,
    value: string
  ) => void;
};

/** Header every review shares: what happens, and the two ways out of it. */
/**
 * The push button, pinned to the bottom of the scrolling body.
 *
 * It used to sit above the list. With eight rows that reads fine; with a
 * hundred it means scrolling back to the top to commit a decision you made at
 * the bottom, and it hides the one number that matters — how many items this
 * is about to write. Sticky keeps both in view for the whole review.
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
        {count === 0 ? "Nothing selected" : `Push ${count} to Carbon`}
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

/**
 * The Settings page's one Save, pinned to the foot of the page.
 *
 * One button for the page, not one per section: both sections write the same
 * `companyIntegration` row, and two buttons visible at once read as two
 * independent saves where there is a single decision. Pinned for the same
 * reason the review's push button is — the property map runs to dozens of
 * rows, and a Save you have to scroll back up to reach is a Save that gets
 * missed.
 */
function SettingsActionBar({
  canEdit,
  dirty,
  busy,
  saving,
  saved,
  failure,
  onSave
}: {
  canEdit: boolean;
  dirty: boolean;
  busy: boolean;
  saving: boolean;
  /** The last save wrote everything it tried to, and nothing is dirty since. */
  saved: boolean;
  /** Which half of the last save failed, when one did. */
  failure: string | null;
  onSave: () => void;
}) {
  return (
    <div className="w-full shrink-0 border-t border-border bg-background px-4 py-2">
      {canEdit && failure ? (
        <p className="pb-2 text-xs font-medium text-destructive">{failure}</p>
      ) : null}
      {canEdit && saved && !failure ? (
        <p className="flex items-center gap-1 pb-2 text-xs text-muted-foreground">
          <LuCircleCheck className="size-3" />
          Saved — new pushes use these settings.
        </p>
      ) : null}
      {canEdit ? (
        <Button
          className="w-full"
          onClick={onSave}
          isDisabled={!dirty || busy}
          isLoading={saving}
        >
          {dirty ? "Save changes" : "No changes to save"}
        </Button>
      ) : (
        // Nothing to offer rather than a button that would 403: the writes
        // both need `settings.update`, and the page is still worth reading
        // without it.
        <p className="py-1 text-center text-xs text-muted-foreground">
          Changing these needs permission to update settings in Carbon.
        </p>
      )}
    </div>
  );
}

function EditorSelect({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    /*
     * `gap-2` and a full-width control, because `VStack` is `items-start`:
     * left to size themselves these shrank to their content, so a stack of
     * five selects had five different widths. Carbon's own `Select` is a
     * `FormControl` (`gap-y-2`) around a `w-full` trigger — this is that,
     * without the form binding the panel has no use for.
     */
    <div className="flex w-full min-w-0 flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The create-row editor: the six fields a user may change before an item is
 * created. Identity (part number, revision) is Onshape's and is not offered.
 * Method choices follow the replenishment system as the Part form's do, and
 * a replenishment change that invalidates the method moves it (see
 * applyItemEdit). Values are the proposal with the edits laid over it, so
 * an untouched field shows what the push would write.
 */
function ItemEditor({
  editKey,
  proposed,
  edit,
  errors,
  options,
  disabled,
  onEdit
}: {
  editKey: string;
  proposed: ProposedItem;
  edit: ItemEdit | undefined;
  errors: string[] | undefined;
  options: PlanOptions;
  disabled: boolean;
  onEdit: ReviewSectionProps<ReviewState>["onEdit"];
}) {
  const item = editedItem(proposed, edit);
  const change = (field: EditableItemField) => (value: string) =>
    onEdit(editKey, proposed, field, value);
  return (
    <VStack spacing={2} className="w-full mt-2">
      <Input
        size="sm"
        value={item.name}
        placeholder="Name"
        aria-label="Name"
        isDisabled={disabled}
        isInvalid={!!errors}
        onChange={(event) => change("name")(event.target.value)}
      />
      <Input
        size="sm"
        value={item.description ?? ""}
        placeholder="Description"
        aria-label="Description"
        isDisabled={disabled}
        onChange={(event) => change("description")(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2 w-full">
        <EditorSelect
          label="Buy/Make"
          value={item.replenishmentSystem}
          options={ITEM_REPLENISHMENT_SYSTEMS.map((value) => ({
            value,
            label: value
          }))}
          disabled={disabled}
          onChange={change("replenishmentSystem")}
        />
        <EditorSelect
          label="Method"
          value={item.defaultMethodType}
          options={methodTypesFor(item).map((value) => ({
            value,
            label: value
          }))}
          disabled={disabled}
          onChange={change("defaultMethodType")}
        />
        <EditorSelect
          label="Tracking"
          value={item.itemTrackingType}
          options={ITEM_TRACKING_TYPES.map((value) => ({
            value,
            label: value
          }))}
          disabled={disabled}
          onChange={change("itemTrackingType")}
        />
        <EditorSelect
          label="Unit"
          value={item.unitOfMeasureCode}
          options={options.unitsOfMeasure.map((unit) => ({
            value: unit.code,
            label: `${unit.code} · ${unit.name}`
          }))}
          disabled={disabled}
          onChange={change("unitOfMeasureCode")}
        />
      </div>
      {errors?.map((message) => (
        <p key={message} className="text-xs text-destructive w-full">
          {message}
        </p>
      ))}
    </VStack>
  );
}

type EditCustomFieldHandler = (
  key: string,
  fields: PlanCustomField[],
  fieldId: string,
  value: string
) => void;

/**
 * The mapped custom fields on a review row. A create shows every mapped
 * field — default-mode ones editable (they are Carbon's after create), owned
 * ones read-only with their Onshape provenance. Update/adopt rows list the
 * owned fields the push will write, the emptied ones included: an owned null
 * clears the Carbon value (mergeCustomFieldValues), so the review has to say
 * so. Problems and unmapped properties are review information, never
 * blockers.
 */
function RowCustomFields({
  editKey,
  isCreate,
  fields,
  problems,
  unmapped,
  edit,
  disabled,
  onEdit,
  onOpenFields
}: {
  editKey: string;
  isCreate: boolean;
  fields: PlanCustomField[] | undefined;
  problems: string[] | undefined;
  unmapped: UnmappedProperty[] | undefined;
  edit: ItemEdit | undefined;
  disabled: boolean;
  onEdit: EditCustomFieldHandler;
  onOpenFields: () => void;
}) {
  const mapped = fields ?? [];
  const shown = isCreate
    ? mapped
    : mapped.filter((field) => field.mode === "owned");
  if (shown.length === 0 && !problems?.length && !unmapped?.length) {
    return null;
  }
  return (
    <VStack spacing={1} className="w-full mt-2">
      {shown.map((field) => {
        if (isCreate && field.mode === "default") {
          return (
            <CustomFieldInput
              key={field.fieldId}
              field={field}
              value={customFieldEditValue(field, edit?.customFields)}
              disabled={disabled}
              onChange={(value) =>
                onEdit(editKey, mapped, field.fieldId, value)
              }
            />
          );
        }
        return (
          <p
            key={field.fieldId}
            className="text-xs text-muted-foreground w-full"
          >
            {isCreate || field.value !== null
              ? `${field.name}: ${customFieldDisplayValue(field)}`
              : `${field.name}: will be cleared`}
          </p>
        );
      })}
      {/* A value that cannot coerce is reported and skipped, never written —
          a warning about this field, not an error in the push. */}
      {problems?.map((problem) => (
        <p
          key={problem}
          className="w-full text-xs text-amber-600 dark:text-amber-400"
        >
          {problem}
        </p>
      ))}
      {unmapped && unmapped.length > 0 ? (
        <p className="text-xs text-muted-foreground w-full">
          Not mapped: {unmapped.map((property) => property.name).join(", ")}{" "}
          <Button variant="link" size="sm" onClick={onOpenFields}>
            Fields
          </Button>
        </p>
      ) : null}
    </VStack>
  );
}

/**
 * One editable default-mode field on a create row. The control matches the
 * Carbon type; values travel as the strings the inputs produce and the
 * server coerces them against the field's type (mergeCustomFieldEdits), so
 * what is typed is what is validated. An emptied input means "leave the
 * field unset".
 */
function CustomFieldInput({
  field,
  value,
  disabled,
  onChange
}: {
  field: PlanCustomField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  // An empty edit value is what "leave it unset" travels as, and Radix
  // refuses an empty item value, so the selects trade it for a named one.
  const selected = value === "" ? CUSTOM_FIELD_UNSET : value;
  const change = (next: string) =>
    onChange(next === CUSTOM_FIELD_UNSET ? "" : next);
  if (field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.boolean) {
    return (
      <CustomFieldLine label={field.name}>
        <Select value={selected} onValueChange={change} disabled={disabled}>
          <SelectTrigger size="sm" aria-label={field.name}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CUSTOM_FIELD_UNSET}>—</SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      </CustomFieldLine>
    );
  }
  if (field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.list) {
    // The Onshape value may not be a list option yet — apply adds missing
    // options add-only — so it must stay selectable here.
    const options = [...(field.listOptions ?? [])];
    const incoming =
      typeof field.value === "string" && field.value !== ""
        ? field.value
        : null;
    if (incoming && !options.includes(incoming)) options.unshift(incoming);
    if (value !== "" && !options.includes(value)) options.unshift(value);
    return (
      <CustomFieldLine label={field.name}>
        <Select value={selected} onValueChange={change} disabled={disabled}>
          <SelectTrigger size="sm" aria-label={field.name}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CUSTOM_FIELD_UNSET}>—</SelectItem>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CustomFieldLine>
    );
  }
  const type =
    field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.date
      ? "date"
      : field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.numeric
        ? "number"
        : "text";
  return (
    <CustomFieldLine label={field.name}>
      <Input
        size="sm"
        type={type}
        value={value}
        aria-label={field.name}
        isDisabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </CustomFieldLine>
  );
}

function CustomFieldLine({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-2 w-full">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/**
 * The action groups a part plan falls into, ordered by how much a reviewer
 * cares. "New" first because it is the only group whose values are editable
 * and the only one that can be got wrong; "Skipped" last because it is
 * unactionable.
 */
const PART_PLAN_GROUPS = [
  { action: "create", label: "New" },
  { action: "update", label: "Update" },
  { action: "adopt", label: "Link" },
  { action: "unchanged", label: "Up to date" },
  { action: "skip-no-part-number", label: "Skipped" }
] as const;

type PartPlanGroupKey = (typeof PART_PLAN_GROUPS)[number]["action"];

/**
 * Search + group filter + bulk selection for a list that can run to hundreds of
 * rows.
 *
 * A 100-part assembly is not reviewable by scrolling: the reviewer's real
 * question is "which of these are new, and are those right?", so the group
 * filter is the primary control and search is for finding one known part. Bulk
 * selection acts on the FILTERED set, not the whole plan — "Select all" while
 * filtered to New means "every new one", which is the thing people actually
 * want and the thing a plain select-all gets wrong.
 */
function PlanToolbar({
  query,
  onQuery,
  group,
  onGroup,
  counts,
  total,
  selectedCount,
  onSelectAll,
  onClearSelection,
  disabled
}: {
  query: string;
  onQuery: (value: string) => void;
  group: PartPlanGroupKey | "all";
  onGroup: (value: PartPlanGroupKey | "all") => void;
  counts: Record<string, number>;
  total: number;
  selectedCount: number | null;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  disabled: boolean;
}) {
  const chips: Array<{
    key: PartPlanGroupKey | "all";
    label: string;
    n: number;
  }> = [
    { key: "all", label: "All", n: total },
    ...PART_PLAN_GROUPS.map((g) => ({
      key: g.action,
      label: g.label,
      n: counts[g.action] ?? 0
    })).filter((chip) => chip.n > 0)
  ];

  return (
    <VStack spacing={2} className="w-full">
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search name or part number"
        aria-label="Search parts in this plan"
        className="h-8 w-full text-sm"
      />
      {/* Chips scroll sideways rather than wrap: a wrapped row of six chips
          costs three lines of a panel that only has about twenty. */}
      <div className="-mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-0.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onGroup(chip.key)}
            aria-pressed={group === chip.key}
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap transition-transform active:scale-[0.96] active:duration-75",
              group === chip.key
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {chip.label}
            <span className="ml-1 tabular-nums opacity-70">{chip.n}</span>
          </button>
        ))}
      </div>
      {selectedCount !== null ? (
        <HStack className="w-full justify-between text-xs">
          <HStack spacing={1}>
            <Button
              variant="link"
              size="sm"
              onClick={onSelectAll}
              isDisabled={disabled}
            >
              Select all
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={onClearSelection}
              isDisabled={disabled}
            >
              Clear
            </Button>
          </HStack>
          <span className="tabular-nums text-muted-foreground">
            {selectedCount} selected
          </span>
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * Everything a reviewer can change about one create row, behind a disclosure.
 *
 * Mounting this inline for every selected row was the panel's worst scaling
 * problem: six Selects plus the custom-field inputs, times a hundred rows, is
 * several hundred Radix popovers built before the list can paint — and it
 * buries the next row's name a screen and a half down. Collapsed by default,
 * the proposed values are still visible as a summary line, so nothing is
 * hidden that a reviewer needs in order to decide whether to open it.
 */
function RowDisclosure({
  summary,
  children,
  defaultOpen
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  /*
   * `defaultOpen` is how a 422 opens the rows it names — but the row mounts as
   * soon as it is selected, long before the apply answers, and `useState` only
   * reads its initial value once. So the flag flipping true after the response
   * was ignored, and the user got "Some edits are not valid" with the invalid
   * row still collapsed. Opening follows the flag; closing stays the user's.
   */
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    /*
     * Deliberately NOT a <details>. That element only HIDES its children —
     * React still mounts them, so a 150-row plan built every editor anyway
     * (measured: 300 Radix Selects mounted with the rows "collapsed").
     * Rendering conditionally is what actually keeps them out of the DOM.
     */
    <div className="mt-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground transition-transform hover:text-foreground active:scale-[0.96]"
      >
        <LuChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="truncate">{summary}</span>
      </button>
      {open ? children : null}
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
        <Status color="yellow" disableTooltip>
          Link to {row.item?.readableId ?? row.partNumber}
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
  replanning,
  onEdit,
  onSelect,
  onSelectMany,
  onEditCustomField,
  onOpenFields
}: ReviewSectionProps<PartReview> & {
  onSelect: (partId: string, selected: boolean) => void;
  onSelectMany: (partIds: string[], selected: boolean) => void;
  onEditCustomField: EditCustomFieldHandler;
  onOpenFields: () => void;
}) {
  const { plan } = review;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<PartPlanGroupKey | "all">("all");

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of plan.rows) out[row.action] = (out[row.action] ?? 0) + 1;
    return out;
  }, [plan.rows]);

  /** Rows surviving the group chip and the search box, in plan order. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plan.rows.filter((row) => {
      if (group !== "all" && row.action !== group) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.partNumber ?? "").toLowerCase().includes(needle)
      );
    });
  }, [plan.rows, query, group]);

  const grouped = useMemo(
    () =>
      PART_PLAN_GROUPS.map((definition) => ({
        ...definition,
        rows: visible.filter((row) => row.action === definition.action)
      })).filter((section) => section.rows.length > 0),
    [visible]
  );

  /*
   * Bulk selection acts on what is on screen, never on the whole plan. Filtered
   * to New, "Select all" means every new part — which is the operation someone
   * reviewing a hundred-part assembly actually wants.
   */
  const pushableVisible = visible
    .filter((row) => row.action !== "skip-no-part-number")
    .map((row) => row.partId);

  const busy = review.applying || replanning;

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Review → Carbon</span>
        <Button variant="ghost" size="sm" onClick={onCancel} isDisabled={busy}>
          Cancel
        </Button>
      </HStack>

      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      {plan.rows.length === 0 ? (
        <PanelEmpty>None of the selected parts are in this element</PanelEmpty>
      ) : (
        <>
          <PlanToolbar
            query={query}
            onQuery={setQuery}
            group={group}
            onGroup={setGroup}
            counts={counts}
            total={plan.rows.length}
            selectedCount={review.selected.size}
            onSelectAll={() => onSelectMany(pushableVisible, true)}
            onClearSelection={() => onSelectMany(pushableVisible, false)}
            disabled={busy}
          />

          {visible.length === 0 ? (
            <PanelEmpty>No parts match</PanelEmpty>
          ) : (
            grouped.map((section) => (
              <VStack key={section.action} spacing={1} className="w-full">
                <HStack className="w-full justify-between px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {section.label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {section.rows.length}
                  </span>
                </HStack>
                <ul className="w-full divide-y divide-border rounded-md border border-border">
                  {section.rows.map((row) => {
                    const pushable = row.action !== "skip-no-part-number";
                    const selected = review.selected.has(row.partId);
                    const hasEditor = row.action === "create" && !!row.proposed;
                    const hasFields =
                      row.action === "create" ||
                      row.action === "update" ||
                      row.action === "adopt";
                    return (
                      <li key={row.partId} className="px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <HStack spacing={2} className="min-w-0 items-start">
                            <span className="flex h-lh items-center text-sm">
                              <Checkbox
                                checked={selected}
                                disabled={!pushable || review.applying}
                                aria-label={`Push ${row.partNumber ?? row.name}`}
                                onCheckedChange={(checked) =>
                                  onSelect(row.partId, checked === true)
                                }
                              />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm" title={row.name}>
                                {row.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {row.partNumber ?? "No part number"}
                                {row.revision ? ` · Rev ${row.revision}` : ""}
                              </p>
                            </div>
                          </HStack>
                          <div className="shrink-0">
                            <PartPlanBadge row={row} />
                          </div>
                        </div>

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

                        {/*
                         * The editor and the custom fields only MOUNT when the
                         * disclosure is open. That is the whole scaling fix: a
                         * hundred selected create rows used to build six Radix
                         * Selects each before the list could paint.
                         */}
                        {selected && (hasEditor || hasFields) ? (
                          <RowDisclosure
                            summary={
                              hasEditor && row.proposed
                                ? `${row.proposed.replenishmentSystem} · ${row.proposed.defaultMethodType} · ${row.proposed.itemTrackingType}`
                                : "Fields from Onshape"
                            }
                            defaultOpen={
                              !!review.fieldErrors[row.partId]?.length
                            }
                          >
                            {hasEditor && row.proposed ? (
                              <ItemEditor
                                editKey={row.partId}
                                proposed={row.proposed}
                                edit={review.edits[row.partId]}
                                errors={review.fieldErrors[row.partId]}
                                options={plan.options}
                                disabled={review.applying}
                                onEdit={onEdit}
                              />
                            ) : null}
                            {hasFields ? (
                              <RowCustomFields
                                editKey={row.partId}
                                isCreate={row.action === "create"}
                                fields={row.customFields}
                                problems={row.customFieldProblems}
                                unmapped={row.unmappedProperties}
                                edit={
                                  row.action === "create"
                                    ? review.edits[row.partId]
                                    : undefined
                                }
                                disabled={review.applying}
                                onEdit={onEditCustomField}
                                onOpenFields={onOpenFields}
                              />
                            ) : null}
                          </RowDisclosure>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </VStack>
            ))
          )}

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
  replanning,
  onEdit,
  onInclude,
  onIncludeMany,
  onEditCustomField,
  onOpenFields
}: ReviewSectionProps<AssemblyReview> & {
  onInclude: (partNumber: string, included: boolean) => void;
  onIncludeMany: (partNumbers: string[], included: boolean) => void;
  onEditCustomField: EditCustomFieldHandler;
  onOpenFields: () => void;
}) {
  const { plan } = review;
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<PartPlanGroupKey | "all">("all");
  const busy = review.applying || replanning;

  const editorFor = (key: string, proposed: ProposedItem) => (
    <ItemEditor
      editKey={key}
      proposed={proposed}
      edit={review.edits[key]}
      errors={review.fieldErrors[key]}
      options={plan.options}
      disabled={review.applying}
      onEdit={onEdit}
    />
  );

  /*
   * An assembly item is either created or reused, so its two groups reuse the
   * part plan's "create"/"adopt" chips rather than inventing a second
   * vocabulary for the same idea.
   */
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const item of plan.items) {
      const key = item.action === "create" ? "create" : "adopt";
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }, [plan.items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plan.items.filter((item) => {
      const key = item.action === "create" ? "create" : "adopt";
      if (group !== "all" && group !== key) return false;
      if (!needle) return true;
      return (
        (item.name ?? "").toLowerCase().includes(needle) ||
        item.partNumber.toLowerCase().includes(needle)
      );
    });
  }, [plan.items, query, group]);

  const creatableVisible = visible
    .filter((item) => item.action === "create")
    .map((item) => item.partNumber);

  const includedCount = plan.items.filter(
    (item) => item.action === "create" && !review.excluded.has(item.partNumber)
  ).length;

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Review → Carbon</span>
        <Button variant="ghost" size="sm" onClick={onCancel} isDisabled={busy}>
          Cancel
        </Button>
      </HStack>

      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      {/* The root is never filtered away: it is what is being pushed. */}
      <VStack spacing={1} className="w-full">
        <span className="px-1 text-xs font-medium text-muted-foreground">
          Assembly
        </span>
        <div className="w-full rounded-md border border-border px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm"
                title={plan.root.name ?? plan.root.partNumber}
              >
                {plan.root.name ?? plan.root.partNumber}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {plan.root.partNumber}
                {plan.root.revision ? ` · Rev ${plan.root.revision}` : ""}
              </p>
            </div>
            <div className="shrink-0">
              <ItemActionBadge
                action={plan.root.action === "create" ? "create" : "reuse"}
              />
            </div>
          </div>
          <RowDisclosure
            summary={
              plan.root.action === "create" && plan.root.proposed
                ? `${plan.root.proposed.replenishmentSystem} · ${plan.root.proposed.defaultMethodType} · ${plan.root.proposed.itemTrackingType}`
                : "Fields from Onshape"
            }
            defaultOpen={!!review.fieldErrors[plan.root.partNumber]?.length}
          >
            {plan.root.action === "create" && plan.root.proposed
              ? editorFor(plan.root.partNumber, plan.root.proposed)
              : null}
            <RowCustomFields
              editKey={plan.root.partNumber}
              isCreate={plan.root.action === "create"}
              fields={plan.root.customFields}
              problems={plan.root.customFieldProblems}
              unmapped={plan.root.unmappedProperties}
              edit={
                plan.root.action === "create"
                  ? review.edits[plan.root.partNumber]
                  : undefined
              }
              disabled={review.applying}
              onEdit={onEditCustomField}
              onOpenFields={onOpenFields}
            />
          </RowDisclosure>
        </div>
      </VStack>

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

      {plan.items.length > 0 ? (
        <>
          <PlanToolbar
            query={query}
            onQuery={setQuery}
            group={group}
            onGroup={setGroup}
            counts={counts}
            total={plan.items.length}
            /*
             * Only create rows are includable, so with none there is nothing to
             * select — and showing "0 selected" next to "Push 8 to Carbon" reads
             * as a contradiction rather than as "every component is a reuse".
             */
            selectedCount={counts.create ? includedCount : null}
            onSelectAll={() => onIncludeMany(creatableVisible, true)}
            onClearSelection={() => onIncludeMany(creatableVisible, false)}
            disabled={busy}
          />

          {visible.length === 0 ? (
            <PanelEmpty>No components match</PanelEmpty>
          ) : (
            <ul className="w-full divide-y divide-border rounded-md border border-border">
              {visible.map((item) => {
                const included = !review.excluded.has(item.partNumber);
                return (
                  <li key={item.partNumber} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <HStack spacing={2} className="min-w-0 items-start">
                        {item.action === "create" ? (
                          <span className="flex h-lh items-center text-sm">
                            <Checkbox
                              checked={included}
                              disabled={review.applying}
                              aria-label={`Include ${item.partNumber}`}
                              onCheckedChange={(checked) =>
                                onInclude(item.partNumber, checked === true)
                              }
                            />
                          </span>
                        ) : null}
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
                      </HStack>
                      <div className="shrink-0">
                        <ItemActionBadge
                          action={item.action === "create" ? "create" : "reuse"}
                        />
                      </div>
                    </div>
                    {item.action === "create" && item.proposed && included ? (
                      <RowDisclosure
                        summary={`${item.proposed.replenishmentSystem} · ${item.proposed.defaultMethodType} · ${item.proposed.itemTrackingType}`}
                        defaultOpen={
                          !!review.fieldErrors[item.partNumber]?.length
                        }
                      >
                        {editorFor(item.partNumber, item.proposed)}
                      </RowDisclosure>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {/*
       * What the push will NOT write, and what it writes somewhere that is not
       * live, are both decided before Push — so they sit above it, not inside a
       * collapsed "Make methods" disclosure nobody had reason to open. A user
       * used to push, see a green success, and never learn four components
       * were left out of the BOM.
       */}
      {(() => {
        const described = plan.methods.map((method) =>
          describeMethod(method, review.excluded)
        );
        const wontWrite = [
          ...described.filter((d) => d.tone === "warning").map((d) => d.text),
          ...plan.skipped
        ];
        const drafts = described.filter((d) => d.tone === "notice");
        return (
          <>
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
          </>
        );
      })()}

      <details className="w-full">
        <summary className="cursor-pointer px-1 text-xs font-medium text-muted-foreground">
          Make methods · {plan.methods.length}
        </summary>
        <VStack spacing={1} className="mt-1 w-full">
          {plan.methods.map((method) => {
            const description = describeMethod(method, review.excluded);
            return (
              <p
                key={method.parentPartNumber}
                className={toneClass(description.tone)}
              >
                {description.text}
              </p>
            );
          })}
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
  replanning,
  onEdit,
  onChangeNotice,
  onCreateChangeNotice,
  onMakeDefault
}: ReviewSectionProps<ReleaseReview> & {
  onChangeNotice: (field: "name" | "description", value: string) => void;
  onCreateChangeNotice: (createChangeNotice: boolean) => void;
  onMakeDefault: (makeDefault: boolean) => void;
}) {
  const { plan } = review;
  const editorFor = (key: string, proposed: ProposedItem) => (
    <ItemEditor
      editKey={key}
      proposed={proposed}
      edit={review.edits[key]}
      errors={review.fieldErrors[key]}
      options={plan.options}
      disabled={review.applying}
      onEdit={onEdit}
    />
  );
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Review → Carbon</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          isDisabled={review.applying || replanning}
        >
          Cancel
        </Button>
      </HStack>
      <ReviewError
        review={review}
        replanning={replanning}
        onReplan={onReplan}
      />

      <p className="text-xs text-muted-foreground w-full">
        {plan.releaseName ?? "Release"}
      </p>
      {/*
       * Not a failure: the route deliberately keeps going when a BOM cannot be
       * read, and the apply leaves that method exactly as it is. Red prose
       * with no consequence stated read as "this push is broken".
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
      {plan.items.some((item) => item.methodStatus === "active") ? (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertTitle>
            {(() => {
              const n = plan.items.filter(
                (item) => item.methodStatus === "active"
              ).length;
              return n === 1
                ? "1 item is released in Carbon"
                : `${n} items are released in Carbon`;
            })()}
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
                <p className="text-sm truncate">
                  {item.partNumber}
                  <span className="text-muted-foreground">
                    {" "}
                    Rev {item.revision}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
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
            {item.action === "create" && item.proposed
              ? editorFor(item.partNumber, item.proposed)
              : null}
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
                      className="text-sm truncate"
                      title={child.name ?? child.partNumber}
                    >
                      {child.name ?? child.partNumber}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {child.partNumber}
                      {child.revision ? ` · Rev ${child.revision}` : ""}
                      {child.purchased ? " · purchased" : ""}
                    </p>
                  </div>
                  <ItemActionBadge
                    action={child.action === "create" ? "create" : "reuse"}
                  />
                </div>
                {child.action === "create" && child.proposed
                  ? editorFor(child.partNumber, child.proposed)
                  : null}
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}

      {plan.changeNotice && review.changeNotice ? (
        <VStack spacing={2} className="w-full">
          <HStack spacing={2} className="w-full">
            <Checkbox
              id="onshape-release-change-notice"
              checked={review.createChangeNotice}
              disabled={review.applying}
              onCheckedChange={(checked) =>
                onCreateChangeNotice(checked === true)
              }
            />
            <Label
              htmlFor="onshape-release-change-notice"
              className="cursor-pointer"
            >
              Record a change notice
            </Label>
          </HStack>
          {review.createChangeNotice ? (
            <>
              <Input
                size="sm"
                value={review.changeNotice.name}
                placeholder="Name"
                aria-label="Change notice name"
                isDisabled={review.applying}
                isInvalid={!!review.fieldErrors.changeNotice}
                onChange={(event) => onChangeNotice("name", event.target.value)}
              />
              <Input
                size="sm"
                value={review.changeNotice.description ?? ""}
                placeholder="Description"
                aria-label="Change notice description"
                isDisabled={review.applying}
                onChange={(event) =>
                  onChangeNotice("description", event.target.value)
                }
              />
              {review.fieldErrors.changeNotice?.map((message) => (
                <p key={message} className="text-xs text-destructive w-full">
                  {message}
                </p>
              ))}
            </>
          ) : null}
        </VStack>
      ) : null}

      <HStack spacing={2} className="w-full">
        <Checkbox
          id="onshape-release-make-default"
          checked={review.makeDefault}
          disabled={review.applying}
          onCheckedChange={(checked) => onMakeDefault(checked === true)}
        />
        <Label
          htmlFor="onshape-release-make-default"
          className="cursor-pointer"
        >
          Make the new revisions the default
        </Label>
      </HStack>

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

function PartStateBadge({ state }: { state: PanelPartStatus["state"] }) {
  if (state === "linked")
    return (
      <Status color="green" disableTooltip>
        In Carbon
      </Status>
    );
  if (state === "matched")
    return (
      <Status color="yellow" disableTooltip>
        Match found
      </Status>
    );
  return (
    <Status color="gray" disableTooltip>
      Not in Carbon
    </Status>
  );
}

/** Create / Reuse, the two outcomes an assembly or release component has. */
function ItemActionBadge({ action }: { action: "create" | "reuse" }) {
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

/**
 * What the user is looking at: the part number, revision and configuration,
 * and only when they are set.
 *
 * The raw Onshape ids are deliberately absent. They are 24-character hex —
 * three wrapped rows of noise above the content someone came for — and the
 * panel is not where you debug: an id worth quoting in a bug report is in the
 * document's own URL.
 */
function ContextSummary({ context }: { context: OnshapePanelContext }) {
  const named: Array<[string, string | null]> = [
    ["Part number", context.partNumber],
    ["Revision", context.revision],
    ["Configuration", context.configuration]
  ];

  const visible = named.filter(([, value]) => value);
  if (visible.length === 0) return null;

  return (
    <dl className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {visible.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
