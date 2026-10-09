// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ComboboxOption } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Combobox,
  cn,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
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
  TruncatedTooltipText,
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
  LuListChecks,
  LuLock,
  LuPlus,
  LuRefreshCw,
  LuTrash,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { bomParentIndexes, buildBomViewTree, visibleBomRows } from "./bom-view";
import { ItemFieldSelects } from "./ItemFieldSelects";
import type { OnshapePanelContext } from "./messages";
import { isPanelSessionMessage, postApplicationInit } from "./messages";
import type {
  AssemblyPlan,
  AssemblyPlanDepth,
  ItemFieldSnapshot,
  MappedRowPlan,
  OwnedFieldChange,
  PartPlan,
  PartPlanRow,
  PlanUnitOfMeasure,
  ProposedItem,
  ReleasePlan,
  ReleasePlanItem
} from "./plan";
import {
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./plan";
import type { OnshapePushDefaults } from "./preferences";
import { reconcilePushDefaults } from "./preferences";
import type {
  DescriptionModes,
  MappingMode,
  PlanCustomFieldDefinition,
  PropertyMapEntry,
  PropertyMapTarget
} from "./properties";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  customFieldDisplayValue,
  MAPPABLE_VALUE_TYPES,
  MAPPING_MODES,
  propertyMapEqual,
  targetKey
} from "./properties";
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
  CARBON_ONLY_NOTE,
  clearFieldErrors,
  createReview,
  customFieldChangeText,
  describeMethod,
  indexFieldErrors,
  itemFieldChangeText,
  keptDifferenceText,
  mappedValueText,
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
import type {
  StandardField,
  StandardFieldId,
  ValueTranslation
} from "./standard-fields";
import {
  defaultTranslations,
  matchingUnit,
  onshapeValueOptions,
  repeatedTranslationRows,
  STANDARD_FIELDS,
  standardField,
  standardFieldValues,
  untranslatedOptions
} from "./standard-fields";
import type { PanelPartStatus } from "./status";

export type PanelAssemblyLine = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
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
  /** An ENUM's options, when Onshape listed them. */
  options?: string[];
};

type PanelFieldsData = {
  properties: PanelFieldsProperty[];
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
  /** The company's units, for a Unit of Measure translation and default. */
  units: PlanUnitOfMeasure[];
  descriptionModes: DescriptionModes;
  /** What a push gives a new item when nothing maps a field. */
  pushDefaults: OnshapePushDefaults;
};

/** One entry of the draft map the Fields page posts. */
type FieldsDraftEntry = PropertyMapEntry;

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
      /** The draft modes of the two descriptions. */
      descriptionModes: DescriptionModes;
      /** The draft push defaults. */
      pushDefaults: OnshapePushDefaults;
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

/**
 * Every push reads these four: Part number and Revision name the item, Name
 * and Description fill its descriptions. The Fields page shows them as fixed
 * rows and never offers them as a mapping.
 */
const FIXED_PROPERTY_NAMES = new Set([
  "Part number",
  "Revision",
  "Name",
  "Description"
]);

/**
 * The Carbon types an Onshape value type may map onto. MAPPABLE_VALUE_TYPES
 * is a plain object, so a valueType of "constructor" would otherwise resolve
 * to Object.prototype's and crash the render on `.includes`.
 */
function mappableTypesFor(valueType: string): readonly number[] {
  if (!Object.hasOwn(MAPPABLE_VALUE_TYPES, valueType)) return [];
  return MAPPABLE_VALUE_TYPES[valueType] ?? [];
}

/** The draft entries for a map: copies, so an edit never touches the saved map. */
function fieldsDraft(map: PropertyMapEntry[]): FieldsDraftEntry[] {
  return map.map((entry) => ({
    ...entry,
    ...(entry.translations
      ? { translations: entry.translations.map((row) => ({ ...row })) }
      : {})
  }));
}

