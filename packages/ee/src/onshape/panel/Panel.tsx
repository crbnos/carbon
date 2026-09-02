import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  cn,
  HStack,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OnshapeClientMessage, OnshapePanelContext } from "./messages";
import {
  isOnshapeClientMessage,
  isPanelSessionMessage,
  postApplicationInit
} from "./messages";
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
import type {
  PlanCustomField,
  PlanCustomFieldDefinition,
  PropertyMapEntry,
  UnmappedProperty
} from "./properties";
import { CUSTOM_FIELD_DATA_TYPES, MAPPABLE_VALUE_TYPES } from "./properties";
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
    state: "linked" | "matched" | "missing";
    itemId: string | null;
    lastSyncedAt: string | null;
  };
  lines: PanelAssemblyLine[];
};

type PanelStatusState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: PanelPartStatus[] }
  | { status: "ready-assembly"; assembly: PanelAssemblyStatus }
  | { status: "ready-other" }
  | { status: "error"; message: string };

type PanelReleasesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; releases: PanelRelease[] }
  | { status: "error"; message: string };

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
  create?: { name: string; dataTypeId: number };
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
      error: string | null;
      /** Per-property 422 errors, keyed by onshapePropertyId. */
      fieldErrors: Record<string, string[]>;
    }
  | { status: "error"; message: string };

/** Radix Select refuses empty item values, so the two specials are named. */
const FIELDS_NOT_MAPPED = "__not-mapped__";
const FIELDS_CREATE = "__create__";
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
  /** GET: Onshape properties + Carbon fields + the map. POST: save / create. */
  fields: string;
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
};

type SessionState =
  | { status: "unknown" }
  | { status: "signed-out" }
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
type PanelErrorResponse = { error: string; fieldErrors?: ApplyFieldError[] };

