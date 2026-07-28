import type { Json } from "@carbon/database";
import { PrintButton } from "@carbon/printing/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  BarProgress,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  Button,
  ClientOnly,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  generateHTML,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Separator,
  SidebarTrigger,
  Spinner,
  Status,
  TruncatedTooltipText,
  useDisclosure,
  useKeyboardWedge,
  useMode,
  useRealtimeChannel,
  useRouteData
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import type {
  AssemblyStep,
  CameraPose,
  Fastener,
  Motion
} from "@carbon/viewer";
import { AssemblyPlayer } from "@carbon/viewer";
import { ModelPreview } from "@carbon/viewer/model-preview";
import { getLocalTimeZone } from "@internationalized/date";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuBox,
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCircle,
  LuCircleCheck,
  LuCircleDot,
  LuCirclePlus,
  LuEllipsisVertical,
  LuExpand,
  LuEye,
  LuEyeOff,
  LuFlag,
  LuGitPullRequest,
  LuHammer,
  LuHardHat,
  LuImage,
  LuListChecks,
  LuListFilter,
  LuPause,
  LuPlay,
  LuSkipForward,
  LuTimer,
  LuTrash,
  LuUndo2,
  LuWrench,
  LuX
} from "react-icons/lu";
import {
  useFetcher,
  useNavigate,
  useRevalidator,
  useSearchParams
} from "react-router";
import { TrackingTypeIcon } from "~/components/Icons";
import { ImageZoomViewer } from "~/components/ImageZoomViewer";
import { OperationChat } from "~/components/JobOperation/components/Chat";
import { IssueMaterialModal } from "~/components/JobOperation/components/IssueMaterialModal";
import { MaintenanceDispatch } from "~/components/JobOperation/components/MaintenanceDispatch";
import { QualityIssueModal } from "~/components/JobOperation/components/QualityIssueModal";
import { QuantityModal } from "~/components/JobOperation/components/QuantityModal";
import { ReworkModal } from "~/components/JobOperation/components/ReworkModal";
import { SerialSelectorModal } from "~/components/JobOperation/components/SerialSelectorModal";
import { RecordModal } from "~/components/JobOperation/components/Step";
import { useUser } from "~/hooks";
import type {
  JobMaterial,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent as ProductionEventType
} from "~/services/types";
import { getPrivateUrl, path } from "~/utils/path";
import { deriveUnits } from "~/utils/units";

type StepRecord = {
  id: string;
  index: number;
  value?: string | null;
  numericValue?: number | null;
  booleanValue?: boolean | null;
  userValue?: string | null;
  createdBy?: string | null;
};

type SlideAnnotation = {
  id: string;
  x: number;
  y: number;
  label?: string | null;
  color?: string | null;
  // Smart hotspot: item id of the tool this pin points at (matches a tool's item.id).
  toolId?: string | null;
};

type Slide = {
  id: string;
  // A slide is image XOR model: exactly one of imagePath / modelUploadId is set.
  imagePath: string | null;
  modelUploadId?: string | null;
  caption?: string | null;
  sortOrder?: number | null;
  annotations?: SlideAnnotation[] | null;
};

// The assembler serves an optimised GLB per model (no client-side tessellation).
// Derive its private preview URL from the raw modelPath
// `${co}/models/${id}.ext[.zst]` → `${co}/models/${id}/optimized.glb`. Mirrors
// the helper in JobOperation.tsx — the raw upload alone no longer renders (the
// pipeline compacts it to `.zst` and the WASM tier is build-flag gated off).
function optimizedModelPreviewUrl(rawModelPath: string | null): string | null {
  if (!rawModelPath) return null;
  const slash = rawModelPath.lastIndexOf("/");
  if (slash < 0) return null;
  const dir = rawModelPath.slice(0, slash);
  let base = rawModelPath.slice(slash + 1);
  if (base.toLowerCase().endsWith(".zst")) base = base.slice(0, -4);
  const id = base.replace(/\.[^.]+$/, "");
  if (!id) return null;
  return `/file/preview/private/${dir}/${id}/optimized.glb`;
}

// Render metadata for a 3D model slide (resolved by the loader from modelUpload).
// glbPath is the assembler-converted artifact (fast to load); modelPath is the raw
// upload the viewer parses client-side when no conversion exists (yet).
type SlideModel = {
  id: string;
  name: string | null;
  modelPath: string | null;
  thumbnailPath: string | null;
  glbPath: string | null;
  processingStatus?: string | null;
};

type Step = {
  id: string;
  name?: string | null;
  description?: unknown;
  type?: string | null;
  sortOrder?: number | null;
  unitOfMeasureCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  listValues?: string[] | null;
  // Assembly → BOP sync provenance: the assemblyInstructionStep this step was
  // synced from. Maps the operator's current step to the animated 3D playback.
  assemblyInstructionStepId?: string | null;
  jobOperationStepRecord?: StepRecord[];
  jobOperationStepSlide?: Slide[];
};

// The linked instruction's animated steps + converted artifacts (loader-resolved
// when the operation carries an assemblyInstructionId and the model is converted).
type AssemblyPlayback = {
  glbPath: string;
  graphPath: string;
  steps: {
    id: string;
    title: string | null;
    instructionText: string | null;
    componentNodeIds: string[] | null;
    motion: Json;
    camera: Json | null;
    fastener: Json | null;
    durationSeconds: number | null;
    warnings: Json | null;
  }[];
};

const playerMotionTypes = ["linear", "L", "helix", "path", "none"];

// DB row → @carbon/viewer AssemblyStep.
function toViewerStep(step: AssemblyPlayback["steps"][number]): AssemblyStep {
  const motion = step.motion as Motion | null;
  const warnings = step.warnings as { flagged?: boolean } | null;
  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    componentNodeIds: step.componentNodeIds ?? [],
    motion:
      motion &&
      typeof motion === "object" &&
      playerMotionTypes.includes(motion.type)
        ? motion
        : { type: "none" },
    camera: (step.camera as CameraPose | null) ?? null,
    fastener: (step.fastener as Fastener | null) ?? null,
    durationSeconds: step.durationSeconds,
    flagged: warnings?.flagged === true ? true : undefined
  };
}

type ProductionEvent = {
  id: string;
  type?: string | null;
  startTime: string;
  endTime?: string | null;
  duration?: number | null;
  employeeId?: string | null;
};

type ContainmentAction = {
  id: string;
  actionTypeName: string;
  nonConformanceId: string;
  notes: unknown;
};

type Operation = {
  id: string;
  description?: string | null;
  workCenterId?: string | null;
  operationQuantity?: number | null;
  quantityComplete?: number | null;
  laborDuration?: number | null;
  setupDuration?: number | null;
  machineDuration?: number | null;
  itemDescription?: string | null;
  itemReadableId?: string | null;
  jobReadableId?: string | null;
  operationStatus?: string | null;
  jobStatus?: string | null;
  duration?: number | null;
  jobDeadlineType?: string | null;
};

type Props = {
  operationId: string;
  job: { itemReadableIdWithRevision?: string | null } | null;
  operation: Operation | null;
  thumbnailPath: string | null | undefined;
  trackedEntities: {
    id: string;
    readableId?: string | null;
    status?: string | null;
  }[];
  trackedEntityId: string | null;
  materials: { materials?: any[]; trackedInputs?: any[] } | null;
  procedure: { attributes: Step[]; parameters: any[] };
  tools: {
    quantity: number;
    jobOperationStepIds?: string[];
    item: {
      id: string;
      name: string;
      type: string;
      readableId?: string | null;
    } | null;
  }[];
  ncrs: any[];
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
  openEvent: { id: string; startTime: string } | null;
  events: ProductionEvent[];
  nonConformanceActions: ContainmentAction[];
  expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  autoStartOperationTimer?: boolean;
  productionQuantities?: { scrap: number; production: number; rework: number };
  workCenter?: {
    id: string;
    name: string;
    isBlocked: boolean | null;
    blockingDispatchId: string | null;
    blockingDispatchReadableId: string | null;
  } | null;
  kanban?: { id?: string; completedBarcodeOverride?: string | null } | null;
  jobId?: string | null;
  canOverrideComplete?: boolean;
  modelPath?: string | null;
  slideModels?: Record<string, SlideModel> | null;
  assemblyPlayback?: AssemblyPlayback | null;
};

// Real Carbon item types, in display order. Fasteners is NOT a Carbon concept.
const TYPE_ORDER = [
  "Part",
  "Material",
  "Consumable",
  "Fixture",
  "Tool",
  "Service"
];