/** The target a Carbon field select value names, or null for none. */
function targetFromKey(key: string): PropertyMapTarget | null {
  if (key.startsWith("customField:")) {
    return { kind: "customField", fieldId: key.slice("customField:".length) };
  }
  const field = key.startsWith("item:")
    ? standardField(key.slice("item:".length))
    : undefined;
  return field ? { kind: "item", field: field.id } : null;
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
  /** Reused items whose mapped fields the push wrote. */
  fieldsUpdated?: number;
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
  const fieldsUpdated = s.fieldsUpdated ?? 0;
  const text =
    `${plural(s.itemsCreated, "item")} created, ${s.itemsReused} reused` +
    (fieldsUpdated > 0 ? ` (${fieldsUpdated} updated)` : "") +
    `, ${lines} across ${plural(s.methodsTouched, "method")}`;
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
      (s.changeNotice
        ? ` · change notice ${s.changeNotice} (release it in Carbon to activate them)`
        : "");
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
                descriptionModes: { ...body.descriptionModes },
                pushDefaults: { ...body.pushDefaults },
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
          body: JSON.stringify({
            entries: current.entries,
            descriptionModes: current.descriptionModes,
            pushDefaults: current.pushDefaults
          })
        });
        const body = (await response.json()) as
          | {
              map: PropertyMapEntry[];
              descriptionModes: DescriptionModes;
              pushDefaults: OnshapePushDefaults;
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
            descriptionModes: body.descriptionModes,
            pushDefaults: body.pushDefaults,
            // Null when the save landed but the re-read failed: keep the
            // definitions already on screen rather than emptying every select.
            definitions: body.definitions ?? current.data.definitions
          },
          entries: fieldsDraft(body.map),
          descriptionModes: { ...body.descriptionModes },
          pushDefaults: { ...body.pushDefaults },
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

  /**
   * Map one property to a target, or unmap it; every other entry survives. A
   * remapped property keeps its mode. A list item field starts with the
   * default translation.
   */
  const mapFieldsProperty = (
    property: PanelFieldsProperty,
    selection: string
  ) =>
    setFields((current) => {
      if (current.status !== "ready") return current;
      const previous = current.entries.find(
        (entry) => entry.onshapePropertyId === property.propertyId
      );
      const entries = current.entries.filter(
        (entry) => entry.onshapePropertyId !== property.propertyId
      );
      const target = targetFromKey(selection);
      if (target) {
        const field =
          target.kind === "item" ? standardField(target.field) : undefined;
        entries.push({
          onshapePropertyId: property.propertyId,
          onshapeName: property.name,
          valueType: property.valueType,
          target,
          mode: previous?.mode ?? "create",
          ...(field?.kind === "list"
            ? {
                translations: defaultTranslations(
                  field,
                  property.valueType,
                  property.options
                )
              }
            : {})
        });
      }
      return {
        ...current,
        entries,
        error: null,
        fieldErrors: clearFieldErrors(current.fieldErrors, property.propertyId)
      };
    });

  /** Change one mapped property's mode or translation. */
  const editFieldsEntry = (
    propertyId: string,
    patch: Partial<Pick<FieldsDraftEntry, "mode" | "translations">>
  ) =>
    setFields((current) => {
      if (current.status !== "ready") return current;
      return {
        ...current,
        entries: current.entries.map((entry) =>
          entry.onshapePropertyId === propertyId
            ? { ...entry, ...patch }
            : entry
        ),
        error: null,
        fieldErrors: clearFieldErrors(current.fieldErrors, propertyId)
      };
    });

  /**
   * Set where a Carbon field's value comes from: a property, or (null) none,
   * which for an item field with a push default means the default. The
   * field's previous property is unmapped and the chosen one leaves any other
   * field; a field that changes property keeps its mode.
   */
  const setTargetSource = (
    target: PropertyMapTarget,
    property: PanelFieldsProperty | null
  ) =>
    setFields((current) => {
      if (current.status !== "ready") return current;
      const key = targetKey(target);
      const feeds = (entry: FieldsDraftEntry) =>
        targetKey(entry.target) === key;
      const previous = current.entries.find(feeds);
      const entries = current.entries.filter(
        (entry) =>
          !feeds(entry) && entry.onshapePropertyId !== property?.propertyId
      );
      const field =
        target.kind === "item" ? standardField(target.field) : undefined;
      if (property) {
        entries.push({
          onshapePropertyId: property.propertyId,
          onshapeName: property.name,
          valueType: property.valueType,
          target,
          mode: previous?.mode ?? "create",
          ...(field?.kind === "list"
            ? {
                translations: defaultTranslations(
                  field,
                  property.valueType,
                  property.options
                )
              }
            : {})
        });
      }
      let fieldErrors = current.fieldErrors;
      for (const id of [previous?.onshapePropertyId, property?.propertyId]) {
        if (id) fieldErrors = clearFieldErrors(fieldErrors, id);
      }
      return { ...current, entries, error: null, fieldErrors };
    });

  /**
   * Change a push default. A new Replenishment keeps its method when the pair
   * is allowed, else takes the first allowed one, as the save requires.
   */
  const setPushDefaults = (patch: Partial<OnshapePushDefaults>) =>
    setFields((current) =>
      current.status === "ready"
        ? {
            ...current,
            pushDefaults: reconcilePushDefaults({
              ...current.pushDefaults,
              ...patch
            }),
            error: null
          }
        : current
    );

  const setDescriptionMode = (
    field: keyof DescriptionModes,
    mode: MappingMode
  ) =>
    setFields((current) =>
      current.status === "ready"
        ? {
            ...current,
            descriptionModes: { ...current.descriptionModes, [field]: mode },
            error: null
          }
        : current
    );

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

  /*
   * The first page's name and the Fields page both wait on the status read,
   * which says what kind of element this is. Until it lands the bar is one
   * skeleton as wide as the tabs expected, so they appear once, final.
   */
  const tabsPending =
    session.status === "signed-in" &&
    canLoadParts &&
    (parts.status === "idle" || parts.status === "loading");
  const pendingTabLabels = [
    "Assembly",
    ...(context.documentId ? ["Releases"] : []),
    ...(session.status === "signed-in" && session.me.canEditFields
      ? ["Fields"]
      : [])
  ];

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
        {tabsPending ? (
          // Sized by invisible copies of the tabs, the same padding as
          // TabsList and its triggers, so it is as wide as the bar after it.
          <Skeleton
            aria-hidden
            className="flex rounded-[0.5rem] border border-transparent p-0.5"
          >
            {pendingTabLabels.map((label) => (
              <span
                key={label}
                className="invisible border border-transparent px-3 py-1 text-sm font-medium"
              >
                {label}
              </span>
            ))}
          </Skeleton>
        ) : availableTabs.length > 1 ? (
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
              onTargetSource={setTargetSource}
              onEdit={editFieldsEntry}
              onDescriptionMode={setDescriptionMode}
              onPushDefaults={setPushDefaults}
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

/** The words for each mode, on the Fields page. */
const MODE_LABEL: Record<MappingMode, string> = {
  create: "Set at creation",
  everyPush: "Update on every push"
};

/** What a mode does, one line under it in the dropdown. */
function modeHelper(mode: MappingMode, cascades: boolean): string {
  if (mode === "create") return "Only items a push creates get it";
  return cascades
    ? "Every push overwrites it, Draft BOMs and jobs too"
    : "Every push overwrites Carbon's value";
}

/** Radix Select refuses an empty item value, so "No value" is named. */
const TRANSLATION_NO_VALUE = "__no-value__";
/** An Onshape option with no row: the review flags it. */
const TRANSLATION_UNSET = "__unset__";

/** The Carbon type an Onshape value type reads as, in the property select. */
const VALUE_TYPE_LABEL: Record<string, string> = {
  STRING: "Text",
  ENUM: "List",
  BOOL: "Yes/No",
  INT: "Number",
  DOUBLE: "Number",
  DATE: "Date",
  OBJECT: "Text (display name)"
};

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The company's property map. Onshape lists properties only from inside a
 * document, which is why this page is the one setting the panel keeps. It
 * shows what every push applies, then the company's mappings; a mapping is
 * added by picking a property and a Carbon field.
 */
function FieldsSection({
  state,
  onMap,
  onTargetSource,
  onEdit,
  onDescriptionMode,
  onPushDefaults,
  onRefresh,
  onSave
}: {
  state: Exclude<PanelFieldsState, { status: "closed" }>;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onTargetSource: (
    target: PropertyMapTarget,
    property: PanelFieldsProperty | null
  ) => void;
  onEdit: (
    propertyId: string,
    patch: Partial<Pick<FieldsDraftEntry, "mode" | "translations">>
  ) => void;
  onDescriptionMode: (field: keyof DescriptionModes, mode: MappingMode) => void;
  onPushDefaults: (patch: Partial<OnshapePushDefaults>) => void;
  onRefresh: () => void;
  onSave: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmingRefresh, setConfirmingRefresh] = useState(false);
  // Unsaved edits: Refresh replaces the draft with the saved map, so it asks.
  const dirty =
    state.status === "ready" &&
    (!propertyMapEqual(state.entries, state.data.map) ||
      state.descriptionModes.name !== state.data.descriptionModes.name ||
      state.descriptionModes.description !==
        state.data.descriptionModes.description ||
      !pushDefaultsEqual(state.pushDefaults, state.data.pushDefaults));
  const header = (
    <HStack className="w-full justify-between">
      <span className="text-sm font-medium">Fields</span>
      {confirmingRefresh ? (
        <Modal
          open
          onOpenChange={(open) =>
            open ? undefined : setConfirmingRefresh(false)
          }
        >
          <ModalContent size="small" aria-describedby={undefined}>
            <ModalHeader>
              <ModalTitle>Discard unsaved changes?</ModalTitle>
            </ModalHeader>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setConfirmingRefresh(false)}
              >
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmingRefresh(false);
                  onRefresh();
                }}
              >
                Discard and refresh
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => (dirty ? setConfirmingRefresh(true) : onRefresh())}
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
  const propertyById = new Map(
    data.properties.map((property) => [property.propertyId, property])
  );
  // A Carbon field takes one property: the property each is mapped from.
  const mappedFrom = new Map(
    state.entries.map((entry) => [targetKey(entry.target), entry])
  );
  // A property feeds one field: the mapping each property is in.
  const mappingOf = new Map(
    state.entries.map((entry) => [entry.onshapePropertyId, entry])
  );
  const offered = data.properties
    .filter(
      (property) =>
        property.mappable && !FIXED_PROPERTY_NAMES.has(property.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  // Item fields with a row of their own are set there; the rest are rows of
  // their own only once mapped.
  const otherEntries = state.entries.filter(
    (entry) =>
      !(
        entry.target.kind === "item" &&
        ITEM_FIELD_ROW_FIELDS.has(entry.target.field)
      )
  );
  // Every entry has a row, so an error naming another property is a stray.
  const listed = new Set(state.entries.map((entry) => entry.onshapePropertyId));
  const strayErrors = Object.entries(state.fieldErrors)
    .filter(([propertyId]) => !listed.has(propertyId))
    .flatMap(([propertyId, messages]) =>
      messages.map((message) => ({ propertyId, message }))
    );
  const addable = offered.filter(
    (property) => !listed.has(property.propertyId)
  );
  const busy = state.saving || !!state.refreshing;
  // The properties a target can take, with the one it holds even when that
  // property is mapped from another document and not on this element.
  const candidatesFor = (
    target: PropertyMapTarget,
    entry: FieldsDraftEntry | undefined
  ): PanelFieldsProperty[] => {
    const takes = (valueType: string) => {
      if (target.kind === "item") {
        return !!standardField(target.field)?.valueTypes.includes(valueType);
      }
      const definition = data.definitions.find(
        (field) => field.id === target.fieldId
      );
      return (
        !!definition &&
        mappableTypesFor(valueType).includes(definition.dataTypeId)
      );
    };
    const candidates = offered.filter((property) => takes(property.valueType));
    return entry &&
      !candidates.some((c) => c.propertyId === entry.onshapePropertyId)
      ? [
          ...candidates,
          {
            propertyId: entry.onshapePropertyId,
            name: entry.onshapeName,
            valueType: entry.valueType,
            mappable: true
          }
        ]
      : candidates;
  };

  return (
    <VStack spacing={3} className="w-full">
      {header}
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
      {strayErrors.map(({ propertyId, message }) => (
        <p
          key={`${propertyId}:${message}`}
          className="w-full text-xs text-destructive"
        >
          {message}
        </p>
      ))}

      <ul className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
        <FieldRow
          source={<SourceText>Part number</SourceText>}
          carbon="Part ID"
          control={<AlwaysTag />}
        />
        <FieldRow
          source={<SourceText>Revision</SourceText>}
          carbon="Revision"
          control={<AlwaysTag />}
        />
        <FieldRow
          source={<SourceText>Name</SourceText>}
          carbon="Short Description"
          control={
            <ModeSelect
              mode={state.descriptionModes.name}
              label="Short Description: when Onshape writes it"
              disabled={busy}
              onChange={(mode) => onDescriptionMode("name", mode)}
            />
          }
        />
        <FieldRow
          source={<SourceText>Description</SourceText>}
          carbon="Long Description"
          control={
            <ModeSelect
              mode={state.descriptionModes.description}
              label="Long Description: when Onshape writes it"
              disabled={busy}
              onChange={(mode) => onDescriptionMode("description", mode)}
            />
          }
        />
        {ITEM_FIELD_ROWS.map((row) => {
          const target: PropertyMapTarget | null = row.field
            ? { kind: "item", field: row.field }
            : null;
          const entry = target ? mappedFrom.get(targetKey(target)) : undefined;
          return (
            <ItemFieldRow
              key={row.key}
              row={row}
              defaults={state.pushDefaults}
              entry={entry}
              property={
                entry ? propertyById.get(entry.onshapePropertyId) : undefined
              }
              candidates={target ? candidatesFor(target, entry) : []}
              mappingOf={mappingOf}
              definitions={data.definitions}
              units={data.units}
              errors={
                entry ? state.fieldErrors[entry.onshapePropertyId] : undefined
              }
              disabled={busy}
              onSource={(property) =>
                target && onTargetSource(target, property)
              }
              onDefault={onPushDefaults}
              onEdit={(patch) =>
                entry && onEdit(entry.onshapePropertyId, patch)
              }
            />
          );
        })}
        {otherEntries.map((entry) => (
          <MappingRow
            key={entry.onshapePropertyId}
            entry={entry}
            property={propertyById.get(entry.onshapePropertyId)}
            candidates={candidatesFor(entry.target, entry)}
            mappingOf={mappingOf}
            definitions={data.definitions}
            units={data.units}
            errors={state.fieldErrors[entry.onshapePropertyId]}
            disabled={busy}
            onSource={(property) => onTargetSource(entry.target, property)}
            onEdit={(patch) => onEdit(entry.onshapePropertyId, patch)}
          />
        ))}
        {adding ? (
          <AddMappingRow
            properties={addable}
            mappedFrom={mappedFrom}
            definitions={data.definitions}
            disabled={busy}
            onAdd={(property, selection) => {
              onMap(property, selection);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
      </ul>
      {adding ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          leftIcon={<LuPlus />}
          isDisabled={busy || addable.length === 0}
          onClick={() => setAdding(true)}
        >
          Add mapping
        </Button>
      )}

      {/* Pinned like a review's push button; see ReviewActionBar. */}
      <div className="sticky -bottom-4 -mx-4 mt-1 w-[calc(100%+--spacing(8))] border-t border-border bg-card px-4 py-2">
        <Button
          className="w-full"
          onClick={onSave}
          isDisabled={!dirty || busy}
          isLoading={state.saving}
        >
          {dirty ? "Save" : "No changes"}
        </Button>
      </div>
    </VStack>
  );
}

function pushDefaultsEqual(
  a: OnshapePushDefaults,
  b: OnshapePushDefaults
): boolean {
  return (
    a.replenishmentSystem === b.replenishmentSystem &&
    a.methodTypeForMake === b.methodTypeForMake &&
    a.methodTypeForBuy === b.methodTypeForBuy &&
    a.itemTrackingType === b.itemTrackingType &&
    a.unitOfMeasureCode === b.unitOfMeasureCode
  );
}

/** Radix Select refuses an empty item value, so "the company's unit" is named. */
const DEFAULT_UNIT_AUTOMATIC = "__automatic__";

/** A source select's values: the push default, none, or a property by id. */
const SOURCE_DEFAULT = "__default__";
const SOURCE_NONE = "__none__";
const SOURCE_PROPERTY = "property:";

/**
 * The item fields a push always fills: from a mapped property, else from the
 * push default under `key`. The Buy items method is a default only; a mapped
 * Default Method Type covers every item.
 */
const ITEM_FIELD_ROWS: {
  key: keyof OnshapePushDefaults;
  field: StandardFieldId | null;
  label: string;
}[] = [
  {
    key: "replenishmentSystem",
    field: "replenishmentSystem",
    label: "Replenishment"
  },
  {
    key: "methodTypeForMake",
    field: "defaultMethodType",
    label: "Default Method Type"
  },
  {
    key: "methodTypeForBuy",
    field: null,
    label: "Default Method Type for Buy items"
  },
  {
    key: "itemTrackingType",
    field: "itemTrackingType",
    label: "Tracking Type"
  },
  {
    key: "unitOfMeasureCode",
    field: "unitOfMeasureCode",
    label: "Unit of Measure"
  }
];

/** The item fields with a row of their own; Add mapping does not offer them. */
const ITEM_FIELD_ROW_FIELDS = new Set<string>(
  ITEM_FIELD_ROWS.flatMap((row) => (row.field ? [row.field] : []))
);

type SelectOption = { value: string; label: string; helper?: string };

/** The values a push default can take, with the text each shows. */
function defaultValueOptions(
  key: keyof OnshapePushDefaults,
  defaults: OnshapePushDefaults,
  units: PlanUnitOfMeasure[]
): SelectOption[] {
  const plain = (values: readonly string[]) =>
    values.map((value) => ({ value, label: value }));
  switch (key) {
    case "replenishmentSystem":
      return plain(ITEM_REPLENISHMENT_SYSTEMS);
    case "methodTypeForMake":
      return plain(
        VALID_METHOD_TYPES_BY_REPLENISHMENT[defaults.replenishmentSystem]
      );
    case "methodTypeForBuy":
      return plain(VALID_METHOD_TYPES_BY_REPLENISHMENT.Buy);
    case "itemTrackingType":
      return plain(ITEM_TRACKING_TYPES);
    case "unitOfMeasureCode":
      return [
        {
          value: DEFAULT_UNIT_AUTOMATIC,
          label: "Automatic",
          helper: "EA, or the company's first unit"
        },
        ...units.map((unit) => ({
          value: unit.code,
          label: `${unit.code} · ${unit.name}`
        }))
      ];
  }
}

/** A push default as a select value; the unit's null is "Automatic". */
function defaultValueKey(
  key: keyof OnshapePushDefaults,
  defaults: OnshapePushDefaults
): string {
  return defaults[key] ?? DEFAULT_UNIT_AUTOMATIC;
}

/** A select value back to the push default patch it sets. */
function defaultPatch(
  key: keyof OnshapePushDefaults,
  value: string
): Partial<OnshapePushDefaults> {
  if (key === "unitOfMeasureCode") {
    return {
      unitOfMeasureCode: value === DEFAULT_UNIT_AUTOMATIC ? null : value
    };
  }
  return { [key]: value } as Partial<OnshapePushDefaults>;
}

/**
 * One row of the Fields page: where the value comes from, the Carbon field it
 * lands in, one control, and one icon. Every row is the same grid, so the
 * arrows and controls line up down the page whatever the text.
 */
function FieldRow({
  source,
  carbon,
  control,
  action,
  notes
}: {
  source: ReactNode;
  carbon: ReactNode;
  control?: ReactNode;
  action?: ReactNode;
  /** Errors or a hint, under the row. */
  notes?: ReactNode;
}) {
  return (
    <li className="flex w-full flex-col gap-1 px-3 py-1.5">
      <div className={FIELD_ROW_GRID}>
        <div className="min-w-0 text-sm">{source}</div>
        <LuArrowRight
          aria-hidden
          className="size-3.5 justify-self-center text-muted-foreground"
        />
        <div className="min-w-0 text-sm">
          {typeof carbon === "string" ? (
            <FieldName>{carbon}</FieldName>
          ) : (
            carbon
          )}
        </div>
        <div className="min-w-0">{control}</div>
        <div className="flex size-8 items-center justify-center">{action}</div>
      </div>
      {notes ? <div className="px-1">{notes}</div> : null}
    </li>
  );
}

/**
 * Source, arrow, Carbon field, control, icon: the same in every row. The
 * control column fits "Update on every push" whole.
 */
const FIELD_ROW_GRID =
  "grid w-full grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_200px_32px] items-center gap-x-2";

/**
 * A field or property name in a narrow column: it wraps to two lines, and a
 * name still too long shows whole in a tooltip.
 */
function FieldName({
  children,
  emphasis
}: {
  children: string;
  emphasis?: boolean;
}) {
  return (
    <TruncatedTooltipText
      tooltip={children}
      className={cn(
        "line-clamp-2 break-words px-1 leading-snug",
        emphasis && "font-medium"
      )}
    >
      {children}
    </TruncatedTooltipText>
  );
}

/** A fixed source, padded like a picker's text so the two line up. */
function SourceText({ children }: { children: string }) {
  return <FieldName emphasis>{children}</FieldName>;
}

/**
 * A source the user can change: a searchable list, drawn like the fixed rows'
 * text so every row reads the same. An option the field cannot take now (a
 * property another field holds) is left out, and each option's group shows
 * on its helper line.
 */
function SourceSelect({
  value,
  label,
  groups,
  disabled,
  placeholder,
  onChange
}: {
  value: string | undefined;
  label: string;
  groups: {
    label?: string;
    options: (SelectOption & { disabled?: boolean })[];
  }[];
  disabled: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const options: ComboboxOption[] = groups.flatMap((group) =>
    group.options
      .filter((option) => !option.disabled)
      .map((option) => ({
        value: option.value,
        label: option.label,
        helper:
          [group.label, option.helper].filter(Boolean).join(" · ") || undefined
      }))
  );
  return (
    <div className="w-full min-w-0">
      <Combobox
        size="sm"
        value={value}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        className="h-7 min-w-0 gap-1 border-transparent bg-transparent px-1 font-medium shadow-none hover:bg-accent"
        onChange={onChange}
      />
    </div>
  );
}

/** The properties a source select offers; a taken one is marked disabled. */
function propertyOptions(
  candidates: PanelFieldsProperty[],
  own: FieldsDraftEntry | undefined,
  mappingOf: Map<string, FieldsDraftEntry>,
  definitions: PlanCustomFieldDefinition[]
): (SelectOption & { disabled?: boolean })[] {
  return candidates.map((candidate) => {
    const elsewhere = mappingOf.get(candidate.propertyId);
    const taken = elsewhere !== undefined && elsewhere !== own;
    return {
      value: `${SOURCE_PROPERTY}${candidate.propertyId}`,
      label: candidate.name,
      disabled: taken,
      helper: taken
        ? `Mapped to ${targetLabel(elsewhere.target, definitions)}`
        : (VALUE_TYPE_LABEL[candidate.valueType] ?? candidate.valueType)
    };
  });
}

function AlwaysTag() {
  return (
    <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <LuLock aria-hidden className="size-3" />
      Always
    </span>
  );
}

/** "Set at creation" or "Update on every push"; what each does is in the dropdown. */
function ModeSelect({
  mode,
  label,
  disabled,
  cascades = false,
  onChange
}: {
  mode: MappingMode;
  label: string;
  disabled: boolean;
  /** The field changes Draft BOMs or open jobs when it is written. */
  cascades?: boolean;
  onChange: (mode: MappingMode) => void;
}) {
  return (
    <Select
      value={mode}
      onValueChange={(value) => onChange(value as MappingMode)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[300px]">
        {MAPPING_MODES.map((value) => (
          <SelectItem
            key={value}
            value={value}
            helper={modeHelper(value, cascades)}
          >
            {MODE_LABEL[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A push default's value. */
function DefaultValueSelect({
  options,
  value,
  label,
  disabled,
  onChange
}: {
  options: SelectOption[];
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[220px]">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            helper={option.helper}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The Carbon field a mapping writes, as the page names it. */
function targetLabel(
  target: PropertyMapTarget,
  definitions: PlanCustomFieldDefinition[]
): string {
  if (target.kind === "item") {
    return standardField(target.field)?.label ?? target.field;
  }
  return (
    definitions.find((definition) => definition.id === target.fieldId)?.name ??
    "Deleted field"
  );
}

function rowErrors(errors: string[] | undefined): ReactNode {
  return errors?.map((message) => (
    <p key={message} className="text-xs text-destructive">
      {message}
    </p>
  ));
}

/**
 * The list values of a mapped list field, behind an icon: amber while an
 * Onshape option has no Carbon value. The window also holds the field's push
 * default when it has one, the value a new item gets when Onshape gives none.
 */
function ValuesButton({
  entry,
  property,
  field,
  units,
  disabled,
  fallback,
  onEdit
}: {
  entry: FieldsDraftEntry;
  property: PanelFieldsProperty | undefined;
  field: StandardField;
  units: PlanUnitOfMeasure[];
  disabled: boolean;
  fallback?: {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
  };
  onEdit: (
    patch: Partial<Pick<FieldsDraftEntry, "mode" | "translations">>
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = onshapeValueOptions(entry.valueType, property?.options);
  const translations = entry.translations ?? [];
  const untranslated = options
    ? untranslatedOptions(field, options, translations, units)
    : [];
  const summary = options
    ? `Values: ${options.length - untranslated.length} of ${options.length} mapped`
    : `Values: ${translations.length}`;
  return (
    <>
      <IconButton
        aria-label={summary}
        title={summary}
        icon={untranslated.length > 0 ? <LuTriangleAlert /> : <LuListChecks />}
        variant="ghost"
        size="sm"
        className={
          untranslated.length > 0
            ? "text-amber-600 dark:text-amber-400"
            : undefined
        }
        isDisabled={disabled}
        onClick={() => setOpen(true)}
      />
      {open ? (
        <ValuesModal
          title={`${entry.onshapeName} → ${field.label}`}
          field={field}
          options={options}
          translations={translations}
          units={units}
          fallback={fallback}
          onApply={(next, fallbackValue) => {
            onEdit({ translations: next });
            if (fallback && fallbackValue !== undefined) {
              fallback.onChange(fallbackValue);
            }
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * An item field a push always fills. The source is its push default until an
 * Onshape property replaces it; the control is then the default's value, or
 * the mapping's mode. A mapped list field keeps the default in its values
 * window, for a part whose property gives no value.
 */
function ItemFieldRow({
  row,
  defaults,
  entry,
  property,
  candidates,
  mappingOf,
  definitions,
  units,
  errors,
  disabled,
  onSource,
  onDefault,
  onEdit
}: {
  row: (typeof ITEM_FIELD_ROWS)[number];
  defaults: OnshapePushDefaults;
  /** The mapping that feeds this field, if any. */
  entry: FieldsDraftEntry | undefined;
  property: PanelFieldsProperty | undefined;
  /** The properties whose value type the field takes. */
  candidates: PanelFieldsProperty[];
  /** The mapping each property is in, by property id. */
  mappingOf: Map<string, FieldsDraftEntry>;
  definitions: PlanCustomFieldDefinition[];
  units: PlanUnitOfMeasure[];
  errors: string[] | undefined;
  disabled: boolean;
  onSource: (property: PanelFieldsProperty | null) => void;
  onDefault: (patch: Partial<OnshapePushDefaults>) => void;
  onEdit: (
    patch: Partial<Pick<FieldsDraftEntry, "mode" | "translations">>
  ) => void;
}) {
  const field = row.field ? standardField(row.field) : undefined;
  const defaultOptions = defaultValueOptions(row.key, defaults, units);
  const defaultValue = defaultValueKey(row.key, defaults);
  const setDefault = (value: string) => onDefault(defaultPatch(row.key, value));
  const source = field ? (
    <SourceSelect
      value={
        entry ? `${SOURCE_PROPERTY}${entry.onshapePropertyId}` : SOURCE_DEFAULT
      }
      label={`${row.label}: source`}
      groups={[
        {
          options: [
            {
              value: SOURCE_DEFAULT,
              label: "Default",
              helper: "The value you pick on this row"
            }
          ]
        },
        {
          label: "Onshape property",
          options: propertyOptions(candidates, entry, mappingOf, definitions)
        }
      ]}
      disabled={disabled}
      onChange={(value) => {
        if (value === SOURCE_DEFAULT) {
          if (entry) onSource(null);
          return;
        }
        const chosen = candidates.find(
          (c) => c.propertyId === value.slice(SOURCE_PROPERTY.length)
        );
        if (chosen) onSource(chosen);
      }}
    />
  ) : (
    <SourceText>Default</SourceText>
  );
  return (
    <FieldRow
      source={source}
      carbon={row.label}
      control={
        entry ? (
          <ModeSelect
            mode={entry.mode}
            label={`${row.label}: when Onshape writes it`}
            disabled={disabled}
            cascades={field?.cascades}
            onChange={(mode) => onEdit({ mode })}
          />
        ) : (
          <DefaultValueSelect
            options={defaultOptions}
            value={defaultValue}
            label={`${row.label}: default`}
            disabled={disabled}
            onChange={setDefault}
          />
        )
      }
      action={
        entry && field?.kind === "list" ? (
          <ValuesButton
            entry={entry}
            property={property}
            field={field}
            units={units}
            disabled={disabled}
            fallback={{
              options: defaultOptions,
              value: defaultValue,
              onChange: setDefault
            }}
            onEdit={onEdit}
          />
        ) : null
      }
      notes={rowErrors(errors)}
    />
  );
}

/**
 * A mapped field with no push default: MPN, Sourcing, a part custom field.
 * Its source can move to another property, or to "Not mapped", which removes
 * the row.
 */
function MappingRow({
  entry,
  property,
  candidates,
  mappingOf,
  definitions,
  units,
  errors,
  disabled,
  onSource,
  onEdit
}: {
  entry: FieldsDraftEntry;
  /** The property on this element; absent when it is mapped from another. */
  property: PanelFieldsProperty | undefined;
  candidates: PanelFieldsProperty[];
  mappingOf: Map<string, FieldsDraftEntry>;
  definitions: PlanCustomFieldDefinition[];
  units: PlanUnitOfMeasure[];
  errors: string[] | undefined;
  disabled: boolean;
  onSource: (property: PanelFieldsProperty | null) => void;
  onEdit: (
    patch: Partial<Pick<FieldsDraftEntry, "mode" | "translations">>
  ) => void;
}) {
  const itemField =
    entry.target.kind === "item"
      ? standardField(entry.target.field)
      : undefined;
  const carbon = targetLabel(entry.target, definitions);
  return (
    <FieldRow
      source={
        <SourceSelect
          value={`${SOURCE_PROPERTY}${entry.onshapePropertyId}`}
          label={`${carbon}: source`}
          groups={[
            {
              options: [
                {
                  value: SOURCE_NONE,
                  label: "Not mapped",
                  helper: "Removes this row"
                }
              ]
            },
            {
              label: "Onshape property",
              options: propertyOptions(
                candidates,
                entry,
                mappingOf,
                definitions
              )
            }
          ]}
          disabled={disabled}
          onChange={(value) => {
            if (value === SOURCE_NONE) {
              onSource(null);
              return;
            }
            const chosen = candidates.find(
              (c) => c.propertyId === value.slice(SOURCE_PROPERTY.length)
            );
            if (chosen) onSource(chosen);
          }}
        />
      }
      carbon={carbon}
      control={
        <ModeSelect
          mode={entry.mode}
          label={`${carbon}: when Onshape writes it`}
          disabled={disabled}
          cascades={itemField?.cascades}
          onChange={(mode) => onEdit({ mode })}
        />
      }
      action={
        itemField?.kind === "list" ? (
          <ValuesButton
            entry={entry}
            property={property}
            field={itemField}
            units={units}
            disabled={disabled}
            onEdit={onEdit}
          />
        ) : null
      }
      notes={rowErrors(errors)}
    />
  );
}

/** A new row: pick an Onshape property, then the Carbon field it writes. */
function AddMappingRow({
  properties,
  mappedFrom,
  definitions,
  disabled,
  onAdd,
  onCancel
}: {
  /** The properties this element offers that are not mapped yet. */
  properties: PanelFieldsProperty[];
  /** The entry each Carbon field is mapped from, by `targetKey`. */
  mappedFrom: Map<string, FieldsDraftEntry>;
  definitions: PlanCustomFieldDefinition[];
  disabled: boolean;
  onAdd: (property: PanelFieldsProperty, selection: string) => void;
  onCancel: () => void;
}) {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const property = properties.find((entry) => entry.propertyId === propertyId);
  const allowed = property ? mappableTypesFor(property.valueType) : [];
  const customOptions = property
    ? definitions.filter((definition) =>
        allowed.includes(definition.dataTypeId)
      )
    : [];
  // An item field with a row of its own is set in that row.
  const itemOptions = property
    ? STANDARD_FIELDS.filter(
        (field) =>
          !ITEM_FIELD_ROW_FIELDS.has(field.id) &&
          field.valueTypes.includes(property.valueType)
      )
    : [];
  // A field another property is mapped to stays listed, disabled, with that
  // property's name, so the clash shows before the save refuses it.
  const targetOption = (key: string, label: string) => {
    const holder = mappedFrom.get(key)?.onshapeName ?? null;
    return {
      value: key,
      label,
      disabled: holder !== null,
      helper: holder ? `Mapped from ${holder}` : undefined
    };
  };
  const neededTypes = allowed
    .map((dataTypeId) => CUSTOM_FIELD_TYPE_LABELS[dataTypeId])
    .filter(Boolean)
    .join(" or ");
  const noTarget =
    !!property && itemOptions.length === 0 && customOptions.length === 0;
  return (
    <FieldRow
      source={
        <SourceSelect
          value={propertyId ?? undefined}
          placeholder="Onshape property"
          label="Onshape property"
          groups={[
            {
              options: properties.map((entry) => ({
                value: entry.propertyId,
                label: entry.name,
                helper: VALUE_TYPE_LABEL[entry.valueType] ?? entry.valueType
              }))
            }
          ]}
          disabled={disabled}
          onChange={setPropertyId}
        />
      }
      carbon={
        <SourceSelect
          // Remounts on a new property, so no stale field stays picked.
          key={propertyId ?? ""}
          value={undefined}
          placeholder="Carbon field"
          label="Carbon field"
          groups={[
            {
              label: "Item fields",
              options: itemOptions.map((field) =>
                targetOption(
                  targetKey({ kind: "item", field: field.id }),
                  field.label
                )
              )
            },
            {
              label: "Custom fields",
              options: customOptions.map((definition) =>
                targetOption(
                  targetKey({ kind: "customField", fieldId: definition.id }),
                  definition.name
                )
              )
            }
          ]}
          disabled={disabled || !property || noTarget}
          onChange={(value) => property && onAdd(property, value)}
        />
      }
      action={
        <IconButton
          aria-label="Cancel the new mapping"
          icon={<LuX />}
          variant="ghost"
          size="sm"
          onClick={onCancel}
        />
      }
      notes={
        noTarget && property ? (
          <p className="text-xs text-muted-foreground">
            No Carbon field takes a {property.valueType} value
            {neededTypes
              ? `. Add a ${neededTypes} part custom field in Carbon to map it.`
              : "."}
          </p>
        ) : null
      }
    />
  );
}

type ValuesDraftRow = {
  onshape: string;
  /** A Carbon value, null for "No value", or TRANSLATION_UNSET for no row. */
  carbon: string | null;
  /** One of the Onshape list's own options: its text is fixed. */
  fixed: boolean;
};

/**
 * The value translation of a list item field: Onshape value → Carbon value.
 * With the Onshape list's options known, each is a fixed row; an option left
 * "Not mapped" has no row, so the review flags it. A typed row covers a value
 * the options do not list.
 */
function ValuesModal({
  title,
  field,
  options,
  translations,
  units,
  fallback,
  onApply,
  onClose
}: {
  title: string;
  field: StandardField;
  options: string[] | null;
  translations: ValueTranslation[];
  units: PlanUnitOfMeasure[];
  /** The field's push default: what a new item gets when Onshape gives none. */
  fallback?: { options: SelectOption[]; value: string };
  onApply: (translations: ValueTranslation[], fallback?: string) => void;
  onClose: () => void;
}) {
  const [fallbackValue, setFallbackValue] = useState(fallback?.value);
  // Rows that repeat a value listed above, found on Apply.
  const [repeated, setRepeated] = useState<number[]>([]);
  const [rows, setRows] = useState<ValuesDraftRow[]>(() => [
    ...(options ?? []).map((option) => {
      const saved = translations.find((row) => sameText(row.onshape, option));
      return {
        onshape: option,
        carbon: saved ? saved.carbon : TRANSLATION_UNSET,
        fixed: true
      };
    }),
    ...translations
      .filter(
        (row) =>
          !(options ?? []).some((option) => sameText(option, row.onshape))
      )
      .map((row) => ({ ...row, fixed: false }))
  ]);
  const values = standardFieldValues(field, units);
  const unitName = new Map(units.map((unit) => [unit.code, unit.name]));
  const isUnit = field.id === "unitOfMeasureCode";
  const update = (index: number, patch: Partial<ValuesDraftRow>) => {
    setRepeated([]);
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row))
    );
  };
  const apply = () => {
    // The save refuses two rows for one value; stop it here, on the row.
    const repeats = repeatedTranslationRows(rows);
    if (repeats.length > 0) {
      setRepeated(repeats);
      return;
    }
    onApply(
      rows
        .filter(
          (row) => row.carbon !== TRANSLATION_UNSET && row.onshape.trim() !== ""
        )
        .map((row) => ({ onshape: row.onshape.trim(), carbon: row.carbon })),
      fallbackValue
    );
  };
  // What an unset option or "No value" ends as: the field's default on a new
  // item, else nothing; an unset option also warns in the review.
  const unsetHelper = fallback
    ? "Uses the default, with a review warning"
    : "Not written, with a review warning";
  const noValueHelper = fallback ? "Uses the default" : "Not written";
  const valueOptions: ComboboxOption[] = values.map((value) => ({
    value,
    label: unitName.get(value) ? `${value} · ${unitName.get(value)}` : value
  }));
  // A unit option with no row still lands on the unit its code or name
  // matches, so the row says which one, muted and marked so it does not read
  // as a value someone chose.
  const optionsFor = (row: ValuesDraftRow): ComboboxOption[] => {
    const match = isUnit ? matchingUnit(row.onshape, units) : null;
    return [
      ...(row.fixed
        ? [
            match
              ? {
                  value: TRANSLATION_UNSET,
                  label: (
                    <span className="text-muted-foreground">
                      {`${match.unit.code} · ${match.unit.name} (matched)`}
                    </span>
                  ),
                  helper: `By unit ${match.by}`
                }
              : {
                  value: TRANSLATION_UNSET,
                  label: "Not mapped",
                  helper: unsetHelper
                }
          ]
        : []),
      { value: TRANSLATION_NO_VALUE, label: "No value", helper: noValueHelper },
      ...valueOptions
    ];
  };
  return (
    <Modal open onOpenChange={(open) => (open ? undefined : onClose())}>
      <ModalContent size="medium" aria-describedby={undefined}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex w-full flex-col gap-3">
            <div className="flex w-full flex-col gap-1">
              <div
                className={cn(
                  VALUES_ROW_GRID,
                  "px-3 text-xs font-medium text-muted-foreground"
                )}
              >
                <span className="px-1">Onshape value</span>
                <span />
                <span>Carbon value</span>
                <span />
              </div>
              <ul className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
                {rows.map((row, index) => (
                  // Rows have no id of their own; their order is stable while editing.
                  <li
                    key={index}
                    className={cn(VALUES_ROW_GRID, "px-3 py-1.5")}
                  >
                    {row.fixed ? (
                      <SourceText>{row.onshape}</SourceText>
                    ) : (
                      <Input
                        size="sm"
                        value={row.onshape}
                        placeholder="Onshape value"
                        aria-label={`Onshape value ${index + 1}`}
                        onChange={(event) =>
                          update(index, { onshape: event.target.value })
                        }
                      />
                    )}
                    <LuArrowRight
                      aria-hidden
                      className="size-3.5 justify-self-center text-muted-foreground"
                    />
                    <Combobox
                      size="sm"
                      value={
                        row.carbon === TRANSLATION_UNSET
                          ? TRANSLATION_UNSET
                          : (row.carbon ?? TRANSLATION_NO_VALUE)
                      }
                      options={optionsFor(row)}
                      aria-label={`Carbon value for ${row.onshape || "this row"}`}
                      onChange={(value) => {
                        if (!value) return;
                        update(index, {
                          carbon: value === TRANSLATION_NO_VALUE ? null : value
                        });
                      }}
                    />
                    <div className="flex size-8 items-center justify-center">
                      {row.fixed ? null : (
                        <IconButton
                          aria-label={`Remove ${row.onshape || "row"}`}
                          icon={<LuTrash />}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setRows((current) =>
                              current.filter((_, at) => at !== index)
                            )
                          }
                        />
                      )}
                    </div>
                    {repeated.includes(index) ? (
                      <span className="col-span-full px-1 text-xs text-destructive">
                        "{row.onshape.trim()}" is already listed above
                      </span>
                    ) : null}
                  </li>
                ))}
                {fallback ? (
                  <li className={cn(VALUES_ROW_GRID, "px-3 py-1.5")}>
                    <span className="px-1 text-sm text-muted-foreground">
                      No Onshape value or unmapped value: new items get
                    </span>
                    <LuArrowRight
                      aria-hidden
                      className="size-3.5 justify-self-center text-muted-foreground"
                    />
                    <DefaultValueSelect
                      options={fallback.options}
                      value={fallbackValue ?? fallback.value}
                      label="Value a new item gets when Onshape gives none or an unmapped one"
                      disabled={false}
                      onChange={setFallbackValue}
                    />
                    <span />
                  </li>
                ) : null}
              </ul>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              leftIcon={<LuPlus />}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { onshape: "", carbon: null, fixed: false }
                ])
              }
            >
              Add value
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Onshape value, arrow, Carbon value, icon: the Fields rows' grid, narrower.
 * The Carbon value takes more room: a unit reads "FOOT · Foot (matched)".
 */
const VALUES_ROW_GRID =
  "grid w-full grid-cols-[minmax(0,2fr)_16px_minmax(0,3fr)_32px] items-center gap-x-2";

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
  target?: ItemFieldSnapshot;
}): ItemFieldSnapshot | null {
  // An "everyPush" mapping changes the item before the reviewer's edit does.
  if (row.target) return row.target;
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
 * What the property map does to a row, read-only. A create lists every
 * mapped value with the Onshape property it came from. An existing item
 * lists the values "everyPush" mappings write (an emptied custom field is
 * cleared, so the review says so) and the "create" values it keeps out.
 */
function RowMappedFields({
  isCreate,
  row
}: {
  isCreate: boolean;
  row: MappedRowPlan;
}) {
  const lines: Array<{ key: string; text: string; tone: "muted" | "warn" }> =
    [];
  if (isCreate) {
    for (const field of row.itemFields ?? []) {
      lines.push({
        key: `item:${field.field}`,
        text: mappedValueText(field),
        tone: "muted"
      });
    }
  } else {
    for (const change of row.itemFieldChanges ?? []) {
      lines.push({
        key: `change:${change.field}`,
        text: itemFieldChangeText(change),
        tone: "muted"
      });
    }
  }
  for (const field of row.customFields ?? []) {
    lines.push({
      key: `custom:${field.fieldId}`,
      text: isCreate
        ? `${field.name}: ${customFieldDisplayValue(field)} · from Onshape "${field.onshapeName}"`
        : customFieldChangeText(field),
      tone: "muted"
    });
  }
  if (!isCreate) {
    for (const kept of row.keptDifferences ?? []) {
      lines.push({
        key: `kept:${kept.label}`,
        text: keptDifferenceText(kept),
        tone: "muted"
      });
    }
  }
  // A value the push cannot write is reported and skipped, never written.
  for (const problem of row.mappedFieldProblems ?? []) {
    lines.push({ key: `problem:${problem}`, text: problem, tone: "warn" });
  }
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 w-full">
      {lines.map((line) => (
        <p
          key={line.key}
          className={cn(
            "w-full text-xs",
            line.tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : "truncate text-muted-foreground"
          )}
          title={line.text}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Whether a part row lists anything a push changes. An "update" with nothing
 * listed is one whose geometry may have moved since the last export: the push
 * exports the model again and changes no field.
 */
function rowHasDetails(row: PartPlanRow): boolean {
  return (
    row.changes.length > 0 ||
    (row.itemFieldChanges?.length ?? 0) > 0 ||
    (row.customFields?.length ?? 0) > 0 ||
    (row.keptDifferences?.length ?? 0) > 0 ||
    (row.mappedFieldProblems?.length ?? 0) > 0
  );
}

/** Under the item choices: a choice made in the review stays in Carbon. */
function CarbonOnlyNote() {
  return (
    <p className="w-full text-xs text-muted-foreground">{CARBON_ONLY_NOTE}</p>
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
                  ? "1 part matches an existing Carbon item"
                  : `${n} parts match existing Carbon items`
              }
              description="Same part number. Pushing links them; renumber any that are different parts."
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
                      existing={!!row.current}
                      edit={review.edits[row.partId]}
                      disabled={busy}
                      onChange={(patch) => onEditItem(row.partId, patch)}
                    />
                  ) : null;
                })()}
                {row.action === "update" && !rowHasDetails(row) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Only the model is exported again.
                  </p>
                ) : null}
                {row.action !== "skip-no-part-number" ? (
                  <RowMappedFields
                    isCreate={row.action === "create"}
                    row={row}
                  />
                ) : null}
              </li>
            ))}
          </ul>

          <CarbonOnlyNote />
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
              ? "1 part matches an existing Carbon item"
              : `${n} parts match existing Carbon items`
          }
          description="Same part number. The push uses them in the BOM; renumber any that are different parts."
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
          description="Pushed as shown. Change it below or in Onshape."
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
          description="Their descriptions are set to Update on every push."
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
          description="Quantity follows Onshape; operation and scrap stay."
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
          description="Not in Onshape's BOM, so these BOMs won't match it."
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
                existing={!!plan.root.current}
                edit={review.edits[plan.root.partNumber]}
                disabled={busy}
                onChange={(patch) => onEditItem(plan.root.partNumber, patch)}
              />
            ) : null;
          })()}
          <TextChanges changes={plan.root.changes} />
          <RowMappedFields
            isCreate={plan.root.action === "create"}
            row={plan.root}
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
                  {item.shownAsUnit ? " · one unit in Onshape" : ""}
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
                  existing={!!item.current}
                  edit={review.edits[item.partNumber]}
                  disabled={busy}
                  onChange={(patch) => onEditItem(item.partNumber, patch)}
                />
              ) : null;
            })()}
            <RowMappedFields isCreate={item.action === "create"} row={item} />
          </li>
        ))}
      </ul>

      <CarbonOnlyNote />
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
   * Fixed behaviour, stated rather than chosen: a release push stages what it
   * creates under a change notice, and releasing the notice in Carbon makes
   * it active.
   */
  const outcomes = [
    review.changeNotice
      ? `Records change notice "${review.changeNotice.name}"`
      : null,
    review.changeNotice
      ? "New revisions stay inactive until it is released in Carbon"
      : count("revision") + count("create") > 0
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
              Their BOM lines stay as they are. Review again to retry.
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
            Their BOM lines won't change. Use a change notice in Carbon.
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
                  existing={!!item.current}
                  edit={review.edits[item.partNumber]}
                  disabled={busy}
                  onChange={(patch) => onEditItem(item.partNumber, patch)}
                />
              ) : null;
            })()}
            <TextChanges changes={item.changes} />
            {item.action === "create" ||
            item.action === "reuse" ||
            item.action === "revision" ? (
              <RowMappedFields isCreate={item.action === "create"} row={item} />
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
                      existing={!!child.current}
                      edit={review.edits[child.partNumber]}
                      disabled={busy}
                      onChange={(patch) => onEditItem(child.partNumber, patch)}
                    />
                  ) : null;
                })()}
                <RowMappedFields
                  isCreate={child.action === "create"}
                  row={child}
                />
              </li>
            ))}
          </ul>
        </VStack>
      ) : null}

      <CarbonOnlyNote />
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