type AssemblyPushSummary = {
  itemsCreated: number;
  itemsReused: number;
  linesWritten: number;
  /** Lines already correct; absent on a response from before they were counted. */
  linesUnchanged?: number;
  methodsTouched: number;
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

function partOutcome(result: PartApplyResult): string {
  switch (result.action) {
    case "created":
      return "Created — model syncing";
    case "adopted":
      return "Linked to existing item — model syncing";
    case "updated":
      return "Updated — model syncing";
    case "unchanged":
      return "Already up to date";
    default:
      return result.message ?? result.action;
  }
}

function assemblyOutcomeText(s: AssemblyPushSummary): string {
  const problems = [...s.errors, ...s.skipped];
  const unchanged = s.linesUnchanged ?? 0;
  // A push that changed nothing should say so. "0 BOM lines" reads as a
  // failure; "42 already up to date" reads as the no-op it was.
  const lines =
    s.linesWritten === 0 && unchanged > 0
      ? `${unchanged} BOM lines already up to date`
      : `${s.linesWritten} BOM lines` +
        (unchanged > 0 ? ` (${unchanged} unchanged)` : "");
  return (
    `${s.itemsCreated} items created, ${s.itemsReused} reused, ` +
    `${lines} across ${s.methodsTouched} methods — model syncing` +
    (problems.length > 0 ? ` · ${problems.join(" · ")}` : "")
  );
}

function releaseOutcomeText(s: ReleasePushSummary): string {
  const problems = [...s.errors, ...s.skipped];
  return s.alreadyPushed
    ? "Revisions already in Carbon — BOMs refreshed, models re-syncing" +
        (problems.length > 0 ? ` · ${problems.join(" · ")}` : "")
    : `${s.revisionsCreated} revisions + ${s.itemsCreated} new items, ` +
        `${s.linesWritten} BOM lines` +
        (s.changeNotice ? ` · change notice ${s.changeNotice}` : "") +
        " — models syncing" +
        (problems.length > 0 ? ` · ${problems.join(" · ")}` : "");
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
  const [lastMessage, setLastMessage] = useState<OnshapeClientMessage | null>(
    null
  );
  const [messageCount, setMessageCount] = useState(0);
  const [parts, setParts] = useState<PanelStatusState>({ status: "idle" });
  const [releases, setReleases] = useState<PanelReleasesState>({
    status: "idle"
  });
  const [pushingReleaseId, setPushingReleaseId] = useState<string | null>(null);
  const [releaseOutcome, setReleaseOutcome] = useState<Record<string, string>>(
    {}
  );

  const canLoadParts =
    !!context.documentId &&
    !!context.wv &&
    !!context.wvId &&
    !!context.elementId;
  const canPush = canLoadParts && (context.wv === "w" || context.wv === "v");
  const [pushing, setPushing] = useState<Set<string> | null>(null);
  const [pushOutcome, setPushOutcome] = useState<Record<string, string>>({});

  // The Fields editor (Onshape properties → Carbon custom fields). One shared
  // section for the whole panel: the map is company-wide, not per element.
  const [fields, setFields] = useState<PanelFieldsState>({ status: "closed" });
  const [fieldsOutcome, setFieldsOutcome] = useState<string | null>(null);

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
    setFieldsOutcome(null);
  }, [elementScope, documentScope]);

  // The review belongs to the session that planned it.
  useEffect(() => {
    if (session.status === "signed-out") setReview(null);
  }, [session.status]);

  const loadParts = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      setParts({ status: "loading" });
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
          setParts({
            status: "error",
            message:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
          });
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
        setParts({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [canLoadParts, context, paths.status]
  );

  const loadReleases = useCallback(
    async (token: string) => {
      if (!context.documentId) return;
      setReleases({ status: "loading" });
      try {
        const query = new URLSearchParams({ documentId: context.documentId });
        const response = await panelFetch(token, `${paths.releases}?${query}`);
        const body = (await response.json()) as
          | { releases: PanelRelease[] }
          | { error: string };
        if (!response.ok || "error" in body) {
          setReleases({
            status: "error",
            message:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
          });
          return;
        }
        setReleases({ status: "ready", releases: body.releases });
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setReleases({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [context.documentId, paths.releases]
  );

  const loadFields = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      setFieldsOutcome(null);
      setFields({ status: "loading" });
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
        // Every landing commits only while the section is still loading:
        // hiding it (or a move to another element) during the read must not
        // be undone when the answer arrives.
        if (!response.ok || "error" in body) {
          setFields((current) =>
            current.status === "loading"
              ? {
                  status: "error",
                  message:
                    "error" in body
                      ? body.error
                      : `Carbon answered ${response.status}`
                }
              : current
          );
          return;
        }
        setFields((current) =>
          current.status === "loading"
            ? {
                status: "ready",
                data: body,
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
        setFields((current) =>
          current.status === "loading"
            ? {
                status: "error",
                message: error instanceof Error ? error.message : String(error)
              }
            : current
        );
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
      if (serverOrigin && event.origin === serverOrigin) {
        if (isOnshapeClientMessage(event.data)) {
          setLastMessage(event.data);
          setMessageCount((n) => n + 1);
        }
        return;
      }
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
          const message =
            "error" in body ? body.error : `Carbon answered ${response.status}`;
          setReview(null);
          setPushOutcome(
            Object.fromEntries(partIds.map((id) => [id, message]))
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
        const message = error instanceof Error ? error.message : String(error);
        setReview(null);
        setPushOutcome(Object.fromEntries(partIds.map((id) => [id, message])));
      } finally {
        setPushing(null);
      }
    },
    [canPush, context, paths.planPart, elementScope]
  );

  const [assemblyOutcome, setAssemblyOutcome] = useState<string | null>(null);
  const planAssembly = useCallback(
    async (token: string, depth: AssemblyPlanDepth) => {
      if (!canPush) return;
      setPushing(new Set(["__assembly__"]));
      setAssemblyOutcome(null);
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
          setAssemblyOutcome(
            "error" in body ? body.error : `Carbon answered ${response.status}`
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
          error instanceof Error ? error.message : String(error)
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
            [releaseId]:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
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
          [releaseId]: error instanceof Error ? error.message : String(error)
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
      void planAssembly(token, "all");
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

  /**
   * Save the property map: the whole entries list, a full replacement. A 422
   * pins errors to properties (create validation, duplicate names); success
   * collapses the editor — the map matters at the next plan, not before.
   */
  const saveFields = useCallback(
    async (token: string) => {
      if (fields.status !== "ready" || fields.saving) return;
      const current = fields;
      setFields({ ...current, saving: true, error: null, fieldErrors: {} });
      try {
        const response = await panelFetch(token, paths.fields, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: current.entries })
        });
        const body = (await response.json()) as
          | { map: PropertyMapEntry[] }
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
          return;
        }
        setFields({ status: "closed" });
        setFieldsOutcome("Saved — new pushes use the updated map");
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setFields({
          ...current,
          saving: false,
          error: error instanceof Error ? error.message : String(error)
        });
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
      if (selection === FIELDS_CREATE) {
        // "Create field" provisions the first Carbon type the value type maps
        // onto — MAPPABLE_VALUE_TYPES order encodes that preference.
        const [dataTypeId] = mappableTypesFor(property.valueType);
        return {
          ...base,
          create: entry?.create ?? {
            name: property.name,
            dataTypeId: dataTypeId ?? CUSTOM_FIELD_DATA_TYPES.text
          }
        };
      }
      return { ...base, carbonFieldId: selection };
    });

  const setFieldsMode = (propertyId: string, mode: "owned" | "default") =>
    editFieldsEntry(propertyId, (entry) => (entry ? { ...entry, mode } : null));

  const setFieldsCreateName = (propertyId: string, name: string) =>
    editFieldsEntry(propertyId, (entry) =>
      entry?.create
        ? { ...entry, create: { ...entry.create, name } }
        : (entry ?? null)
    );

  const toggleFields = (token: string) => {
    if (fields.status === "closed") void loadFields(token);
    else setFields({ status: "closed" });
  };

  /** The review's "Fields" link: open (and load) without ever closing. */
  const openFields = (token: string) => {
    if (fields.status === "closed" || fields.status === "error") {
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
    if (!popup) {
      setSession({
        status: "error",
        token: null,
        message:
          "The sign-in window was blocked. Allow pop-ups for this page and try again."
      });
    }
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

  return (
    /*
     * Three bands: a header that stays put, one scrolling body, and whatever
     * action bar the active section pins to the bottom. The body is the ONLY
     * scroller — `min-h-0` is what lets it shrink inside the flex column
     * instead of pushing the header off the top.
     */
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <HStack spacing={2} className="min-w-0">
          <img
            src="/carbon-mark-light.svg"
            alt=""
            className="h-5 w-auto shrink-0 dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt=""
            className="hidden h-5 w-auto shrink-0 dark:block"
          />
          <span className="truncate text-sm font-semibold">Carbon</span>
          {session.status === "signed-in" ? (
            <span
              role="img"
              aria-label="Connected to Carbon"
              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
            />
          ) : null}
        </HStack>
        <HStack spacing={1} className="shrink-0">
          {session.status === "signed-in" && canLoadParts ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleFields(session.token)}
            >
              {fields.status === "closed" ? "Fields" : "Hide fields"}
            </Button>
          ) : null}
          {session.status === "signed-in" ? (
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          ) : null}
        </HStack>
      </header>

      <VStack spacing={4} className="min-h-0 flex-1 overflow-y-auto p-4">
        {!serverOrigin ? (
          <Alert variant="destructive">
            <AlertTitle>Open this panel from Onshape</AlertTitle>
            <AlertDescription>
              This page only works inside Onshape's right panel, which supplies
              the document context and a trusted origin.
            </AlertDescription>
          </Alert>
        ) : null}

        <ContextSummary context={context} />

        {session.status === "signed-out" || session.status === "unknown" ? (
          <VStack spacing={2}>
            <p className="text-sm text-muted-foreground">
              Sign in to Carbon to see what this document has in Carbon and to
              push parts, assemblies and releases.
            </p>
            <Button onClick={signIn} isDisabled={session.status === "unknown"}>
              Sign in to Carbon
            </Button>
          </VStack>
        ) : null}

        {session.status === "loading" ? (
          <p className="text-sm text-muted-foreground">Connecting to Carbon…</p>
        ) : null}

        {session.status === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>Carbon is not reachable</AlertTitle>
            <AlertDescription>{session.message}</AlertDescription>
            <HStack className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => session.token && loadMe(session.token)}
              >
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={signOut}>
                Sign in again
              </Button>
            </HStack>
          </Alert>
        ) : null}

        {session.status === "signed-in" && fieldsOutcome ? (
          <p className="w-full text-xs text-muted-foreground">
            {fieldsOutcome}
          </p>
        ) : null}

        {session.status === "signed-in" && fields.status !== "closed" ? (
          <FieldsSection
            state={fields}
            onMap={mapFieldsProperty}
            onMode={setFieldsMode}
            onCreateName={setFieldsCreateName}
            onSave={() => saveFields(session.token)}
          />
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
                onOpenFields={() => openFields(session.token)}
              />
            ) : (
              <AssemblySection
                locked={!!review}
                assembly={parts.assembly}
                canPush={canPush}
                busy={!!pushing}
                outcome={assemblyOutcome}
                onPush={(depth) => planAssembly(session.token, depth)}
                onRefresh={() => loadParts(session.token)}
              />
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              This element type has nothing to push. Open a Part Studio or an
              assembly.
            </p>
          )
        ) : null}

        {session.status === "signed-in" &&
        canLoadParts &&
        parts.status !== "ready-assembly" &&
        parts.status !== "ready-other" ? (
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
              onOpenFields={() => openFields(session.token)}
            />
          ) : (
            <PartsSection
              locked={!!review}
              parts={parts}
              canPush={canPush}
              pushing={pushing}
              pushOutcome={pushOutcome}
              onRefresh={() => loadParts(session.token)}
              onPush={(partIds) => planParts(session.token, partIds)}
            />
          )
        ) : null}

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

        <details className="w-full text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Onshape messages ({messageCount})
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2">
            {lastMessage
              ? JSON.stringify(lastMessage, null, 2)
              : "No message received yet. Select something in Onshape."}
          </pre>
        </details>
      </VStack>
    </div>
  );
}