// Walk a TipTap/ProseMirror doc and collect text (incl. @mention labels).
function richTextToPlainText(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") parts.push(node.text);
    else if (node.type === "mention" && node.attrs?.label)
      parts.push(node.attrs.label);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Strip any inline image nodes so the prose shows text only — reference imagery
// now lives in first-class slides, not embedded in the description.
function stripImages(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  if (Array.isArray(doc.content)) {
    return {
      ...doc,
      content: doc.content
        .filter((n: any) => n?.type !== "image")
        .map(stripImages)
    };
  }
  return doc;
}

function formatElapsed(s: number) {
  const h = Math.floor(s / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// Live elapsed seconds from an open production event's startTime (survives reload).
function useElapsed(openEvent: { startTime: string } | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!openEvent) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [openEvent]);
  if (!openEvent) return 0;
  const start = new Date(openEvent.startTime).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

// Numbered pins overlaid on a reference image for the operator. Absolutely positioned by
// fraction of the box, so the parent must be sized to the rendered image (an inline wrapper
// around <img>). Tapping a pin that carries a note/tool reveals it in a bar along the bottom
// of the image — hover `title` tooltips are dead on the shop floor's touch devices. Pins
// without any detail stay non-interactive so taps fall through to open the fullscreen viewer.
function SlidePins({
  annotations,
  toolNameById
}: {
  annotations: SlideAnnotation[];
  toolNameById?: Map<string, string>;
}) {
  const [openPinId, setOpenPinId] = useState<string | null>(null);

  if (annotations.length === 0) return null;

  const openIndex = annotations.findIndex((p) => p.id === openPinId);
  const openPin = openIndex >= 0 ? annotations[openIndex] : null;
  const openToolName = openPin?.toolId
    ? toolNameById?.get(openPin.toolId)
    : undefined;

  return (
    <>
      {annotations.map((pin, i) => {
        const toolName = pin.toolId ? toolNameById?.get(pin.toolId) : undefined;
        const hasDetail = Boolean(toolName || pin.label);
        const isOpen = pin.id === openPinId;
        return (
          <button
            key={pin.id}
            type="button"
            disabled={!hasDetail}
            aria-label={
              [`Annotation ${i + 1}`, toolName, pin.label]
                .filter(Boolean)
                .join(": ") || `Annotation ${i + 1}`
            }
            onClick={(e) => {
              e.stopPropagation();
              setOpenPinId((cur) => (cur === pin.id ? null : pin.id));
            }}
            className={cn(
              "absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-md transition-transform",
              hasDetail
                ? "cursor-pointer active:scale-[0.96]"
                : "pointer-events-none",
              isOpen && "ring-2 ring-white ring-offset-1 ring-offset-black/40"
            )}
            style={{
              left: `${pin.x * 100}%`,
              top: `${pin.y * 100}%`,
              backgroundColor: pin.color ?? "#ef4444"
            }}
          >
            {i + 1}
          </button>
        );
      })}

      {openPin && (openToolName || openPin.label) && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-start gap-2 bg-background/90 px-3 py-2 text-left shadow-sm backdrop-blur-sm">
          <span
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: openPin.color ?? "#ef4444" }}
          >
            {openIndex + 1}
          </span>
          <div className="min-w-0 flex-1">
            {openToolName && (
              <div className="truncate text-sm font-semibold text-foreground">
                {openToolName}
              </div>
            )}
            {openPin.label && (
              <div className="text-xs text-muted-foreground">
                {openPin.label}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss annotation"
            onClick={(e) => {
              e.stopPropagation();
              setOpenPinId(null);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <LuX className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}

export function AssemblyView({
  operationId,
  job,
  operation,
  thumbnailPath,
  trackedEntities,
  trackedEntityId,
  materials,
  procedure,
  tools,
  ncrs,
  requiresSerialTracking,
  requiresBatchTracking,
  openEvent,
  events,
  nonConformanceActions,
  expiredEntityPolicy = "Block",
  autoStartOperationTimer = false,
  workCenter,
  kanban,
  jobId,
  canOverrideComplete = false,
  modelPath,
  slideModels,
  assemblyPlayback,
  productionQuantities = { scrap: 0, production: 0, rework: 0 }
}: Props) {
  const user = useUser();
  const mode = useMode();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  // Which main panel is shown: the assembly details, the 3D model, or chat.
  const [tab, setTab] = useState<"details" | "model" | "chat">("details");

  const issueModal = useDisclosure();
  const qualityModal = useDisclosure();
  const completeModal = useDisclosure();
  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const finishModal = useDisclosure();
  const maintenanceModal = useDisclosure();
  const serialModal = useDisclosure();
  const actionsSheet = useDisclosure();
  const completeAllModal = useDisclosure();
  const completeAllFetcher = useFetcher<{ success?: boolean }>();
  // Silent auto-completion of a single unit once its final step is recorded
  // (multi-quantity assembly builds one at a time — see the effect below).
  const completeUnitFetcher = useFetcher<{ id?: string }>();
  const imageViewer = useDisclosure();
  // Which reference image fills the main panel: a step photo (index) or the
  // finished-product image ("finished").
  const [selected, setSelected] = useState<number | "finished" | "playback">(
    "finished"
  );
  // Operator toggle for the reference-image annotation pins (always-on vs tap-to-hide).
  const [showPins, setShowPins] = useState(true);
  // Steps-bar filter: which steps the segmented bar shows for the current unit.
  const [stepFilter, setStepFilter] = useState<
    "all" | "completed" | "incomplete"
  >("all");
  // For non-tracked material inline issue
  const [selectedMaterial, setSelectedMaterial] = useState<any | null>(null);

  // Live sync — refresh loader data when this operation's events, step records,
  // job, or tracked entities change (incl. edits from the operation view).
  useRealtimeChannel({
    topic: `assembly:${operationId}`,
    dependencies: [operationId],
    setup(channel) {
      const refresh = () => revalidator.revalidate();
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${operationId}`
          },
          refresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobOperationStepRecord" },
          refresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "trackedActivity" },
          refresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=eq.${operationId}`
          },
          refresh
        );
    }
  });

  // Kanban barcode scan → complete the operation (matches the operation view).
  const completeFetcher = useFetcher();
  useKeyboardWedge({
    test: (input) =>
      kanban?.completedBarcodeOverride
        ? input === kanban.completedBarcodeOverride
        : kanban?.id
          ? input === path.to.kanbanComplete(kanban.id)
          : false,
    callback: () => completeFetcher.load(path.to.endOperation(operationId)),
    active: !!kanban?.id
  });

  // Which work types this operation actually uses (only show/select these).
  const workTypes = (
    [
      (operation?.setupDuration ?? 0) > 0 ? "Setup" : null,
      (operation?.laborDuration ?? 0) > 0 ? "Labor" : null,
      (operation?.machineDuration ?? 0) > 0 ? "Machine" : null
    ] as const
  ).filter(Boolean) as ("Setup" | "Labor" | "Machine")[];
  // Each available work type gets its own header clock button. If the operation
  // has no configured durations, still surface a single Labor clock so time can
  // always be recorded.
  const headerWorkTypes: ("Setup" | "Labor" | "Machine")[] =
    workTypes.length > 0 ? workTypes : ["Labor"];
  // Open (running) event for a work type, derived from events. A freshly-started
  // Labor event may not be in `events` yet (the realtime channel keeps the
  // `openEvent` prop fresher), so fall back to it for Labor.
  const openEventForWorkType = (type: "Setup" | "Labor" | "Machine") =>
    events.find((e) => e.type === type && !e.endTime) ??
    (type === "Labor" ? openEvent : null);

  const isTracked = requiresSerialTracking || requiresBatchTracking;
  // Only serial parents rotate a distinct tracked entity per unit, so only they
  // navigate the unit axis by ?trackedEntityId. A batch parent shares ONE lot across
  // every unit — like an untracked parent it pages by ?unit index and rolls forward
  // on quantityComplete; the lot still binds to every unit (materials + completion).
  const navigatesByEntity = requiresSerialTracking;

  // Source location for material issuing — same source the Operation view uses. FIX-7:
  // the issue modal needs it (and the work center) to resolve a stock source, which most
  // affects Inventory/Non-Inventory components.
  const layoutData = useRouteData<{ location: string }>(
    path.to.authenticatedRoot
  );
  const locationId = layoutData?.location;

  // Real build steps only. NCR actions are surfaced through the dedicated "Open NCRs"
  // sidebar + Flag-issue affordance, never injected as synthetic build steps (story 20).
  const steps = (procedure.attributes ?? [])
    .filter(
      (s) =>
        !(
          s.type === "Inspection" &&
          (s as { nonConformanceActionId?: string | null })
            .nonConformanceActionId != null
        )
    )
    .toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const parameters = procedure.parameters ?? [];

  // Current step, computed early so materials/tools can be filtered to it. Mirrors the
  // clamp reused below for slides and step records.
  const currentStep = Math.max(
    0,
    Math.min(
      Number.parseInt(searchParams.get("step") ?? "0", 10) || 0,
      Math.max(0, steps.length - 1)
    )
  );
  const step = steps[currentStep] ?? null;

  // Part ↔ step (many-to-many): a part is shown ONLY on the step(s) it's assigned to. Parts
  // with NO step link are unassigned ("General") and show on the FIRST step only — loose
  // untracked parts are backflushed when the unit's first step is recorded, so that's
  // where the operator sees and handles them; repeating them on every step just buries
  // the step-specific parts. Quantity and issuing live on the jobMaterial (the part), so
  // a part on several assigned steps never multiplies the requirement.
  const stepNumberById = new Map(steps.map((s, i) => [s.id, i + 1] as const));
  const allMaterials: any[] = materials?.materials ?? [];
  const isGeneralMaterial = (m: any) =>
    (m.jobOperationStepIds ?? []).length === 0;
  const isOnCurrentStep = (m: any) =>
    step?.id != null && (m.jobOperationStepIds ?? []).includes(step.id);
  // Visible here = parts assigned to the current step, plus (first step only) the
  // unassigned General parts. Parts assigned only to other steps are hidden. Assigned
  // parts sort first, General after.
  const visibleMaterials: any[] = allMaterials
    .filter(
      (m) => isOnCurrentStep(m) || (currentStep === 0 && isGeneralMaterial(m))
    )
    .sort((a, b) => {
      const r = (isOnCurrentStep(a) ? 0 : 1) - (isOnCurrentStep(b) ? 0 : 1);
      if (r !== 0) return r;
      const at = TYPE_ORDER.indexOf(a.itemType ?? "");
      const bt = TYPE_ORDER.indexOf(b.itemType ?? "");
      return (at < 0 ? 99 : at) - (bt < 0 ? 99 : bt);
    });

  // Phase 2 (tool ↔ step, many-to-many): show only the tools involved in the current step —
  // a tool scoped to steps (jobOperationStepIds) appears on those steps; operation-level tools
  // (no links) appear on every step. Backward compatible: with no assignments, every tool is
  // operation-level and shows everywhere. Mirrors the per-step material filter above.
  const stepTools = tools.filter((t) => {
    const ids: string[] = t.jobOperationStepIds ?? [];
    // No links = operation-level (every step); otherwise only the linked steps.
    return ids.length === 0 || (step?.id != null && ids.includes(step.id));
  });

  // FIX-1: quantity-centric unit axis — pages "Unit X of N" for EVERY tracking type.
  // operationQuantity is the unit count; unit i carries trackedEntities[i] ?? null, so
  // Serial binds a serial per unit, Batch binds the lot to unit 0, and Inventory binds
  // none — all still page 1..N with per-unit step records. A job can pre-generate more
  // serials than the quantity, so the count caps the entity list.
  // See apps/mes/app/utils/units.ts + .ai/specs/2026-07-14-mes-execution-views.md
  // §2 ("unit axis").
  const unitCount = Math.max(
    1,
    Math.round(operation?.operationQuantity ?? trackedEntities.length)
  );
  // Only serial/batch parents bind entities to the unit axis; inventory/non-inventory
  // page purely by index, so stray inventory entities must not surface as units or "S/N".
  const axisEntities = isTracked ? trackedEntities : [];
  const units = deriveUnits(unitCount, axisEntities);
  // The tracked entities within the navigable set (for the serial picker; empty when
  // the parent is untracked).
  const unitEntities = axisEntities.slice(0, unitCount);

  // Units already built. Drives the quantity progress indicator and, for untracked
  // parents, the default landing unit (the next one still to build).
  const quantityComplete = Math.max(
    0,
    Math.round(operation?.quantityComplete ?? 0)
  );

  // Resolve the current unit: by tracked entity from the URL when present, else by the
  // ?unit index — untracked parents have no entity to key off. (FIX-3 / FIX-4)
  const unitParam = Number.parseInt(searchParams.get("unit") ?? "", 10);
  const hasUnitParam =
    Number.isInteger(unitParam) && unitParam >= 0 && unitParam < units.length;
  const currentUnitIndex = (() => {
    if (navigatesByEntity && trackedEntityId) {
      const i = units.findIndex((u) => u.entity?.id === trackedEntityId);
      if (i >= 0) return i;
    }
    if (hasUnitParam) return unitParam;
    // No explicit unit: land on the next unit still to build (quantityComplete)
    // rather than an already-finished unit 0 — for EVERY tracking type. A serial
    // parent normally resolves by entity above (the loader seeds trackedEntityId
    // to this same unit); this is the fallback when no entity is resolvable.
    return Math.min(quantityComplete, Math.max(0, units.length - 1));
  })();
  const currentUnit = units[currentUnitIndex] ?? units[0];
  // Serial binds the per-unit entity; batch shares one lot across all units, so the
  // sole tracked entity binds to every unit (unit i > 0 has no entity of its own).
  const currentEntity = requiresBatchTracking
    ? (axisEntities[0] ?? undefined)
    : (currentUnit?.entity ?? undefined);

  // Step records key off the unit index for ALL tracking types, identical to the
  // Operation view (FIX-1 / FIX-5) — this is what isolates unit i's records.
  const activeIndex = currentUnitIndex;

  const isStepDone = (step: Step) =>
    (step.jobOperationStepRecord ?? []).some((r) => r.index === activeIndex);
  // A recorded step whose value FAILS its acceptance criteria for a given unit:
  // a Measurement out of [min, max], or a pass/fail step (Inspection) recorded as
  // not passing. Mirrors the out-of-spec red styling in the operation view's Step
  // component. Drives the red bar/badge and the red unit indicators below.
  const isStepBadResultAtIndex = (step: Step, index: number) => {
    const record = (step.jobOperationStepRecord ?? []).find(
      (r) => r.index === index
    );
    if (!record) return false;
    if (step.type === "Measurement") {
      const value = record.numericValue;
      if (value == null) return false;
      return (
        (step.minValue != null && value < step.minValue) ||
        (step.maxValue != null && value > step.maxValue)
      );
    }
    if (step.type === "Inspection") return record.booleanValue === false;
    return false;
  };
  const isStepBadResult = (step: Step) =>
    isStepBadResultAtIndex(step, activeIndex);
  // Does any step have an out-of-spec record for this unit? Flags the unit red in
  // the sidebar navigator so a bad build is visible without opening each unit.
  const unitHasBadResult = (index: number) =>
    steps.some((s) => isStepBadResultAtIndex(s, index));
  // Every step recorded for this unit — flags a fully-built unit green in the
  // navigator (mirrors `allStepsRecorded`, but for an arbitrary unit index).
  const unitIsRecorded = (index: number) =>
    steps.length > 0 &&
    steps.every((s) =>
      (s.jobOperationStepRecord ?? []).some((r) => r.index === index)
    );
  const doneCount = steps.filter(isStepDone).length;
  // All steps recorded for the current unit — drives the "Steps are missing"
  // warning in the complete/finish flow (soft warning, mirrors operation view).
  const allStepsRecorded = steps.length > 0 && doneCount === steps.length;

  // Per-material issue state for the current step + unit, computed once so the
  // Parts cards and the completion gate agree. `issuedIsPerUnit`/`issuedOverride`
  // mirror the props the rows receive (serial parents report per-unit consumption
  // for tracked parts; untracked parts are backflushed on the server when the
  // step that owns them is recorded).
  const firstStep = steps[0];
  const visibleMaterialsWithState = visibleMaterials.map((m) => {
    const stepNumbers = ((m.jobOperationStepIds ?? []) as string[])
      .map((id) => stepNumberById.get(id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    const isTrackedMat = m.requiresSerialTracking || m.requiresBatchTracking;
    const isLoose = !isTrackedMat && stepNumbers.length === 0;
    // The loader returns a per-unit quantityIssued for tracked materials under BOTH
    // serial parents (attributed by the unit's own entity) and batch parents
    // (attributed by the "Unit" stamp), so render it raw — no per-unit heuristic.
    const issuedIsPerUnit =
      (requiresSerialTracking || requiresBatchTracking) && isTrackedMat;
    // Untracked parts are auto-issued server-side when their owning step is
    // recorded for a unit — loose parts on the operation's FIRST step, and
    // step-assigned parts on any of their assigned step(s). Mirror that so the
    // row flips to issued the instant the owning step is done. Extra parts
    // (perUnit 0, issued ad-hoc from the floor) are excluded so their raw
    // quantityIssued drives the X/0 display instead.
    const perUnit = m.quantity ?? 0;
    const ownedStepDoneForUnit = isLoose
      ? !!firstStep && isStepDone(firstStep)
      : steps.some(
          (s) => (m.jobOperationStepIds ?? []).includes(s.id) && isStepDone(s)
        );
    const issuedOverride =
      !isTrackedMat && perUnit > 0
        ? ownedStepDoneForUnit
          ? perUnit
          : 0
        : undefined;
    const state = getIssuedForUnit(m, {
      unitIndex: currentUnitIndex,
      issuedIsPerUnit,
      issuedOverride
    });
    return {
      m,
      stepNumbers,
      isTrackedMat,
      issuedIsPerUnit,
      issuedOverride,
      state
    };
  });

  // Tracked parts assigned to the current step that still need scanning for THIS
  // unit. They soft-gate the step: the operator can still Skip, but the primary
  // Mark done / Record action is disabled until they're issued. Non-tracked/loose
  // parts never gate — they're backflushed when the step is recorded. Unplanned
  // extras (required 0) never gate either — there's no requirement to satisfy.
  const pendingScanMaterials = visibleMaterialsWithState.filter(
    (v) => v.isTrackedMat && v.state.required > 0 && !v.state.fullyIssued
  );
  const hasPendingScans = pendingScanMaterials.length > 0;

  // Open production events per work type (to pass to the complete flow so it
  // can close them on completion).
  const openByType = (type: string) =>
    (events.find((e) => e.type === type && !e.endTime) ?? undefined) as
      | ProductionEventType
      | undefined;

  const stepHasDescription = richTextToPlainText(step?.description).length > 0;
  const stepDescriptionHtml =
    step && stepHasDescription
      ? generateHTML(
          stripImages(step.description) as Parameters<typeof generateHTML>[0]
        )
      : "";
  const isLastStep = steps.length === 0 || currentStep >= steps.length - 1;

  // Reference slides for this step (first-class media, ordered) + "Completed item"
  // = the finished product (the assembly item's thumbnail). See
  // .ai/specs/2026-07-14-mes-execution-views.md §4.
  const stepSlides = (step?.jobOperationStepSlide ?? [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  // Per-slide media: an image slide renders as a picture (with pins); a 3D model
  // slide renders in ModelPreview — preferring the assembler-converted GLB (glbPath,
  // else the optimised GLB derived from the raw path) and keeping the raw upload
  // only as a last-resort fallback.
  const slideMedia = stepSlides.map((slide) => {
    if (slide.modelUploadId) {
      const model = slideModels?.[slide.modelUploadId] ?? null;
      // ModelPreview loads the assembler-converted GLB fast tier when present and
      // falls back to parsing the raw upload client-side (WASM tier).
      const glbUrl = model?.glbPath
        ? getPrivateUrl(model.glbPath)
        : optimizedModelPreviewUrl(model?.modelPath ?? null);
      const rawUrl = model?.modelPath ? getPrivateUrl(model.modelPath) : null;
      return {
        kind: "model" as const,
        url: glbUrl ?? rawUrl,
        glbUrl,
        rawUrl,
        thumbnail: model?.thumbnailPath
          ? getPrivateUrl(model.thumbnailPath)
          : null
      };
    }
    return {
      kind: "image" as const,
      url: slide.imagePath ? getPrivateUrl(slide.imagePath) : null,
      thumbnail: slide.imagePath ? getPrivateUrl(slide.imagePath) : null
    };
  });
  const assemblyImage = thumbnailPath ? getPrivateUrl(thumbnailPath) : null;
  const selectedMedia =
    typeof selected === "number" ? (slideMedia[selected] ?? null) : null;
  const selectedModelUrl =
    selectedMedia?.kind === "model" ? selectedMedia.url : null;
  const mainImage =
    selected === "finished"
      ? assemblyImage
      : selectedMedia?.kind === "image"
        ? (selectedMedia.url ?? assemblyImage)
        : assemblyImage;

  // Step-aware 3D playback: when this BOP step was synced from an assembly
  // instruction (assemblyInstructionStepId marker) and the instruction's model
  // has converted artifacts, drive the animated player to exactly this step —
  // parts installed so far, the incoming part's motion, the planner's camera.
  const viewerSteps = useMemo(
    () => (assemblyPlayback?.steps ?? []).map(toViewerStep),
    [assemblyPlayback]
  );
  const playbackIndex = useMemo(() => {
    if (!assemblyPlayback || !step?.assemblyInstructionStepId) return null;
    const index = assemblyPlayback.steps.findIndex(
      (playbackStep) => playbackStep.id === step.assemblyInstructionStepId
    );
    return index >= 0 ? index : null;
  }, [assemblyPlayback, step]);
  const playbackAvailable = playbackIndex !== null && viewerSteps.length > 0;
  const selectedCaption =
    typeof selected === "number"
      ? (stepSlides[selected]?.caption ?? null)
      : null;
  // Annotation pins for the shown slide (empty for the finished-item view).
  const selectedAnnotations =
    typeof selected === "number"
      ? (stepSlides[selected]?.annotations ?? [])
      : [];

  // Smart hotspots: link a pin's toolId to the step's tools. `toolNameById` names a pin's
  // tool on hover; `pinSeqByToolId` lets the Tools sidebar badge each tool with the pin
  // sequence number(s) that point at it — i.e. the fastener/assembly order.
  const toolNameById = new Map<string, string>();
  for (const t of stepTools) {
    if (t.item?.id) toolNameById.set(t.item.id, t.item.name);
  }
  const pinSeqByToolId = new Map<string, number[]>();
  selectedAnnotations.forEach((pin, i) => {
    if (!pin.toolId) return;
    const seq = pinSeqByToolId.get(pin.toolId) ?? [];
    seq.push(i + 1);
    pinSeqByToolId.set(pin.toolId, seq);
  });

  // On step change, default the main panel to the animated step playback when this
  // step maps to an instruction step; otherwise the step's first slide, and only
  // fall back to the finished-assembly image when the step has neither.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the current step
  useEffect(() => {
    setSelected(
      playbackAvailable ? "playback" : stepSlides.length > 0 ? 0 : "finished"
    );
  }, [currentStep, stepSlides.length, playbackAvailable]);

  function goToStep(n: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("step", String(n));
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  // ── Auto-advance + labor automation ──────────────────────────────────────
  // Reduce keystrokes on the shop floor: the moment the step the operator is
  // looking at flips to "done" (a record just landed — Mark done, Record, a
  // measurement, a file upload — all revalidate `isStepDone`), advance to the
  // next step and kick off the labor clock. Gated on the step index being
  // unchanged so navigating BACK to an already-done step never bounces forward.
  const laborFetcher = useFetcher();
  const openLaborEvent = openByType("Labor");
  const currentStepDone = step ? isStepDone(step) : false;
  const stepDoneRef = useRef({ step: currentStep, done: currentStepDone });
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on the current step only
  useEffect(() => {
    const prev = stepDoneRef.current;
    stepDoneRef.current = { step: currentStep, done: currentStepDone };
    const justCompleted =
      prev.step === currentStep && !prev.done && currentStepDone;
    if (!justCompleted) return;

    // Start the labor clock on the first completion when nothing is running yet.
    // Skip it on the completion that finishes the whole operation — the stop
    // effect below handles that and a zero-length event helps no one.
    if (
      operation &&
      !openLaborEvent &&
      !allStepsRecorded &&
      laborFetcher.state === "idle"
    ) {
      const fd = new FormData();
      fd.set("jobOperationId", operation.id);
      fd.set("timezone", getLocalTimeZone());
      fd.set("type", "Labor");
      fd.set("action", "Start");
      // Recording the first step means hands-on build has begun: end any open
      // Setup clock and switch to Labor (auto-transition).
      fd.set("exclusive", "true");
      if (operation.workCenterId)
        fd.set("workCenterId", operation.workCenterId);
      const entityId = isTracked ? currentEntity?.id : undefined;
      if (entityId) fd.set("trackedEntityId", entityId);
      fd.set("unitIndex", String(currentUnitIndex));
      laborFetcher.submit(fd, {
        method: "post",
        action: path.to.productionEvent
      });
    }

    if (!isLastStep) goToStep(currentStep + 1);
  }, [currentStep, currentStepDone, isLastStep, allStepsRecorded]);

  // Stop the labor clock automatically once every step is recorded for this unit.
  const allDoneRef = useRef(allStepsRecorded);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on all-complete
  useEffect(() => {
    const wasAllDone = allDoneRef.current;
    allDoneRef.current = allStepsRecorded;
    if (
      !wasAllDone &&
      allStepsRecorded &&
      operation &&
      openLaborEvent &&
      laborFetcher.state === "idle"
    ) {
      const fd = new FormData();
      fd.set("jobOperationId", operation.id);
      fd.set("timezone", getLocalTimeZone());
      fd.set("type", "Labor");
      fd.set("action", "End");
      fd.set("id", openLaborEvent.id);
      laborFetcher.submit(fd, {
        method: "post",
        action: path.to.productionEvent
      });
    }
  }, [allStepsRecorded]);

  // ── Auto-complete one unit + roll to the next ────────────────────────────
  // Assembly builds one unit at a time. For a multi-quantity operation, the
  // moment every step is recorded for the current unit we silently log a single
  // completed quantity (POST /x/complete, quantity 1) and return to step 1 of
  // the next unit — until the whole quantity is built, where the final
  // completion finishes the operation server-side (willBeFinished → redirect).
  // Single-quantity operations keep the manual "Complete" flow untouched.
  const isMultiQuantity = unitCount > 1;
  const unitsRemaining = unitCount - quantityComplete;
  const autoCompleteSubmittedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on all-complete
  useEffect(() => {
    if (!isMultiQuantity || unitsRemaining <= 0) return;
    // Only auto-complete the unit currently being built. Guards against
    // re-completing an already-finished unit whose step records still read
    // "done" if the operator navigates back to it.
    if (currentUnitIndex < quantityComplete) return;
    if (!allStepsRecorded) {
      // On a not-yet-finished unit — arm for its eventual completion.
      autoCompleteSubmittedRef.current = false;
      return;
    }
    if (autoCompleteSubmittedRef.current) return;
    if (!operation || completeUnitFetcher.state !== "idle") return;
    autoCompleteSubmittedRef.current = true;

    const fd = new FormData();
    fd.set("jobOperationId", operation.id);
    fd.set("quantity", "1");
    if (requiresSerialTracking) fd.set("trackingType", "Serial");
    else if (requiresBatchTracking) fd.set("trackingType", "Batch");
    if (isTracked && currentEntity?.id)
      fd.set("trackedEntityId", currentEntity.id);
    // Link the open production events so the completion is attributed to them.
    const setup = openByType("Setup");
    const labor = openByType("Labor");
    const machine = openByType("Machine");
    if (setup?.id) fd.set("setupProductionEventId", setup.id);
    if (labor?.id) fd.set("laborProductionEventId", labor.id);
    if (machine?.id) fd.set("machineProductionEventId", machine.id);
    completeUnitFetcher.submit(fd, {
      method: "post",
      action: path.to.complete
    });

    // Batch + untracked parents track the unit-being-built by quantityComplete (they
    // page by index), so drop any explicit ?unit and let currentUnitIndex fall back to
    // quantityComplete — which the completion rolls forward. Serial completions redirect
    // to a fresh entity instead, so leave their params be.
    if (!navigatesByEntity && hasUnitParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("unit");
          return next;
        },
        { replace: true, preventScrollReset: true }
      );
    }
  }, [allStepsRecorded, isMultiQuantity, unitsRemaining]);

  // Re-arm auto-complete when a completion POST fails. complete.tsx returns
  // data({}, flash-error) on any failure (insufficient stock, serial-mint
  // failure, …) — an empty object — while success returns the production row(s)
  // or a redirect. Without this, autoCompleteSubmittedRef stays latched: every
  // step reads green, the unit never advances, and the error flash is the only
  // (transient) signal. Re-arming lets the operator retry (re-record a step, or
  // the manual Complete flow) without wedging the unit. This does NOT loop: the
  // auto-complete effect only re-fires when its deps actually change, and a
  // failed completion leaves quantityComplete (hence unitsRemaining) unchanged.
  const prevCompleteUnitStateRef = useRef(completeUnitFetcher.state);
  useEffect(() => {
    const settled =
      prevCompleteUnitStateRef.current !== "idle" &&
      completeUnitFetcher.state === "idle";
    prevCompleteUnitStateRef.current = completeUnitFetcher.state;
    if (!settled) return;
    const result = completeUnitFetcher.data;
    const failed =
      !!result &&
      !Array.isArray(result) &&
      typeof result === "object" &&
      Object.keys(result).length === 0;
    if (failed) autoCompleteSubmittedRef.current = false;
  }, [completeUnitFetcher.state, completeUnitFetcher.data]);

  // Return to step 1 on a new unit. Whenever the active unit changes — the
  // auto-complete rolls quantityComplete forward (untracked), a serial/batch
  // completion redirects to a fresh entity, or the operator pages units by hand —
  // jump to that unit's first step still to record (step 1 for a fresh unit). This
  // is what returns the operator to the top after finishing a unit's last step.
  const lastUnitRef = useRef(currentUnitIndex);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transition-detect on the unit index
  useEffect(() => {
    if (lastUnitRef.current === currentUnitIndex) return;
    lastUnitRef.current = currentUnitIndex;
    const firstIncomplete = steps.findIndex((s) => !isStepDone(s));
    goToStep(firstIncomplete >= 0 ? firstIncomplete : 0);
  }, [currentUnitIndex]);

  // On first open (no explicit ?step in the URL), land on the first step that
  // isn't done for this unit rather than always step 1 — the operator resumes
  // where they left off. Resolves once, as soon as steps are available; an
  // explicit ?step (a shared/bookmarked link) is always respected.
  const initialStepResolvedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot once steps load
  useEffect(() => {
    if (initialStepResolvedRef.current) return;
    if (searchParams.get("step") != null) {
      initialStepResolvedRef.current = true;
      return;
    }
    if (steps.length === 0) return; // wait for steps to load
    initialStepResolvedRef.current = true;
    const firstIncomplete = steps.findIndex((s) => !isStepDone(s));
    if (firstIncomplete > 0) goToStep(firstIncomplete);
  }, [steps.length]);

  function navigateEntity(entity: { id: string }) {
    const url = new URL(window.location.href);
    url.searchParams.set("trackedEntityId", entity.id);
    url.searchParams.delete("unit");
    navigate(url.pathname + url.search);
  }

  // Serial parents mint one serial at a time — the next unit's tracked entity is only
  // created when the current unit completes — so units beyond the created serials have
  // no entity yet and can't be worked on (scanning tracked parts and completing the unit
  // both require it). Cap navigation to the last unit that has a serial. Batch/untracked
  // parents page purely by index, so every unit stays reachable.
  const maxNavigableUnitIndex = navigatesByEntity
    ? units.reduce((max, u) => (u.entity ? Math.max(max, u.index) : max), 0)
    : unitCount - 1;

  // Navigate to a unit by its axis position (the prev/next pager). Serial units key
  // off their entity so the loader refetches that entity's materials; batch + untracked
  // units key off ?unit (batch shares one lot, untracked has no entity to scan —
  // FIX-3/FIX-4). The unit-change effect above then moves the step cursor to that unit's
  // first incomplete step. The clamp to maxNavigableUnitIndex blocks paging onto a unit
  // whose serial hasn't been minted yet.
  function goToUnit(n: number) {
    const clamped = Math.max(0, Math.min(n, maxNavigableUnitIndex));
    if (clamped === currentUnitIndex) return;
    const entity = units[clamped]?.entity;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (navigatesByEntity && entity?.id) {
          next.set("trackedEntityId", entity.id);
          next.delete("unit");
        } else {
          next.set("unit", String(clamped));
          next.delete("trackedEntityId");
        }
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  const companyLogo =
    mode === "dark" ? user.company.logoDarkIcon : user.company.logoLightIcon;

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── HEADER ── */}
      <header className="flex h-[52px] shrink-0 items-center bg-card border-b border-border">
        {/* Full-height segment matching the Flag issue / Complete / timer buttons. */}
        <SidebarTrigger className="h-full w-auto shrink-0 rounded-none border-r border-border px-2 hover:bg-accent md:px-4" />
        {companyLogo ? (
          <div className="hidden h-full shrink-0 items-center border-r border-border px-4 sm:flex">
            <img
              src={companyLogo}
              alt={`${user.company.name} logo`}
              className="h-7 w-auto max-w-[140px] object-contain"
            />
          </div>
        ) : null}

        <div className="flex h-full min-w-0 items-center gap-2 border-r border-border px-3 md:px-5">
          <span className="truncate text-sm font-semibold">
            {job?.itemReadableIdWithRevision ?? "—"}
          </span>
          {operation?.description ? (
            <>
              <span className="hidden text-muted-foreground md:inline">·</span>
              <span className="hidden truncate text-sm text-foreground/90 lg:inline">
                {operation.description}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex-1" />

        {/* Full-height segmented actions — same treatment as the timer button:
            flush, no rounded corners, a left-border divider, hover highlight. */}
        <button
          type="button"
          onClick={qualityModal.onOpen}
          className="hidden h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4 lg:flex"
        >
          <LuFlag className="size-4" />
          Flag issue
        </button>
        {operation ? (
          <button
            type="button"
            onClick={completeModal.onOpen}
            className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 text-sm font-medium transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4"
          >
            <LuCheck className="size-4" />
            <span className="hidden sm:inline">Complete</span>
            <span className="sm:hidden">Done</span>
          </button>
        ) : null}
        {operation ? (
          <button
            type="button"
            aria-label="More actions"
            onClick={actionsSheet.onOpen}
            className="flex h-full shrink-0 items-center justify-center border-l border-border px-2 transition-colors hover:bg-accent active:scale-[0.98] md:px-4"
          >
            <LuEllipsisVertical className="size-4" />
          </button>
        ) : null}

        {operation
          ? headerWorkTypes.map((wt) => (
              <TimerControl
                key={wt}
                operation={operation}
                openEvent={openEventForWorkType(wt)}
                workType={wt}
                trackedEntityId={isTracked ? currentEntity?.id : undefined}
                unitIndex={currentUnitIndex}
              />
            ))
          : null}
      </header>

      {/* ── STEPS BAR (segmented, click to jump; green = done) ── */}
      {steps.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-3 bg-card border-b border-border px-5">
          {/* Label reflects the active filter so a filtered bar (e.g. only the completed,
              all-green steps) is never mistaken for "everything done". */}
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {stepFilter === "completed"
              ? `${doneCount} completed`
              : stepFilter === "incomplete"
                ? `${steps.length - doneCount} incomplete`
                : `${doneCount} / ${steps.length} done`}
          </span>
          <div className="flex flex-1 items-center gap-1">
            {steps
              .map((s, i) => [s, i] as const)
              .filter(([s]) =>
                stepFilter === "all"
                  ? true
                  : stepFilter === "completed"
                    ? isStepDone(s)
                    : !isStepDone(s)
              )
              .map(([s, i]) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => goToStep(i)}
                  className={cn(
                    "h-3 flex-1 rounded-[2px] transition-colors",
                    isStepDone(s)
                      ? isStepBadResult(s)
                        ? "bg-red-500"
                        : "bg-emerald-500"
                      : i === currentStep
                        ? "bg-foreground"
                        : "bg-border hover:bg-muted-foreground/40"
                  )}
                />
              ))}
            {stepFilter === "incomplete" && doneCount === steps.length && (
              <span className="text-xs text-emerald-500">All steps done</span>
            )}
            {stepFilter === "completed" && doneCount === 0 && (
              <span className="text-xs text-muted-foreground">
                No completed steps yet
              </span>
            )}
          </div>
          {/* Filter which steps the bar emphasizes (all / completed / incomplete). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="Filter steps"
                variant={stepFilter === "all" ? "ghost" : "active"}
                size="sm"
                icon={<LuListFilter />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={stepFilter}
                onValueChange={(v) =>
                  setStepFilter(v as "all" | "completed" | "incomplete")
                }
              >
                <DropdownMenuRadioItem value="all">
                  Show all
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="completed">
                  Show completed
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="incomplete">
                  Show incomplete
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {currentStep + 1} / {steps.length}
          </span>
          {/* Unit pager — fallback for narrow screens (< lg) where the left sidebar
              is hidden; on lg+ the richer sidebar UnitNavigator takes over. Assembly
              builds one at a time, but the operator can page back to review or fix a
              prior unit's step records — mirrors the operation view. */}
          {isMultiQuantity && (
            <div className="flex items-center gap-0.5 lg:hidden">
              <IconButton
                aria-label="Previous unit"
                variant="ghost"
                size="sm"
                icon={<LuChevronLeft />}
                isDisabled={currentUnitIndex <= 0}
                onClick={() => goToUnit(currentUnitIndex - 1)}
              />
              <Badge
                variant="secondary"
                className="whitespace-nowrap tabular-nums"
              >
                Unit {Math.min(currentUnitIndex + 1, unitCount)} / {unitCount}
              </Badge>
              <IconButton
                aria-label="Next unit"
                variant="ghost"
                size="sm"
                icon={<LuChevronRight />}
                isDisabled={currentUnitIndex >= maxNavigableUnitIndex}
                onClick={() => goToUnit(currentUnitIndex + 1)}
              />
            </div>
          )}
        </div>
      )}

      {/* ── BODY ── stacks vertically (page scrolls) on phones/tablets,
          three columns side-by-side on lg+. ── */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── LEFT PANEL: part detail + timer + containment ── */}
        <aside className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-border bg-card lg:flex xl:w-[280px]">
          {/* Part info. For a multi-quantity build the tracked-entity identity moves
              into the dedicated Units section below the timers. */}
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <p className="truncate text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {job?.itemReadableIdWithRevision ?? "—"}
            </p>
            {operation?.itemDescription && (
              <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">
                {operation.itemDescription}
              </p>
            )}
            {!isMultiQuantity && currentEntity ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {requiresBatchTracking ? "Batch" : "S/N"}
                </Badge>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {currentEntity.readableId ?? currentEntity.id.slice(0, 8)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Cumulative timer — click a row to choose which clock the play
              button tracks. Only work types this operation uses are shown. */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Progress
            </p>
            {/* The live tick lives inside TimeRows so the per-second re-render is
                scoped to the timer display — it must NOT re-render the whole view,
                which would disrupt an open RecordModal's in-progress number entry. */}
            <TimeRows
              events={events}
              setupDuration={operation?.setupDuration ?? 0}
              laborDuration={operation?.laborDuration ?? 0}
              machineDuration={operation?.machineDuration ?? 0}
            />
            {/* Quantity progress — units completed / reworked / scrapped of the
                operation quantity. Segments mirror the operation view: completed
                (emerald), reworked (yellow), scrapped (red). Only shown when
                building more than one (single-qty stays lean). */}
            {isMultiQuantity && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Quantity
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.min(quantityComplete, unitCount)}/{unitCount}
                  </span>
                </div>
                <BarProgress
                  max={unitCount || 1}
                  progress={quantityComplete}
                  segments={[
                    {
                      value: Math.min(quantityComplete, unitCount),
                      className: "bg-emerald-500"
                    },
                    {
                      value: productionQuantities.rework,
                      className: "bg-yellow-500"
                    },
                    {
                      value: productionQuantities.scrap,
                      className: "bg-red-500"
                    }
                  ]}
                />
              </div>
            )}
            {/* Steps done count */}
            {steps.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Steps</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {doneCount}/{steps.length}
                  </span>
                </div>
                <BarProgress max={steps.length || 1} progress={doneCount} />
              </div>
            )}
          </div>

          {/* Units — the full, scrollable list of every unit/serial being built,
              with its own section header + compact pager. Sits under Time. */}
          {isMultiQuantity && (
            <UnitNavigator
              units={units}
              currentUnitIndex={currentUnitIndex}
              maxNavigableIndex={maxNavigableUnitIndex}
              isTracked={isTracked}
              labelByEntity={requiresSerialTracking}
              trackingLabel={requiresBatchTracking ? "Batch" : "S/N"}
              // Print the current unit's serial/lot label. Only tracked units have
              // an entity to print; untracked builds have nothing to label.
              headerAction={
                isTracked && currentEntity?.id ? (
                  <PrintButton
                    isIcon
                    variant="ghost"
                    size="lg"
                    sourceDocument="Entity"
                    sourceDocumentId={currentEntity.id}
                    locationId={locationId}
                    context="workCenter"
                    workCenterId={operation?.workCenterId ?? undefined}
                    fileRoutes={{
                      pdf: path.to.file.trackedEntityLabelPdf,
                      zpl: path.to.file.trackedEntityLabelZpl
                    }}
                  />
                ) : null
              }
              unitHasBadResult={unitHasBadResult}
              unitIsRecorded={unitIsRecorded}
              onSelectUnit={goToUnit}
            />
          )}

          {/* Containment actions (NCR-driven) — collapsible accordion at the
              bottom of the left panel. Click a row to expand/collapse. */}
          {(() => {
            const containments = nonConformanceActions.filter(
              (a) => a.notes && Object.keys(a.notes as object).length > 0
            );
            if (containments.length === 0) return null;
            return (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
                <p className="mb-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Containment
                </p>
                <Accordion type="multiple" className="flex flex-col">
                  {containments.map((action) => (
                    <AccordionItem
                      key={action.id}
                      value={action.id}
                      className="border-b-0"
                    >
                      <AccordionTrigger className="gap-2 py-2 text-left text-xs hover:no-underline">
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                          <span className="truncate font-semibold leading-tight text-foreground">
                            {action.actionTypeName}
                          </span>
                          <Badge
                            variant="outline"
                            className="w-fit font-mono text-[9px]"
                          >
                            {action.nonConformanceId}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2 pt-0">
                        <div
                          className="prose prose-sm max-w-none rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-foreground/90 dark:prose-invert"
                          dangerouslySetInnerHTML={{
                            __html: generateHTML(
                              action.notes as Parameters<typeof generateHTML>[0]
                            )
                          }}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            );
          })()}

          {/* Operation status — mirrors the operation view's header strip. */}
          {operation && (
            <div className="mt-auto flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              {operation.jobReadableId && (
                <StatusRow label="Job" value={operation.jobReadableId} mono />
              )}
              {operation.description && (
                <StatusRow label="Operation" value={operation.description} />
              )}
              <StatusRow
                label="Status"
                value={
                  operation.jobStatus === "Paused"
                    ? "Paused"
                    : (operation.operationStatus ?? "—")
                }
              />
              <StatusRow
                label="Duration"
                value={formatDurationMilliseconds(operation.duration ?? 0, {
                  style: "short"
                })}
              />
              <StatusRow
                label="Deadline"
                value={operation.jobDeadlineType ?? "—"}
              />
            </div>
          )}
        </aside>

        {/* ── MAIN: tabbed — details (image + step) · model · chat ── */}
        <main className="flex w-full flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
            <TabButton
              active={tab === "details"}
              onClick={() => setTab("details")}
            >
              Details
            </TabButton>
            {modelPath ? (
              <TabButton
                active={tab === "model"}
                onClick={() => setTab("model")}
              >
                Model
              </TabButton>
            ) : null}
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
              Chat
            </TabButton>
          </div>

          {tab === "model" && modelPath ? (
            <div className="min-h-0 flex-1">
              <ModelPreview
                key={`model-${modelPath}`}
                glbUrl={optimizedModelPreviewUrl(modelPath)}
                rawUrl={`/file/preview/private/${modelPath}`}
                mode={mode}
                className="rounded-none"
              />
            </div>
          ) : tab === "chat" && operation ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <OperationChat
                operation={operation as unknown as OperationWithDetails}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="flex shrink-0 flex-col gap-2 border-b border-border p-4">
                {selected === "playback" &&
                playbackAvailable &&
                assemblyPlayback ? (
                  // Animated instruction playback pinned to the operator's current
                  // step. The player owns orbit/zoom; replay via the step's motion.
                  <div className="relative mx-auto h-[55vh] max-h-[65vh] w-full overflow-hidden rounded-lg border border-border bg-muted/40">
                    <ClientOnly
                      fallback={
                        <div className="flex h-full w-full items-center justify-center">
                          <Spinner className="h-8 w-8" />
                        </div>
                      }
                    >
                      {() => (
                        <AssemblyPlayer
                          glbUrl={getPrivateUrl(assemblyPlayback.glbPath)}
                          graphUrl={getPrivateUrl(assemblyPlayback.graphPath)}
                          steps={viewerSteps}
                          activeStepIndex={playbackIndex ?? 0}
                          playStepNonce={currentStep}
                          autoPlay
                          loop
                          readOnly
                          // Shop floor: the step name/description is shown in the
                          // details panel below, so the in-player caption is redundant.
                          hideCaption
                          mode={mode}
                          className="h-full"
                        />
                      )}
                    </ClientOnly>
                  </div>
                ) : selectedMedia?.kind === "model" ? (
                  // 3D model slide: the interactive viewer replaces the picture. The
                  // viewer has its own orbit/zoom controls, so no fullscreen overlay
                  // button and no annotation pins (pins are image-only).
                  <div className="relative mx-auto h-[55vh] max-h-[65vh] w-full overflow-hidden rounded-lg border border-border bg-muted/40">
                    {selectedModelUrl ? (
                      <ModelPreview
                        key={`slide-model-${selectedModelUrl}`}
                        glbUrl={
                          selectedMedia?.kind === "model"
                            ? selectedMedia.glbUrl
                            : null
                        }
                        rawUrl={
                          selectedMedia?.kind === "model"
                            ? selectedMedia.rawUrl
                            : null
                        }
                        mode={mode}
                        className="h-full w-full rounded-lg"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <LuBox className="size-8" />
                        <span className="text-xs">Model unavailable</span>
                      </div>
                    )}
                  </div>
                ) : mainImage ? (
                  // Both step slides and the finished-item image fill the panel (large by
                  // default). Height follows the image's own aspect ratio (capped at 65vh);
                  // the details column scrolls if it overflows.
                  <div className="relative mx-auto w-full max-w-full overflow-hidden rounded-lg border border-border bg-muted/40">
                    <img
                      src={mainImage}
                      alt="Assembly reference"
                      className="block h-auto max-h-[65vh] w-full object-contain"
                    />
                    {showPins && (
                      <SlidePins
                        key={selected}
                        annotations={selectedAnnotations}
                        toolNameById={toolNameById}
                      />
                    )}
                    {/* Tap the image to open full screen. */}
                    <button
                      type="button"
                      aria-label="View image full screen"
                      onClick={imageViewer.onOpen}
                      className="absolute inset-0"
                    />
                    {/* Operator control: show/hide the annotation pins (always vs tap). */}
                    {selectedAnnotations.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute left-2 top-2 z-10 gap-1.5"
                        leftIcon={
                          showPins ? (
                            <LuEye className="size-4" />
                          ) : (
                            <LuEyeOff className="size-4" />
                          )
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowPins((v) => !v);
                        }}
                      >
                        {showPins ? "Hide pins" : "Show pins"}
                      </Button>
                    )}
                    <span className="pointer-events-none absolute right-2 top-2 z-10 flex items-center justify-center rounded-md bg-background/80 p-1.5 text-muted-foreground shadow-sm">
                      <LuExpand className="size-4" />
                    </span>
                  </div>
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 text-muted-foreground">
                    <LuImage className="size-8" />
                    <span className="text-xs">No reference image</span>
                  </div>
                )}

                {selectedCaption && (
                  <p className="shrink-0 truncate text-center text-xs text-muted-foreground">
                    {selectedCaption}
                  </p>
                )}

                {/* Slots = animated step playback (when synced) · this step's slides.
                    The finished-product image is the fallback when a step has neither. */}
                <div className="flex shrink-0 items-center gap-2">
                  {playbackAvailable && (
                    <button
                      type="button"
                      aria-label="Animated assembly step"
                      title="Animated assembly step"
                      onClick={() => setSelected("playback")}
                      className={cn(
                        "relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-muted/40",
                        selected === "playback"
                          ? "border-foreground"
                          : "border-transparent"
                      )}
                    >
                      <LuPlay className="size-5 text-muted-foreground" />
                      <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-background/80 px-0.5 text-[8px] font-semibold text-muted-foreground">
                        3D
                      </span>
                    </button>
                  )}
                  {stepSlides.map((slide, i) => {
                    const media = slideMedia[i];
                    return (
                      <button
                        key={slide.id}
                        type="button"
                        aria-label={slide.caption || `Slide ${i + 1}`}
                        title={slide.caption ?? undefined}
                        onClick={() => setSelected(i)}
                        className={cn(
                          "relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-muted/40",
                          selected === i
                            ? "border-foreground"
                            : "border-transparent"
                        )}
                      >
                        {media?.thumbnail ? (
                          <img
                            src={media.thumbnail}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <LuBox className="size-5 text-muted-foreground" />
                        )}
                        {media?.kind === "model" && (
                          <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-background/80 px-0.5 text-[8px] font-semibold text-muted-foreground">
                            3D
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Current step */}
              <div className="flex shrink-0 flex-col gap-3 p-6">
                {step ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                        {currentStep + 1}
                      </span>
                      {isStepDone(step) &&
                        (isStepBadResult(step) ? (
                          <Badge variant="red">Out of spec</Badge>
                        ) : (
                          <Badge variant="green">Done</Badge>
                        ))}
                      {step.type ? (
                        <Badge variant="secondary" className="normal-case">
                          {step.type}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-lg font-medium leading-relaxed">
                      {step.name ?? `Step ${currentStep + 1}`}
                    </p>
                    {stepDescriptionHtml ? (
                      <div
                        className="prose prose-sm max-w-none text-sm text-foreground dark:prose-invert"
                        dangerouslySetInnerHTML={{
                          __html: stepDescriptionHtml
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No steps defined for this operation.
                  </p>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ── SIDEBAR: materials, tools, NCRs, parameters ── */}
        <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card lg:w-[280px] lg:overflow-hidden lg:border-l lg:border-t-0 xl:w-[320px]">
          <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            {/* Parts assigned to this step (+ unassigned "General" parts). Each part appears
                once with its part-level quantity/issue status and chips for the step(s) it's
                assigned to; the current step's chip is highlighted. Rendering once keeps the
                requirement from ever being double-counted. */}
            <SidebarSection
              title="Parts"
              scrollable={visibleMaterialsWithState.length > 0}
              action={
                <IconButton
                  aria-label="Issue material"
                  variant="ghost"
                  size="lg"
                  icon={<LuCirclePlus />}
                  onClick={() => {
                    // Clear any per-row selection so the modal opens in
                    // "pick any item" mode → issue a part not on the BOM.
                    setSelectedMaterial(null);
                    issueModal.onOpen();
                  }}
                />
              }
            >
              {visibleMaterialsWithState.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {visibleMaterialsWithState.map(
                    (
                      { m, stepNumbers, issuedIsPerUnit, issuedOverride },
                      i
                    ) => (
                      <MaterialRow
                        key={m.id ?? i}
                        material={m}
                        stepNumbers={stepNumbers}
                        currentStepNumber={currentStep + 1}
                        unitIndex={currentUnitIndex}
                        issuedIsPerUnit={issuedIsPerUnit}
                        issuedOverride={issuedOverride}
                        onIssue={() => {
                          setSelectedMaterial(m);
                          issueModal.onOpen();
                        }}
                      />
                    )
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No materials assigned
                </p>
              )}
            </SidebarSection>

            {stepTools.length > 0 && (
              <SidebarSection title="Tools" scrollable>
                {/* Tools mirror the Parts cards — a bordered row with a leading
                    wrench (in place of the part's issue-status dot), the name +
                    type stacked, and the count/pin badges hard-right. */}
                <div className="flex flex-col gap-1.5">
                  {stepTools.map((t, i) => {
                    // Pin sequence number(s) on the current slide that point at this tool.
                    const seq = t.item?.id
                      ? pinSeqByToolId.get(t.item.id)
                      : undefined;
                    return (
                      <div
                        key={t.item?.id ?? i}
                        className="flex w-full items-start gap-2.5 rounded-lg border border-border bg-accent/30 px-3 py-2.5 text-left"
                      >
                        <LuWrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        {/* Name + readableId stacked; each stays on a single line
                            (mirrors the Parts card's description + item id). */}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium leading-snug text-foreground">
                            {t.item?.name ?? "Unknown tool"}
                          </span>
                          {t.item?.readableId && (
                            <span className="truncate font-mono text-[10px] text-muted-foreground">
                              {t.item.readableId}
                            </span>
                          )}
                        </div>
                        {/* Count hard-right, with any pin-sequence badges tucked
                            beneath it (mirrors the tracking badges on Parts). */}
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            ×{t.quantity}
                          </span>
                          {seq && seq.length > 0 && (
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {seq.map((n) => (
                                <span
                                  key={n}
                                  className="flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background"
                                >
                                  {n}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SidebarSection>
            )}

            {ncrs.length > 0 && (
              <SidebarSection title="Open NCRs">
                {ncrs.map((ncr, i) => {
                  const nc = ncr.nonConformance;
                  const isClosed = nc?.status === "Closed";
                  const readableId =
                    nc?.nonConformanceId ?? ncr.nonConformanceId;
                  return (
                    <div key={readableId ?? i} className="py-1">
                      <Status color={isClosed ? "green" : "red"}>
                        {readableId}
                      </Status>
                    </div>
                  );
                })}
              </SidebarSection>
            )}

            {parameters.length > 0 ? (
              <SidebarSection title="Parameters">
                {parameters.map((p, i) => (
                  <div
                    key={p.id ?? p.key ?? i}
                    className="flex justify-between py-0.5"
                  >
                    <span className="text-xs text-muted-foreground">
                      {p.key}
                    </span>
                    <span className="text-xs font-medium">{p.value}</span>
                  </div>
                ))}
              </SidebarSection>
            ) : null}
          </div>

          {/* ── ACTIONS: Complete Step + Skip ── Tracked parts assigned to this
              step must be scanned before the step can be completed; Skip is always
              available as the escape hatch when the operator can't finish it. */}
          <div className="flex w-full shrink-0 flex-col gap-2 border-t border-border p-3">
            {hasPendingScans && step && !isStepDone(step) && (
              <p className="flex items-center gap-1.5 text-xs text-foreground">
                <LuCircleDot className="size-3.5 shrink-0 text-amber-500" />
                Scan {pendingScanMaterials.length} part
                {pendingScanMaterials.length > 1 ? "s" : ""} to complete this
                step
              </p>
            )}
            <div className="flex w-full items-stretch gap-2">
              {step && (
                <div className="min-w-0 flex-1">
                  <StepCompleteAction
                    step={step}
                    activeIndex={activeIndex}
                    done={isStepDone(step)}
                    disabled={hasPendingScans}
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="lg"
                className="shrink-0"
                rightIcon={<LuSkipForward />}
                isDisabled={isLastStep}
                onClick={() => goToStep(currentStep + 1)}
              >
                Skip
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {issueModal.isOpen && (
        <IssueMaterialModal
          operationId={operationId}
          // Assembly builds one unit at a time: each scan issues one unit's
          // worth (issuePerUnit), so the pick order can never be attributed
          // to the unit on screen — never pre-select tracked entities; the
          // operator scans what goes into THIS unit.
          allowPrefill={false}
          issuePerUnit
          expiredEntityPolicy={expiredEntityPolicy}
          locationId={locationId}
          workCenterId={operation?.workCenterId ?? undefined}
          material={selectedMaterial ?? undefined}
          // Untracked parents have no unit-axis entity, but tracked child
          // consumes still need a genealogy parent — fall back to the make
          // method's seed entity, same as the operation view.
          parentId={currentEntity?.id ?? trackedEntities[0]?.id ?? ""}
          parentIdIsSerialized={requiresSerialTracking}
          // Stamp the current step + 1-based unit onto the consume so issued
          // quantities can be attributed per-unit even for a batch parent (where
          // all units share one lot). See the loader's batch attribution.
          jobOperationStepId={step?.id}
          unitNumber={currentUnitIndex + 1}
          trackedInputs={materials?.trackedInputs ?? []}
          onClose={() => {
            setSelectedMaterial(null);
            issueModal.onClose();
          }}
        />
      )}

      <QualityIssueModal
        operationId={operationId}
        trackedEntityId={isTracked ? currentEntity?.id : undefined}
        isOpen={qualityModal.isOpen}
        onClose={qualityModal.onClose}
      />

      {completeModal.isOpen && operation && (
        <QuantityModal
          type="complete"
          operation={operation as unknown as OperationWithDetails}
          materials={(materials?.materials ?? []) as JobMaterial[]}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded={allStepsRecorded}
          onClose={completeModal.onClose}
        />
      )}

      {scrapModal.isOpen && operation && (
        <QuantityModal
          type="scrap"
          operation={operation as unknown as OperationWithDetails}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          onClose={scrapModal.onClose}
        />
      )}

      {finishModal.isOpen && operation && (
        <QuantityModal
          type="finish"
          operation={operation as unknown as OperationWithDetails}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
          trackedEntityId={currentEntity?.id ?? ""}
          setupProductionEvent={openByType("Setup")}
          laborProductionEvent={openByType("Labor")}
          machineProductionEvent={openByType("Machine")}
          allStepsRecorded={allStepsRecorded}
          onClose={finishModal.onClose}
        />
      )}

      {reworkModal.isOpen && operation && jobId && (
        <ReworkModal
          operation={operation as unknown as OperationWithDetails}
          jobId={jobId}
          isOpen={reworkModal.isOpen}
          onClose={reworkModal.onClose}
          trackedEntities={trackedEntities as never}
          parentIsSerial={requiresSerialTracking}
          parentIsBatch={requiresBatchTracking}
        />
      )}

      {workCenter && (
        <MaintenanceDispatch
          workCenter={workCenter}
          isOpen={maintenanceModal.isOpen}
          onClose={maintenanceModal.onClose}
        />
      )}

      {serialModal.isOpen && (
        <SerialSelectorModal
          availableEntities={unitEntities as never}
          onClose={serialModal.onClose}
          onCancel={serialModal.onClose}
          onSelect={(entity) => {
            navigateEntity(entity);
            serialModal.onClose();
          }}
        />
      )}

      <BottomSheet
        open={actionsSheet.isOpen}
        onOpenChange={(open) => {
          if (!open) actionsSheet.onClose();
        }}
      >
        <BottomSheetContent className="mx-auto max-w-md">
          <BottomSheetBody>
            <div className="flex flex-col gap-2 pb-2">
              <ActionSheetButton
                icon={<LuTrash className="size-4 shrink-0" />}
                label="Scrap"
                onClick={() => {
                  actionsSheet.onClose();
                  scrapModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuGitPullRequest className="size-4 shrink-0" />}
                label="Rework"
                onClick={() => {
                  actionsSheet.onClose();
                  reworkModal.onOpen();
                }}
              />
              <ActionSheetButton
                icon={<LuCheck className="size-4 shrink-0" />}
                label="Finish"
                onClick={() => {
                  actionsSheet.onClose();
                  finishModal.onOpen();
                }}
              />
              {workCenter && !workCenter.isBlocked ? (
                <ActionSheetButton
                  icon={<LuWrench className="size-4 shrink-0" />}
                  label="Maintenance"
                  onClick={() => {
                    actionsSheet.onClose();
                    maintenanceModal.onOpen();
                  }}
                />
              ) : null}
              <ActionSheetButton
                icon={<LuFlag className="size-4 shrink-0" />}
                label="Quality Issue"
                onClick={() => {
                  actionsSheet.onClose();
                  qualityModal.onOpen();
                }}
              />
              {/* Manager-only override: record every remaining step for this unit at once.
                  Shown only to users with the Production DELETE permission, and only when
                  there are unrecorded steps left. */}
              {canOverrideComplete &&
                steps.length > 0 &&
                doneCount < steps.length && (
                  <ActionSheetButton
                    icon={<LuListChecks className="size-4 shrink-0" />}
                    label="Complete all steps"
                    onClick={() => {
                      actionsSheet.onClose();
                      completeAllModal.onOpen();
                    }}
                  />
                )}
            </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>

      {completeAllModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) completeAllModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Complete all steps?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                This records the{" "}
                <span className="font-semibold text-foreground">
                  {steps.length - doneCount}
                </span>{" "}
                remaining step(s) as complete for{" "}
                <span className="font-semibold text-foreground">
                  Unit {currentUnitIndex + 1}
                </span>{" "}
                without capturing their values. This is a manager override; each
                step can still be undone individually.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={completeAllModal.onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                isLoading={completeAllFetcher.state !== "idle"}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("operationId", operationId);
                  fd.append("index", String(activeIndex));
                  completeAllFetcher.submit(fd, {
                    method: "post",
                    action: path.to.completeAllSteps
                  });
                  completeAllModal.onClose();
                }}
              >
                Complete all
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <ImageZoomViewer
        open={imageViewer.isOpen}
        src={mainImage}
        caption={selectedCaption}
        annotations={selectedAnnotations}
        toolNameById={toolNameById}
        onClose={imageViewer.onClose}
      />

      {/* Only auto-start when the operation actually has a timer to track (a configured
          Setup/Labor/Machine duration). With no work types there's nothing to time, so we
          don't start a stray Labor event. */}
      {operation && autoStartOperationTimer && workTypes.length > 0 && (
        <AutoTimer
          operationId={operationId}
          enabled={autoStartOperationTimer}
          workType={headerWorkTypes[0]}
          workCenterId={operation.workCenterId ?? undefined}
          openEvent={openEventForWorkType(headerWorkTypes[0])}
          trackedEntityId={isTracked ? currentEntity?.id : undefined}
          unitIndex={currentUnitIndex}
        />
      )}
    </div>
  );
}

// Passive operation timer (opt-in). Auto-starts the operator's production event when the
// assembly view opens (so it isn't forgotten). It never auto-ends ("clocks out") a timer —
// stopping is always a manual action via the header pause button. Drives off the loader's
// `openEvent`, which the assembly realtime channel keeps fresh after each Start.
function AutoTimer({
  operationId,
  enabled,
  workType,
  workCenterId,
  openEvent,
  trackedEntityId,
  unitIndex
}: {
  operationId: string;
  enabled: boolean;
  workType: "Setup" | "Labor" | "Machine";
  workCenterId?: string;
  openEvent: { id: string; startTime: string } | null;
  trackedEntityId?: string;
  unitIndex?: number;
}) {
  const fetcher = useFetcher();
  const startedRef = useRef(false);

  const busy = fetcher.state !== "idle";
  const running = !!openEvent;

  // Auto-start once when the view opens and nothing is running yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on open
  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    if (running || busy) return;
    const fd = new FormData();
    fd.set("jobOperationId", operationId);
    fd.set("timezone", getLocalTimeZone());
    fd.set("type", workType);
    fd.set("action", "Start");
    fd.set("exclusive", "true");
    if (workCenterId) fd.set("workCenterId", workCenterId);
    if (trackedEntityId) fd.set("trackedEntityId", trackedEntityId);
    if (typeof unitIndex === "number") fd.set("unitIndex", String(unitIndex));
    fetcher.submit(fd, { method: "post", action: path.to.productionEvent });
  }, [enabled]);

  return null;
}

function ActionSheetButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 transition-transform active:scale-[0.98]"
      onClick={onClick}
    >
      {icon}
      <span className="text-base/6 font-medium">{label}</span>
    </button>
  );
}

function TimerControl({
  operation,
  openEvent,
  workType,
  trackedEntityId,
  unitIndex
}: {
  operation: Operation;
  openEvent: { id: string; startTime: string } | null;
  workType: "Setup" | "Labor" | "Machine";
  trackedEntityId?: string;
  unitIndex?: number;
}) {
  const fetcher = useFetcher();

  // Optimistic state: the moment Start/End is submitted, flip immediately
  // instead of waiting for the (slow) post-production-event round-trip. This
  // stops the clock the instant you press pause — no lingering "spinning"
  // while the timer keeps climbing.
  const pendingAction = fetcher.formData?.get("action");
  const active =
    pendingAction === "Start"
      ? true
      : pendingAction === "End"
        ? false
        : !!openEvent;

  // Freeze the clock while a stop is in flight; otherwise tick live.
  const liveElapsed = useElapsed(pendingAction === "End" ? null : openEvent);
  const elapsed = pendingAction === "End" ? 0 : liveElapsed;

  return (
    // The entire time display is the start/stop trigger — a big, obvious tap
    // target on the shop floor beats a small icon button.
    <fetcher.Form
      method="post"
      action={path.to.productionEvent}
      className="h-full shrink-0"
    >
      <input type="hidden" name="jobOperationId" value={operation.id} />
      <input type="hidden" name="timezone" value={getLocalTimeZone()} />
      <input type="hidden" name="type" value={workType} />
      {/* Single-phase clocking: starting this type ends any other open type. */}
      <input type="hidden" name="exclusive" value="true" />
      <input type="hidden" name="action" value={openEvent ? "End" : "Start"} />
      {operation.workCenterId ? (
        <input
          type="hidden"
          name="workCenterId"
          value={operation.workCenterId}
        />
      ) : null}
      {openEvent ? (
        <input type="hidden" name="id" value={openEvent.id} />
      ) : null}
      {trackedEntityId ? (
        <input type="hidden" name="trackedEntityId" value={trackedEntityId} />
      ) : null}
      {typeof unitIndex === "number" ? (
        <input type="hidden" name="unitIndex" value={unitIndex} />
      ) : null}
      <button
        type="submit"
        aria-label={active ? "Pause timer" : "Start timer"}
        className="flex h-full shrink-0 items-center gap-1 border-l border-border px-2 transition-colors hover:bg-accent active:scale-[0.98] md:gap-2 md:px-4"
      >
        <span className="hidden flex-col items-end leading-none sm:flex">
          <span className="text-sm font-medium tabular-nums">
            {formatElapsed(elapsed)}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {workType}
          </span>
        </span>
        {active ? (
          <LuPause className="size-4" />
        ) : (
          <LuPlay className="size-4" />
        )}
      </button>
    </fetcher.Form>
  );
}

function SidebarSection({
  title,
  children,
  scrollable,
  action
}: {
  title: string;
  children: React.ReactNode;
  scrollable?: boolean;
  // Optional right-aligned control in the section header (e.g. an "add" button).
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col",
        // On mobile every section flows at its natural height (the page
        // scrolls). On lg+ scrollable sections share the panel and scroll
        // internally.
        scrollable ? "lg:min-h-0 lg:flex-1" : "shrink-0"
      )}
    >
      <Separator />
      <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-1 pt-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      <div
        className={cn(
          "px-3.5 pb-2.5",
          scrollable && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        )}
      >
        {children}
      </div>
    </div>
  );
}

// Per-unit issue state for a material. Assembly builds unit-by-unit, so the
// requirement is ALWAYS the per-unit BOM quantity (`quantity`), never the job
// total. Serial parents already report per-unit consumption for tracked parts;
// batch/untracked parents report a job-wide total, so we derive this unit's share
// by assuming prior units each consumed their per-unit quantity. `issuedOverride`
// short-circuits both (loose parts backflushed on the unit's first step record).
// Shared by MaterialRow and the step's scan gate so they never diverge.
function getIssuedForUnit(
  material: any,
  {
    unitIndex,
    issuedIsPerUnit,
    issuedOverride
  }: {
    unitIndex: number;
    issuedIsPerUnit: boolean;
    issuedOverride?: number;
  }
) {
  const required = material.quantity ?? material.estimatedQuantity ?? 0;
  const totalIssued = material.quantityIssued ?? 0;
  const issued =
    issuedOverride !== undefined
      ? issuedOverride
      : issuedIsPerUnit
        ? totalIssued
        : // An unplanned/extra part has no per-unit requirement (required 0), so the
          // per-unit derivation would clamp it to 0 — surface the raw issued total
          // instead. Planned parts derive this unit's share from the job-wide total.
          required === 0
          ? totalIssued
          : Math.min(required, Math.max(0, totalIssued - unitIndex * required));
  const fullyIssued = required > 0 && issued >= required;
  return { required, issued, fullyIssued };
}

function MaterialRow({
  material,
  onIssue,
  stepNumbers = [],
  currentStepNumber,
  unitIndex = 0,
  issuedIsPerUnit = false,
  issuedOverride
}: {
  material: any;
  onIssue?: () => void;
  // 1-based step numbers where this part is used ("where used"); empty = General.
  stepNumbers?: number[];
  currentStepNumber?: number;
  // 0-based unit currently being built; attributes job-total issued
  // quantities to the unit on screen.
  unitIndex?: number;
  // True when material.quantityIssued is already scoped to the current unit
  // (serial parent + tracked material — the service recomputes it from the
  // parent entity's consumed inputs). Otherwise it's a job-wide total.
  issuedIsPerUnit?: boolean;
  // When set, use this as the unit's issued quantity instead of deriving it —
  // loose (untracked, step-unassigned) parts are backflushed when the unit's
  // first step is recorded, so their status mirrors that trigger directly.
  issuedOverride?: number;
}) {
  const isTracked =
    material.requiresSerialTracking || material.requiresBatchTracking;
  const { required, issued, fullyIssued } = getIssuedForUnit(material, {
    unitIndex,
    issuedIsPerUnit,
    issuedOverride
  });
  // An unplanned/extra part (issued from the shop floor, not on the BOM) has no
  // required quantity. Once any quantity is issued it's "done" — there's nothing
  // outstanding — so it reads as issued rather than perpetually "partial".
  const isExtra = required === 0;
  const extraIssued = isExtra && issued > 0;
  const partiallyIssued = !isExtra && issued > 0 && !fullyIssued;

  // Leading status dot: issued (green check) · partially issued (amber) · not issued (hollow).
  const issueStatus =
    fullyIssued || extraIssued
      ? { icon: LuCircleCheck, className: "text-emerald-500", label: "Issued" }
      : partiallyIssued
        ? {
            icon: LuCircleDot,
            className: "text-amber-500",
            label: "Partially issued"
          }
        : {
            icon: LuCircle,
            className: "text-muted-foreground/50",
            label: "Not issued"
          };
  const StatusIcon = issueStatus.icon;

  const usedHere =
    currentStepNumber != null && stepNumbers.includes(currentStepNumber);

  // The whole card is the action: clicking it opens the scan/issue flow. Tracked
  // parts stay clickable even once issued, so with several serialized parts each
  // one can be (re)scanned straight from its own card instead of the single
  // bottom Scan button. Non-tracked parts drop the affordance once fully issued
  // (nothing left to add).
  const interactive = !!onIssue && (isTracked || !fullyIssued);
  const Wrapper = interactive ? "button" : "div";

  return (
    <Wrapper
      {...(interactive
        ? {
            type: "button" as const,
            onClick: onIssue,
            "aria-label": isTracked ? "Scan material" : "Issue material"
          }
        : {})}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border border-border bg-accent/30 px-3 py-2.5 text-left transition-colors",
        interactive && "cursor-pointer hover:bg-accent/60 active:scale-[0.99]",
        usedHere && "ring-1 ring-inset ring-foreground/20"
      )}
    >
      <StatusIcon
        aria-label={issueStatus.label}
        className={cn("mt-0.5 size-3.5 shrink-0", issueStatus.className)}
      />
      {/* Name + id stacked; each stays on a single line and truncates if long. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium leading-snug text-foreground">
          {material.description}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {material.itemReadableId}
        </span>
      </div>
      {/* Count hard-right, with the tracking badges tucked beneath it. */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {fullyIssued || extraIssued ? (
          <span className="flex items-center gap-1 text-[11px] font-medium tabular-nums text-emerald-500">
            {issued}/{required}
            <LuCheck className="size-3" />
          </span>
        ) : partiallyIssued ? (
          <span className="text-[11px] tabular-nums text-amber-500">
            {issued}/{required}
          </span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            ×{required}
          </span>
        )}
        {/* Distinguish an unplanned part (issued from the floor, not on the BOM). */}
        {isExtra && <Badge variant="outline">Added</Badge>}
        {isTracked && (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {material.requiresSerialTracking && (
              <Badge variant="secondary">
                <TrackingTypeIcon type="Serial" className="shrink-0" />
              </Badge>
            )}
            {material.requiresBatchTracking && (
              <Badge variant="secondary">
                <TrackingTypeIcon type="Batch" className="shrink-0" />
              </Badge>
            )}
            {!fullyIssued && <Badge variant="orange">Requires Scan</Badge>}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

// ── Per-step completion action ──────────────────────────────────────────────

function StepCompleteAction({
  step,
  activeIndex,
  done,
  disabled = false
}: {
  step: Step;
  activeIndex: number;
  done: boolean;
  // Soft gate: the step's tracked parts aren't fully issued for this unit, so
  // block completion (Mark done / Record) until they're scanned. Skip bypasses.
  disabled?: boolean;
}) {
  const fetcher = useFetcher();
  const user = useUser();
  const busy = fetcher.state !== "idle";
  const recordModal = useDisclosure();

  // Find the existing record for this unit (if done)
  const record = (step.jobOperationStepRecord ?? []).find(
    (r) => r.index === activeIndex
  );
  // A record can only be undone by whoever created it (the delete RPC filters
  // by createdBy) — mirror the operation view and disable undo otherwise.
  const canUndo = !!record && record.createdBy === user.id;

  const type = step.type ?? "Task";

  // Undo: delete the record so step can be re-done
  function handleUndo() {
    if (!record) return;
    fetcher.submit(null, {
      method: "post",
      action: path.to.recordDelete(record.id)
    });
  }

  // Quick-complete a Task step (no captured value — matches the operation view).
  function markTaskDone() {
    const fd = new FormData();
    fd.append("jobOperationStepId", step.id);
    fd.append("index", String(activeIndex));
    fd.append("booleanValue", "true");
    fetcher.submit(fd, { method: "post", action: path.to.record });
  }

  // ── Already done: show recorded value + Undo button ──
  if (done && record) {
    let recordedDisplay: string | null = null;
    if (record.numericValue != null)
      recordedDisplay = `${record.numericValue}${step.unitOfMeasureCode ? ` ${step.unitOfMeasureCode}` : ""}`;
    else if (record.booleanValue != null)
      recordedDisplay = record.booleanValue ? "Yes" : "No";
    else if (record.value) recordedDisplay = record.value;
    else if (record.userValue) recordedDisplay = record.userValue;

    // File steps store a long storage path — show just the file name; the full
    // path stays available in the truncation tooltip.
    const displayText =
      type === "File" && recordedDisplay
        ? recordedDisplay.split("/").pop() || recordedDisplay
        : recordedDisplay;

    return (
      <div className="flex h-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
        <LuCheck className="size-4 shrink-0 text-emerald-500" />
        {displayText ? (
          <TruncatedTooltipText
            tooltip={recordedDisplay}
            className="min-w-0 flex-1 truncate text-sm text-emerald-600 dark:text-emerald-400"
          >
            Recorded: {displayText}
          </TruncatedTooltipText>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-emerald-600 dark:text-emerald-400">
            Completed
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          isIcon
          aria-label="Undo"
          isLoading={busy}
          isDisabled={!canUndo}
          title={
            canUndo ? "Undo" : "Only the operator who recorded this can undo it"
          }
          onClick={handleUndo}
        >
          <LuUndo2 className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  // ── Not done ──
  // Task → quick "Mark done" submit. Every other type (Value, Measurement,
  // Checkbox, List, Person, Timestamp, File, Inspection) opens the shared
  // RecordModal — same component the operation view uses (incl. file upload).
  if (type === "Task") {
    return (
      <Button
        variant="primary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={busy}
        isDisabled={disabled}
        className="w-full"
        onClick={markTaskDone}
      >
        Mark done
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        leftIcon={<LuCheck />}
        isDisabled={disabled}
        className="w-full"
        onClick={recordModal.onOpen}
      >
        Record
      </Button>
      {recordModal.isOpen && (
        <RecordModal
          attribute={step as unknown as JobOperationStep}
          activeStep={activeIndex}
          onClose={recordModal.onClose}
        />
      )}
    </>
  );
}

// Units section for the left sidebar — its own labeled section (like Time), sitting
// directly below the timers. A compact prev/next pager sits top-right by the label,
// and the full, scrollable list of EVERY unit gives full visibility. A serial parent
// binds a distinct entity per unit, so it lists those by readableId; a batch parent
// binds a single lot to unit 0 (the rest are null), so listing that one id is more
// noise than signal — batch and untracked parents both list "Unit 1 / Unit 2 / …".
// The list auto-scrolls to keep the current unit in view; units with an out-of-spec
// measurement (or a failed inspection) are flagged red, fully-recorded units green.
function UnitNavigator({
  units,
  currentUnitIndex,
  maxNavigableIndex,
  isTracked,
  labelByEntity,
  trackingLabel,
  headerAction,
  unitHasBadResult,
  unitIsRecorded,
  onSelectUnit
}: {
  units: {
    index: number;
    entity: { id: string; readableId?: string | null } | null;
  }[];
  currentUnitIndex: number;
  // Highest unit index the operator may open. For a serial parent this is the last
  // unit whose serial has been minted; beyond it the unit has no entity and can't
  // be worked on, so its row is disabled.
  maxNavigableIndex: number;
  isTracked: boolean;
  labelByEntity: boolean;
  trackingLabel: string;
  // Optional control in the section header, left of the pager (e.g. print label).
  headerAction?: React.ReactNode;
  unitHasBadResult: (index: number) => boolean;
  unitIsRecorded: (index: number) => boolean;
  onSelectUnit: (index: number) => void;
}) {
  const isEntityLabel = (u: (typeof units)[number]) =>
    labelByEntity && !!u.entity;
  const isNavigable = (u: (typeof units)[number]) =>
    u.index <= maxNavigableIndex;
  const labelFor = (u: (typeof units)[number]) =>
    labelByEntity && u.entity
      ? (u.entity.readableId ?? u.entity.id.slice(0, 8))
      : `Unit ${u.index + 1}`;

  // Keep the selected unit visible as the operator pages/jumps between units.
  // currentUnitIndex is a real dep: the ref points at a different row after it
  // changes, so re-run the scroll even though the body only reads the ref.
  const currentRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on unit change
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentUnitIndex]);

  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      {/* Section header: label + compact pager grouped top-right. */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isTracked ? trackingLabel : "Units"}
        </p>
        <div className="flex items-center gap-0.5">
          {headerAction}
          <IconButton
            aria-label="Previous unit"
            variant="ghost"
            size="lg"
            icon={<LuChevronLeft />}
            isDisabled={currentUnitIndex <= 0}
            onClick={() => onSelectUnit(currentUnitIndex - 1)}
          />
          <IconButton
            aria-label="Next unit"
            variant="ghost"
            size="lg"
            icon={<LuChevronRight />}
            isDisabled={currentUnitIndex >= maxNavigableIndex}
            onClick={() => onSelectUnit(currentUnitIndex + 1)}
          />
        </div>
      </div>

      {/* Full, scrollable, full-bleed list — bounded so it never crowds out the
          rest of the sidebar. No inner box/rounding; the section border divides it
          from the next section like every other card section. */}
      <div className="max-h-48 overflow-y-auto pb-2">
        {units.map((u) => {
          const isCurrent = u.index === currentUnitIndex;
          const bad = unitHasBadResult(u.index);
          const recorded = unitIsRecorded(u.index);
          // A serial unit with no minted serial yet can't be opened (nothing to
          // scan or complete against). Show it as a disabled placeholder.
          const navigable = isNavigable(u);
          return (
            <button
              key={u.index}
              type="button"
              ref={isCurrent ? currentRef : undefined}
              aria-pressed={isCurrent}
              disabled={!navigable}
              title={navigable ? undefined : "Not started yet"}
              onClick={() => onSelectUnit(u.index)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                isCurrent
                  ? "bg-accent font-semibold text-foreground"
                  : navigable
                    ? "text-muted-foreground hover:bg-muted/60"
                    : "cursor-not-allowed text-muted-foreground/40",
                bad && "text-red-500"
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  bad
                    ? "bg-red-500"
                    : recorded
                      ? "bg-emerald-500"
                      : "bg-transparent"
                )}
              />
              <span className={cn("truncate", isEntityLabel(u) && "font-mono")}>
                {labelFor(u)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact tab button for the main panel (Details / Model / Chat).
function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// Label · value row for the left-panel Status section.
function StatusRow({
  label,
  value,
  mono
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-xs font-medium text-foreground",
          mono && "font-mono"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Cumulative production event timer ───────────────────────────────────────

function useCumulativeProgress(events: ProductionEvent[]) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const hasOpen = events.some((e) => !e.endTime);
    if (!hasOpen) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [events]);

  const totals = { setup: 0, labor: 0, machine: 0 };
  const now = Date.now();

  for (const ev of events) {
    const rawKey = (ev.type ?? "labor").toLowerCase();
    const key = rawKey as keyof typeof totals;
    if (!(key in totals)) continue;
    if (ev.endTime) {
      // Completed event — use stored duration (ms) if present, else calculate
      totals[key] +=
        ev.duration != null
          ? ev.duration * 1000
          : new Date(ev.endTime).getTime() - new Date(ev.startTime).getTime();
    } else {
      // Open event — live elapsed
      totals[key] += Math.max(0, now - new Date(ev.startTime).getTime());
    }
  }

  return totals;
}

// The Setup/Labor/Machine timer rows. Isolated into its own component so the
// per-second `useCumulativeProgress` tick re-renders ONLY these rows — not the
// entire AssemblyView. A whole-view re-render every second was resetting an open
// RecordModal's react-aria number input back to its default while the operator
// was mid-edit (the "measurement keeps going to 0" bug).
function TimeRows({
  events,
  setupDuration,
  laborDuration,
  machineDuration
}: {
  events: ProductionEvent[];
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
}) {
  const progress = useCumulativeProgress(events);
  // A work type is "running" when it has an open (un-ended) event. Control lives
  // in the header clock buttons now; these rows are a live read-out.
  const isRunning = (type: "Setup" | "Labor" | "Machine") =>
    events.some((e) => e.type === type && !e.endTime);
  return (
    <>
      {setupDuration > 0 && (
        <TimerRow
          icon={<LuTimer className="size-3" />}
          label="Setup"
          elapsed={progress.setup}
          total={setupDuration}
          running={isRunning("Setup")}
        />
      )}
      {laborDuration > 0 && (
        <TimerRow
          icon={<LuHardHat className="size-3" />}
          label="Labor"
          elapsed={progress.labor}
          total={laborDuration}
          running={isRunning("Labor")}
        />
      )}
      {machineDuration > 0 && (
        <TimerRow
          icon={<LuHammer className="size-3" />}
          label="Machine"
          elapsed={progress.machine}
          total={machineDuration}
          running={isRunning("Machine")}
        />
      )}
    </>
  );
}

// Single timer row: running dot · icon · "3s / 6m" · progress bar
function TimerRow({
  icon,
  label,
  elapsed,
  total,
  running
}: {
  icon: React.ReactNode;
  label: string;
  elapsed: number;
  total: number;
  running?: boolean;
}) {
  const overrun = total > 0 && elapsed > total;

  return (
    <div className="flex w-full flex-col gap-1 px-1.5 py-1 text-left">
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex items-center gap-1 text-[10px]",
            running ? "font-semibold text-foreground" : "text-muted-foreground"
          )}
        >
          {/* running indicator dot */}
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              running ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
          {icon}
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums",
            overrun ? "text-red-500" : "text-muted-foreground"
          )}
        >
          {formatDurationMilliseconds(elapsed, { style: "short" })}
          {total > 0 && (
            <>/{formatDurationMilliseconds(total, { style: "short" })}</>
          )}
        </span>
      </div>
      <BarProgress
        max={total || 1}
        progress={total > 0 ? elapsed : 0}
        activeClassName={overrun ? "bg-red-500" : "bg-emerald-500"}
      />
    </div>
  );
}