function AssemblySection({
  assembly,
  canPush,
  busy,
  locked,
  outcome,
  onPush,
  onRefresh
}: {
  assembly: PanelAssemblyStatus;
  canPush: boolean;
  busy: boolean;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  outcome: string | null;
  onPush: (depth: AssemblyPlanDepth) => void;
  onRefresh: () => void;
}) {
  // Whole tree by default — the behaviour every existing user has. Turning it
  // off writes only this assembly's own BOM and treats each sub-assembly as a
  // single line pointing at its own make method, which is how a large tree is
  // pushed a level at a time.
  const [includeSubAssemblies, setIncludeSubAssemblies] = useState(true);
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
              onClick={() => onPush(includeSubAssemblies ? "all" : "top")}
              isDisabled={busy || locked}
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
            isDisabled={busy}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {canPush ? (
        <HStack spacing={2} className="w-full items-start">
          <Checkbox
            id="onshape-include-sub-assemblies"
            checked={includeSubAssemblies}
            onCheckedChange={(checked) =>
              setIncludeSubAssemblies(checked === true)
            }
            disabled={busy || locked}
          />
          <label
            htmlFor="onshape-include-sub-assemblies"
            className="text-xs text-muted-foreground leading-tight"
          >
            Include sub-assemblies
            <span className="block">
              {includeSubAssemblies
                ? "Pushes the whole tree in one go."
                : "Pushes this assembly's own BOM only. Push each sub-assembly from its own tab; Carbon links the levels together."}
            </span>
          </label>
        </HStack>
      ) : null}

      {!assembly.root.partNumber ? (
        <Alert variant="destructive">
          <AlertTitle>The assembly has no part number</AlertTitle>
          <AlertDescription>
            Set a part number on the assembly in Onshape, then push.
          </AlertDescription>
        </Alert>
      ) : null}

      {outcome ? (
        <p className="text-xs text-muted-foreground w-full">{outcome}</p>
      ) : null}

      {assembly.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">The BOM is empty.</p>
      ) : (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {assembly.lines.map((line) => (
            <li
              key={line.index}
              className="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <div
                className="min-w-0"
                style={{ paddingLeft: `${(line.level - 1) * 16}px` }}
              >
                <p className="text-sm truncate">
                  {line.name ?? line.partNumber ?? line.index}
                  <span className="text-muted-foreground">
                    {" "}
                    × {line.quantity}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {line.partNumber ?? "No part number"}
                  {line.purchased ? " · purchased" : ""}
                </p>
              </div>
              <PartStateBadge state={line.state} />
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}

function PartsSection({
  parts,
  canPush,
  pushing,
  locked,
  pushOutcome,
  onRefresh,
  onPush
}: {
  parts:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; rows: PanelPartStatus[] }
    | { status: "error"; message: string };
  canPush: boolean;
  pushing: Set<string> | null;
  /** A review is open elsewhere: a second push would replace it unseen. */
  locked: boolean;
  pushOutcome: Record<string, string>;
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
              isDisabled={!!pushing || locked || parts.status === "loading"}
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
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {parts.status === "loading" || parts.status === "idle" ? (
        <p className="text-sm text-muted-foreground">Loading parts…</p>
      ) : null}

      {parts.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load part status</AlertTitle>
          <AlertDescription>{parts.message}</AlertDescription>
        </Alert>
      ) : null}

      {parts.status === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This element has no parts.
        </p>
      ) : null}

      {parts.status === "ready" && rows.length > 0 ? (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {rows.map((part) => (
            <li
              key={part.partId}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm truncate">{part.name}</p>
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
                  <span className="text-xs text-muted-foreground">
                    {pushOutcome[part.partId]}
                  </span>
                ) : null}
                <PartStateBadge state={part.state} />
                {canPush ? (
                  <Button
                    size="sm"
                    variant={part.state === "linked" ? "ghost" : "secondary"}
                    onClick={() => onPush([part.partId])}
                    isDisabled={!!pushing || locked || !part.partNumber}
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
  outcome: Record<string, string>;
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
        >
          Refresh
        </Button>
      </HStack>

      {releases.status === "loading" || releases.status === "idle" ? (
        <p className="text-sm text-muted-foreground">Loading releases…</p>
      ) : null}

      {releases.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load releases</AlertTitle>
          <AlertDescription>{releases.message}</AlertDescription>
        </Alert>
      ) : null}

      {releases.status === "ready" && releases.releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This document has no releases yet. Release it in Onshape, then
          refresh.
        </p>
      ) : null}

      {releases.status === "ready" && releases.releases.length > 0 ? (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {releases.releases.map((release) => {
            const models = release.items.filter(
              (item) => item.elementType === 0 || item.elementType === 1
            );
            const drawings = release.items.length - models.length;
            return (
              <li key={release.releaseId} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">
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
                      isDisabled={!!pushingReleaseId || locked}
                      isLoading={pushingReleaseId === release.releaseId}
                    >
                      {release.state === "pushed"
                        ? "Re-push release"
                        : "Push release"}
                    </Button>
                  </HStack>
                </div>
                {outcome[release.releaseId] ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    {outcome[release.releaseId]}
                  </p>
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
  onCreateName,
  onSave
}: {
  state: Exclude<PanelFieldsState, { status: "closed" }>;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onMode: (propertyId: string, mode: "owned" | "default") => void;
  onCreateName: (propertyId: string, name: string) => void;
  onSave: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p className="text-sm text-muted-foreground w-full">
        Loading properties…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load properties</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  const { data } = state;
  const entryFor = (propertyId: string) =>
    state.entries.find((entry) => entry.onshapePropertyId === propertyId);
  // The save posts the whole map, so a 422 can name a property mapped from
  // another element. There is no row here to pin it to, and unpinned it would
  // be invisible — Save would just fail — so it renders on its own, named
  // from the draft entry.
  const rendered = new Set(
    data.properties.map((property) => property.propertyId)
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
      {state.error ? (
        <Alert variant="destructive">
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
      {data.properties.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This element has no properties.
        </p>
      ) : (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {data.properties.map((property) => (
            <FieldsRow
              key={property.propertyId}
              property={property}
              entry={entryFor(property.propertyId)}
              definitions={data.definitions}
              errors={state.fieldErrors[property.propertyId]}
              disabled={!data.canEdit || state.saving}
              onMap={onMap}
              onMode={onMode}
              onCreateName={onCreateName}
            />
          ))}
        </ul>
      )}
      {data.canEdit ? (
        <HStack className="w-full justify-end">
          <Button
            size="sm"
            onClick={onSave}
            isDisabled={state.saving}
            isLoading={state.saving}
          >
            Save
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}

function FieldsRow({
  property,
  entry,
  definitions,
  errors,
  disabled,
  onMap,
  onMode,
  onCreateName
}: {
  property: PanelFieldsProperty;
  entry: FieldsDraftEntry | undefined;
  definitions: PlanCustomFieldDefinition[];
  errors: string[] | undefined;
  disabled: boolean;
  onMap: (property: PanelFieldsProperty, selection: string) => void;
  onMode: (propertyId: string, mode: "owned" | "default") => void;
  onCreateName: (propertyId: string, name: string) => void;
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
  const selection = entry
    ? entry.create
      ? FIELDS_CREATE
      : (entry.carbonFieldId ?? FIELDS_NOT_MAPPED)
    : FIELDS_NOT_MAPPED;
  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <HStack spacing={2} className="min-w-0">
          <p
            className={
              property.mappable
                ? "text-sm truncate"
                : "text-sm truncate text-muted-foreground"
            }
          >
            {property.name}
          </p>
          <Badge variant="secondary">{property.valueType}</Badge>
        </HStack>
        {property.mappable ? (
          <HStack spacing={1} className="shrink-0">
            <Select
              value={selection}
              onValueChange={(value) => onMap(property, value)}
              disabled={disabled}
            >
              <SelectTrigger size="sm" aria-label={`Map ${property.name}`}>
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
                <SelectItem value={FIELDS_CREATE}>
                  Create "{property.name}"…
                </SelectItem>
              </SelectContent>
            </Select>
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
          </HStack>
        ) : (
          <span className="text-xs text-muted-foreground shrink-0">
            cannot be mapped
          </span>
        )}
      </div>
      {entry?.create ? (
        <div className="mt-2 w-full">
          <Input
            size="sm"
            value={entry.create.name}
            placeholder="New field name"
            aria-label={`New field name for ${property.name}`}
            isDisabled={disabled}
            isInvalid={!!errors}
            onChange={(event) =>
              onCreateName(property.propertyId, event.target.value)
            }
          />
        </div>
      ) : null}
      {errors?.map((message) => (
        <p key={message} className="text-xs text-destructive mt-1">
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
  if (tone === "destructive") return "text-xs text-destructive";
  if (tone === "muted") return "text-xs text-muted-foreground";
  return "text-xs";
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
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" aria-label={label}>
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
            {isCreate
              ? `${field.name}: ${customFieldDisplayValue(field)} · from Onshape ${field.onshapeName}`
              : field.value === null
                ? `${field.name}: will be cleared — Onshape holds no value`
                : `${field.name}: will be set to ${customFieldDisplayValue(field)}`}
          </p>
        );
      })}
      {problems?.map((problem) => (
        <p key={problem} className="text-xs text-destructive w-full">
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
      <span className="text-xs text-muted-foreground">{label}</span>
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
              "shrink-0 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
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
          <HStack spacing={2}>
            <button
              type="button"
              onClick={onSelectAll}
              disabled={disabled}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              disabled={disabled}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Clear
            </button>
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
        className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <span className={cn("transition-transform", open && "rotate-90")}>
          ›
        </span>
        <span className="truncate">{summary}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

function PartPlanBadge({ row }: { row: PartPlanRow }) {
  switch (row.action) {
    case "create":
      return <Badge variant="blue">Create</Badge>;
    case "adopt":
      return (
        <Badge variant="yellow">
          Link to {row.item?.readableId ?? row.partNumber}
        </Badge>
      );
    case "update":
      return <Badge variant="green">Update</Badge>;
    case "unchanged":
      return <Badge variant="secondary">Up to date</Badge>;
    case "skip-no-part-number":
      return <Badge variant="secondary">Skipped</Badge>;
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
        <p className="text-sm text-muted-foreground">
          None of the selected parts are in this element.
        </p>
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
            <p className="py-6 text-center text-sm text-muted-foreground">
              No parts match.
            </p>
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
                              <p className="truncate text-sm">{row.name}</p>
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
              <p className="truncate text-sm">
                {plan.root.name ?? plan.root.partNumber}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {plan.root.partNumber}
                {plan.root.revision ? ` · Rev ${plan.root.revision}` : ""}
              </p>
            </div>
            <div className="shrink-0">
              {plan.root.action === "create" ? (
                <Badge variant="blue">Create</Badge>
              ) : (
                <Badge variant="green">Reuse</Badge>
              )}
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
        <Alert>
          <AlertTitle>This level only</AlertTitle>
          <AlertDescription>
            {plan.deeper.partCount > 0
              ? `${plan.deeper.partCount} parts below this level are not in this push.`
              : "Only this assembly's own BOM is in this push."}
            {plan.deeper.subAssemblies.length > 0
              ? ` Push ${plan.deeper.subAssemblies.join(", ")} from their own tabs — Carbon links each to its line here.`
              : ""}
          </AlertDescription>
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
            <p className="py-6 text-center text-sm text-muted-foreground">
              No components match.
            </p>
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
                          <p className="truncate text-sm">
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
                        {item.action === "create" ? (
                          <Badge variant="blue">Create</Badge>
                        ) : (
                          <Badge variant="green">Reuse</Badge>
                        )}
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

      <details className="w-full">
        <summary className="cursor-pointer px-1 text-xs font-medium text-muted-foreground">
          Make methods ({plan.methods.length})
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
          {plan.skipped.map((line, index) => (
            <p
              key={`${index}-${line}`}
              className="text-xs text-muted-foreground"
            >
              {line}
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
      return <Badge variant="blue">New revision</Badge>;
    case "create":
      return <Badge variant="blue">Create</Badge>;
    case "reuse":
      return <Badge variant="green">In Carbon</Badge>;
    case "drawing":
    case "drawing-unmatched":
      return <Badge variant="secondary">Drawing</Badge>;
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
  onMakeDefault
}: ReviewSectionProps<ReleaseReview> & {
  onChangeNotice: (field: "name" | "description", value: string) => void;
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
      {review.warnings.map((warning) => (
        <p key={warning} className="text-xs text-destructive w-full">
          {warning}
        </p>
      ))}

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
              <p className="text-xs text-destructive mt-1">
                released in Carbon — BOM lines will not be applied
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
                    <p className="text-sm truncate">
                      {child.name ?? child.partNumber}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {child.partNumber}
                      {child.revision ? ` · Rev ${child.revision}` : ""}
                      {child.purchased ? " · purchased" : ""}
                    </p>
                  </div>
                  {child.action === "create" ? (
                    <Badge variant="blue">Create</Badge>
                  ) : (
                    <Badge variant="green">Reuse</Badge>
                  )}
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
          <span className="text-xs font-medium">Change notice</span>
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
        </VStack>
      ) : (
        <p className="text-xs text-muted-foreground w-full">
          Already in Carbon — pushing again re-applies BOMs and re-syncs models
        </p>
      )}

      <HStack spacing={2} className="w-full">
        <Checkbox
          id="onshape-release-make-default"
          checked={review.makeDefault}
          disabled={review.applying}
          onCheckedChange={(checked) => onMakeDefault(checked === true)}
        />
        <label
          htmlFor="onshape-release-make-default"
          className="text-sm cursor-pointer"
        >
          Make the new revisions the default
        </label>
      </HStack>

      <ReviewActionBar
        review={review}
        replanning={replanning}
        onApply={onApply}
      />
    </VStack>
  );
}

function ReleaseStateBadge({ state }: { state: PanelRelease["state"] }) {
  if (state === "pushed") return <Badge variant="green">In Carbon</Badge>;
  if (state === "partial") return <Badge variant="yellow">Partial</Badge>;
  return <Badge variant="secondary">Not in Carbon</Badge>;
}

function PartStateBadge({ state }: { state: PanelPartStatus["state"] }) {
  if (state === "linked") return <Badge variant="green">In Carbon</Badge>;
  if (state === "matched") return <Badge variant="yellow">Match found</Badge>;
  return <Badge variant="secondary">Not in Carbon</Badge>;
}

/**
 * What the user is looking at, in the space it deserves.
 *
 * The three Onshape ids are 24-character hex — three wrapped rows of noise at
 * the top of a 340px panel, above the content someone actually came for. They
 * are still worth having (they are what you quote in a bug report), so they
 * move behind a disclosure. What stays visible is what a person recognises:
 * the part number, revision and configuration, and only when they are set.
 */
function ContextSummary({ context }: { context: OnshapePanelContext }) {
  const named: Array<[string, string | null]> = [
    ["Part number", context.partNumber],
    ["Revision", context.revision],
    ["Configuration", context.configuration]
  ];
  const ids: Array<[string, string | null]> = [
    ["Document", context.documentId],
    [
      context.wv === "v"
        ? "Version"
        : context.wv === "m"
          ? "Microversion"
          : "Workspace",
      context.wvId
    ],
    ["Element", context.elementId]
  ];

  const visible = named.filter(([, value]) => value);
  const hidden = ids.filter(([, value]) => value);
  if (visible.length === 0 && hidden.length === 0) return null;

  return (
    <VStack spacing={1} className="w-full">
      {visible.length > 0 ? (
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {visible.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hidden.length > 0 ? (
        <details className="w-full text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Onshape ids
          </summary>
          <dl className="mt-1 grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {hidden.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </VStack>
  );
}
