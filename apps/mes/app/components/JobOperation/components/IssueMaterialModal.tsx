import { useCarbon } from "@carbon/auth";
import { Number as FormNumberInput, Hidden, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Combobox as ComboboxBase,
  cn,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast
} from "@carbon/react";
import { formatDate, getItemReadableId, SCALE_FORMAT } from "@carbon/utils";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuList,
  LuQrCode,
  LuTrash2,
  LuUndo2,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem,
  SuggestedAllocationLot
} from "~/services/inventory.service";
import { issueValidator } from "~/services/models";
import type { JobMaterial, TrackedInput } from "~/services/types";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { ScrapEntityModal } from "./ScrapEntityModal";
import type { ScrappableEntity } from "./ScrapTab";
import { ScrapTab } from "./ScrapTab";

type TrackingType = "Serial" | "Batch" | "Inventory" | "Non-Inventory" | null;

interface ItemDetails {
  id: string;
  name: string;
  unitOfMeasureCode: string;
  itemTrackingType: TrackingType;
}

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export function IssueMaterialModal({
  operationId,
  allowPrefill = false,
  parentUnitCount,
  issuePerUnit = false,
  expiredEntityPolicy = "Block",
  autoSelectMaterialWithoutPickingList = false,
  locationId,
  workCenterId,
  material,
  parentId,
  parentIdIsSerialized,
  jobOperationStepId,
  unitNumber,
  trackedInputs = [],
  onClose
}: {
  operationId: string;
  // Opt-in from the call site to pre-select tracked entities from the picking
  // list. The process view passes true; the assembly view issues one unit at
  // a time and never opts in. Even when true, the modal only seeds when the
  // whole pick provably belongs to the parent entity being issued to: a
  // picking list exists AND (the parent is not serialized — one entity spans
  // the whole quantity — or the operation makes exactly one unit, so there is
  // exactly one parent serial). See canPrefill below.
  allowPrefill?: boolean;
  // How many units the operation makes (parent tracked entities for a serial
  // parent). Required for prefill when the parent is serialized — without it
  // a serialized parent never prefills.
  parentUnitCount?: number;
  // Issue one unit's worth per submission (the assembly view's build-one-at-
  // a-time flow) instead of defaulting to the whole remaining quantity.
  // Serial parents always behave this way regardless of this flag.
  issuePerUnit?: boolean;
  expiredEntityPolicy?: ExpiredEntityPolicy;
  autoSelectMaterialWithoutPickingList?: boolean;
  locationId?: string;
  workCenterId?: string;
  material?: JobMaterial;
  parentId?: string;
  parentIdIsSerialized?: boolean;
  // Assembly view only: the step + 1-based unit the operator is on, stamped onto the
  // consume so issued quantities can be attributed per-unit/per-step even for a batch
  // parent (where all units share one lot entity). Omitted by the operation view.
  jobOperationStepId?: string;
  unitNumber?: number;
  trackedInputs?: TrackedInput[];
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const { t } = useLingui();
  const [items] = useItems();
  const numberFormatter = useNumberFormatter(SCALE_FORMAT);

  // Item selection state
  const [selectedItemId, setSelectedItemId] = useState<string>(
    material?.itemId ?? ""
  );
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [isLoadingItem, setIsLoadingItem] = useState(false);

  // Determine tracking type from material or item details
  const trackingType: TrackingType = useMemo(() => {
    if (material) {
      if (material.requiresSerialTracking) return "Serial";
      if (material.requiresBatchTracking) return "Batch";
      return "Inventory";
    }
    return itemDetails?.itemTrackingType ?? null;
  }, [material, itemDetails]);

  // Item options for the combobox
  const itemOptions = useMemo(() => {
    return items.map((item) => ({
      label: item.readableIdWithRevision,
      helper: item.name,
      value: item.id
    }));
  }, [items]);

  // Serial number state and options
  const { data: serialNumbers } = useSerialNumbers(
    trackingType === "Serial" ? selectedItemId : undefined
  );
  // Today in the local timezone — used for "is this entity expired"
  // comparisons throughout the modal. Memoized so we re-derive option
  // lists once a day rather than every render.
  const todayLocal = useMemo(() => today(getLocalTimeZone()), []);

  const isExpiryPast = useCallback(
    (date: string | null | undefined) => {
      if (!date) return false;
      try {
        return parseDate(date).compare(todayLocal) < 0;
      } catch {
        return false;
      }
    },
    [todayLocal]
  );

  // Format an expiration date as `MMM d, yyyy` for the option helper text.
  const formatExpiry = useCallback((date: string | null | undefined) => {
    if (!date) return "";
    return formatDate(date, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }, []);

  const serialOptions = useMemo(() => {
    return (
      serialNumbers?.data
        ?.filter((sn) =>
          // When policy = Block, expired stock is not a valid choice — drop
          // it from the picker entirely so operators can't even pick it.
          // Warn / BlockWithOverride keep it visible (overridable downstream).
          expiredEntityPolicy === "Block"
            ? !isExpiryPast(sn.expirationDate)
            : true
        )
        .map((sn) => {
          const expired = isExpiryPast(sn.expirationDate);
          const label = (
            <span key={sn.id} className="flex items-center gap-2">
              {sn.readableId && (
                <span className="font-medium">{sn.readableId}</span>
              )}
              <span className="text-xs text-muted-foreground font-mono truncate">
                {sn.id}
              </span>
              {expired && <Badge variant="red">Expired</Badge>}
            </span>
          );
          const helper = sn.expirationDate
            ? `${expired ? "Expired" : "Expires"} ${formatExpiry(sn.expirationDate)}`
            : undefined;
          return {
            label,
            value: sn.id,
            helper,
            expirationDate: sn.expirationDate ?? null,
            isExpired: expired
          };
        }) ?? []
    );
  }, [serialNumbers, isExpiryPast, formatExpiry, expiredEntityPolicy]);

  // Batch number state and options
  const { data: batchNumbers } = useBatchNumbers(
    trackingType === "Batch" ? selectedItemId : undefined
  );
  const batchOptions = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((bn) => bn.status === "Available")
        .filter((bn) =>
          expiredEntityPolicy === "Block"
            ? !isExpiryPast(bn.expirationDate)
            : true
        )
        .map((bn) => {
          const expired = isExpiryPast(bn.expirationDate);
          const label = (
            <span key={bn.id} className="flex items-center gap-2">
              {bn.readableId && (
                <span className="font-medium">{bn.readableId}</span>
              )}
              <span className="text-xs text-muted-foreground font-mono truncate">
                {bn.id.slice(0, 10)}
              </span>
              <span className="text-xs text-muted-foreground">
                {bn.quantity} available
              </span>
              {expired && <Badge variant="red">Expired</Badge>}
            </span>
          );
          const helper = bn.expirationDate
            ? `${expired ? "Expired" : "Expires"} ${formatExpiry(bn.expirationDate)}`
            : undefined;
          return {
            label,
            value: bn.id,
            helper,
            availableQuantity: bn.quantity,
            expirationDate: bn.expirationDate ?? null,
            isExpired: expired
          };
        }) ?? []
    );
  }, [batchNumbers, isExpiryPast, formatExpiry, expiredEntityPolicy]);

  // Unconsume options for batch
  const unconsumeOptions = useMemo(() => {
    return trackedInputs.map((input) => ({
      label: (
        <span className="flex items-center gap-2">
          {input.readableId && (
            <span className="font-medium">{input.readableId}</span>
          )}
          <span className="text-xs text-muted-foreground font-mono truncate">
            {input.id.slice(0, 10)}
          </span>
          <span className="text-xs text-muted-foreground">
            qty {input.quantity}
          </span>
        </span>
      ),
      value: input.id
    }));
  }, [trackedInputs]);

  // Scrappable entities for this material: available (picked / in stock,
  // pulled from the item's available serials) + already-consumed (trackedInputs).
  const scrappableEntities = useMemo<ScrappableEntity[]>(() => {
    const consumed: ScrappableEntity[] = trackedInputs.map((input) => ({
      id: input.id,
      readableId: input.readableId,
      state: "Consumed" as const
    }));
    const consumedIds = new Set(consumed.map((e) => e.id));
    const availableSource =
      trackingType === "Batch"
        ? (batchNumbers?.data ?? [])
        : (serialNumbers?.data ?? []);
    const available: ScrappableEntity[] = availableSource
      // Batch numbers are not pre-filtered by status at the query, so guard here
      // (serial numbers already come back Available-only) — Reserved/On Hold/
      // Scrapped entities must never appear as scrap-from-stock targets.
      .filter((s) => s.status === "Available")
      .filter((s) => !consumedIds.has(s.id))
      .map((s) => ({
        id: s.id,
        readableId: s.readableId,
        state: "Available" as const
      }));
    return [...available, ...consumed];
  }, [trackedInputs, trackingType, serialNumbers?.data, batchNumbers?.data]);

  // Default issue quantity. Serial parents always issue per-unit
  // (material.quantity is the per-unit requirement and quantityIssued is
  // scoped to the parent entity). The assembly view issues per-unit for
  // EVERY parent type (issuePerUnit) — a 10-unit build consumes its parts
  // one unit at a time, never the whole remaining total in one shot.
  // Otherwise (process view, non-serial parent) default to the remaining
  // total for the operation.
  const initialQuantity = useMemo(() => {
    if (!material) return 1;
    const perUnit = material.quantity ?? material.estimatedQuantity ?? 1;
    if (parentIdIsSerialized) {
      return Math.max(1, perUnit - (material.quantityIssued ?? 0));
    }
    if (issuePerUnit) {
      return Math.max(1, perUnit);
    }
    const total = material.estimatedQuantity ?? material.quantity ?? 1;
    return Math.max(1, total - (material.quantityIssued ?? 0));
  }, [material, parentIdIsSerialized, issuePerUnit]);

  // Serial numbers selection state
  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{ index: number; id: string }>
  >(
    // A batch material's quantity can be fractional (4.5 plate x 3 units), and
    // Array() throws "Invalid array length" on a non-integer.
    Array(Math.max(1, Math.ceil(initialQuantity)))
      .fill("")
      .map((_, index) => ({ index, id: "" }))
  );
  const [serialErrors, setSerialErrors] = useState<Record<number, string>>({});
  const [scrapEntityTarget, setScrapEntityTarget] = useState<{
    id: string;
    readableId?: string | null;
  } | null>(null);
  const [selectedTrackedInputs, setSelectedTrackedInputs] = useState<string[]>(
    []
  );

  // Batch numbers selection state
  const [selectedBatchNumbers, setSelectedBatchNumbers] = useState<
    Array<{ index: number; id: string; quantity: number }>
  >([{ index: 0, id: "", quantity: initialQuantity }]);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});
  const [unconsumedBatches, setUnconsumedBatches] = useState<
    Array<{ index: number; id: string }>
  >([{ index: 0, id: "" }]);

  // Tab state
  const [activeTab, setActiveTab] = useState("scan");

  // Pre-fill the selection with the picking list's recommendation (a default
  // only — fully editable below). Pre-selecting tracked entities is a
  // traceability hazard: a wrong default an operator blindly accepts records
  // the wrong genealogy. Every issue submission binds ALL children to ONE
  // parent tracked entity, so seeding is only trustworthy when the whole
  // pick provably belongs to that parent. That requires ALL of:
  //   - the call site opted in (`allowPrefill` — the process view; the
  //     assembly view issues one unit at a time so the pick can never be
  //     attributed to the unit on screen),
  //   - the material is actually on a picking list, and
  //   - the parent is a single entity: not serialized (one batch/lot spans
  //     the whole quantity) OR the operation makes exactly one unit (one
  //     parent serial).
  // Otherwise the modal opens on the Scan tab with nothing selected.
  // When seeding is allowed, two sources feed it, in priority order:
  //   1. the exact lots a picking list already PICKED for this material
  //      (`pickedAllocation`, from pickingListLineTrackedEntity), and
  //   2. the on-the-fly pickMethod suggestion of what to pick
  //      (`suggestedAllocation`, netted + FEFO/FIFO sorted).
  // A material can be on a picking list (quantityToPick > 0) with nothing picked
  // yet — e.g. a multi-line list where other lines were picked first. In that
  // state `pickedAllocation` is empty, so we must still surface the suggestion
  // rather than leaving the operator with the default first lot. Hence the
  // suggestion is ALWAYS loaded, not gated off whenever a picking allocation
  // merely exists. Whether the suggestion actually SEEDS the rows when there is
  // no picking list is gated by `autoSelectMaterialWithoutPickingList` (see
  // `seedAllocation` below).
  const pickedOverlay = material as
    | { quantityToPick?: number | null; quantityPicked?: number | null }
    | undefined;
  const hasPickingAllocation =
    Number(pickedOverlay?.quantityToPick ?? 0) > 0 ||
    Number(pickedOverlay?.quantityPicked ?? 0) > 0;
  // The genealogy safety gate: a seed is only trustworthy when the whole pick
  // provably belongs to ONE parent — the call site opted in (`allowPrefill`) and
  // the parent is a single entity (not a serialized multi-unit operation).
  const parentSafe =
    allowPrefill && (!parentIdIsSerialized || parentUnitCount === 1);
  // Picking-list seeding (picked lots): always requires a real allocation.
  const canPrefill = parentSafe && hasPickingAllocation;
  // No-picking-list FEFO seeding: opt-in per company via
  // `autoSelectMaterialWithoutPickingList`, still bound by the same parent
  // safety. Relaxes ONLY the picking-allocation requirement, never the
  // single-parent genealogy guard.
  const canSuggestWithoutList =
    parentSafe && autoSelectMaterialWithoutPickingList;
  const canSeedSuggestion = canPrefill || canSuggestWithoutList;
  const shouldSuggestAllocation =
    canSeedSuggestion &&
    !!material &&
    !!selectedItemId &&
    !!locationId &&
    (trackingType === "Batch" || trackingType === "Serial");
  const { data: suggestedAllocation } = useSuggestedAllocation(
    shouldSuggestAllocation
      ? {
          itemId: selectedItemId,
          locationId: locationId as string,
          quantity: initialQuantity
        }
      : undefined
  );
  const shouldLoadPickedAllocation =
    canPrefill &&
    !!material?.id &&
    (trackingType === "Batch" || trackingType === "Serial");
  const { data: pickedAllocation, resolved: pickedAllocationResolved } =
    usePickedAllocation(
      shouldLoadPickedAllocation ? (material?.id ?? undefined) : undefined
    );

  // Scanning the SHELF label must issue the allocated lineside child, not the
  // warehouse lot: after a partial pick the shelf entity keeps its id (and its
  // printed label) while the picked portion is a child entity staged at
  // lineside. Without this mapping, a shelf-label scan would consume the
  // warehouse parent at the wrong bin. Only remaps when the scanned id is not
  // itself an allocated lot and a picked child points back at it.
  const resolveScannedBatchId = useCallback(
    (scannedId: string) => {
      if (!scannedId || pickedAllocation.length === 0) return scannedId;
      if (pickedAllocation.some((lot) => lot.trackedEntityId === scannedId)) {
        return scannedId;
      }
      return (
        pickedAllocation.find((lot) => lot.splitFromEntityId === scannedId)
          ?.trackedEntityId ?? scannedId
      );
    },
    [pickedAllocation]
  );
  // Prefer the actual picks; fall back to the suggestion only when nothing's
  // been picked yet (allocated-but-not-picked) or when there's no picking list.
  // Wait for the picked-allocation request to resolve before falling back, so a
  // faster suggestion response can't be seeded and then locked in ahead of the
  // real picked lots.
  //
  // Seed the FEFO suggestion whenever seeding is allowed (`canSeedSuggestion`):
  // that's a real picking allocation (allocated-but-not-yet-picked) OR the
  // no-picking-list opt-in setting. Picked lots always seed. When there's no
  // picking list and the setting is off, `canSeedSuggestion` is false → the
  // operator stays on the Scan tab. This does NOT affect the Select-tab option
  // ordering or the add-row remainder fill below.
  const seedAllocation =
    shouldLoadPickedAllocation && !pickedAllocationResolved
      ? []
      : pickedAllocation.length
        ? pickedAllocation
        : canSeedSuggestion
          ? suggestedAllocation
          : [];
  const hasSeededSuggestionRef = useRef(false);
  useEffect(() => {
    if (hasSeededSuggestionRef.current) return;
    if (!seedAllocation.length) return;
    // Intersect the seed with what is actually still available before
    // applying it. The picked allocation is NOT netted by consumption
    // (pickingListLineTrackedEntity keeps the original picked qty, and a
    // partial consumption splits the entity into a new id), so re-opening
    // the modal after a partial issue would otherwise re-suggest lots that
    // were already consumed. Consumed/unavailable entities drop out of the
    // options lists, so waiting for those to resolve and filtering against
    // them nets the seed correctly.
    if (trackingType === "Batch") {
      if (batchNumbers?.data === undefined) return;
      // Don't clobber a selection the operator already started if the (async)
      // suggestion arrives after they picked.
      if (selectedBatchNumbers.some((b) => b.id)) return;
      const availableById = new Map(
        batchOptions.map((o) => [o.value, o.availableQuantity])
      );
      const lots = seedAllocation
        .map((lot) => ({
          ...lot,
          quantity: Math.min(
            lot.quantity,
            availableById.get(lot.trackedEntityId) ?? 0
          )
        }))
        .filter((lot) => lot.quantity > 0);
      hasSeededSuggestionRef.current = true;
      if (!lots.length) return;
      setSelectedBatchNumbers(
        lots.map((lot, index) => ({
          index,
          id: lot.trackedEntityId,
          quantity: lot.quantity
        }))
      );
      setActiveTab("select");
    } else if (trackingType === "Serial") {
      if (serialNumbers?.data === undefined) return;
      if (selectedSerialNumbers.some((s) => s.id)) return;
      const availableIds = new Set(serialOptions.map((o) => o.value));
      const lots = seedAllocation.filter((lot) =>
        availableIds.has(lot.trackedEntityId)
      );
      hasSeededSuggestionRef.current = true;
      if (!lots.length) return;
      setSelectedSerialNumbers((prev) =>
        prev.map((row, i) =>
          lots[i] ? { ...row, id: lots[i].trackedEntityId } : row
        )
      );
      setActiveTab("select");
    }
  }, [
    seedAllocation,
    trackingType,
    selectedBatchNumbers,
    selectedSerialNumbers,
    batchNumbers,
    serialNumbers,
    batchOptions,
    serialOptions
  ]);

  // Expiry override state. Surfaced when a selected serial/batch is expired.
  // Server enforces the actual company policy (Warn / Block / BlockWithOverride);
  // this UI lets the operator type a reason that the server records when the
  // policy is BlockWithOverride and ignores otherwise.
  const [expiryOverrideReason, setExpiryOverrideReason] = useState("");
  const expiredSerialIds = useMemo(() => {
    const byId = new Map(
      (serialNumbers?.data ?? []).map((s) => [s.id, s.expirationDate])
    );
    return selectedSerialNumbers
      .filter((s) => s.id && isExpiryPast(byId.get(s.id)))
      .map((s) => s.id);
  }, [selectedSerialNumbers, serialNumbers, isExpiryPast]);
  const expiredBatchIds = useMemo(() => {
    const byId = new Map(
      (batchNumbers?.data ?? []).map((b) => [b.id, b.expirationDate])
    );
    return selectedBatchNumbers
      .filter((b) => b.id && isExpiryPast(byId.get(b.id)))
      .map((b) => b.id);
  }, [selectedBatchNumbers, batchNumbers, isExpiryPast]);
  const hasExpiredSelection =
    expiredSerialIds.length > 0 || expiredBatchIds.length > 0;

  // Fetchers
  const fetcher = useFetcher<{
    success: boolean;
    message: string;
    splitEntities?: Array<{
      originalId: string;
      newId: string;
      quantity: number;
      readableId?: string;
      remainingQuantity?: number;
    }>;
  }>();
  const unconsumeFetcher = useFetcher<{ success: boolean; message: string }>();
  const inventoryFetcher = useFetcher<{ success: boolean; message: string }>();

  // Fetch item details when item is selected (only when no material provided)
  const handleItemChange = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setItemDetails(null);
      setSelectedSerialNumbers([{ index: 0, id: "" }]);
      setSelectedBatchNumbers([{ index: 0, id: "", quantity: 1 }]);
      setSerialErrors({});
      setBatchErrors({});

      if (itemId && carbon && !material) {
        setIsLoadingItem(true);
        const { data } = await carbon
          .from("item")
          .select("id, name, unitOfMeasureCode, itemTrackingType")
          .eq("id", itemId)
          .single();

        if (data) {
          setItemDetails(data as ItemDetails);
        }
        setIsLoadingItem(false);
      }
    },
    [carbon, material]
  );

  // Validation functions
  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";
      const isValid = serialOptions.some((opt) => opt.value === value);
      if (!isValid) {
        const sn = serialNumbers?.data?.find((s) => s.id === value);
        if (sn) return `Serial number is ${sn.status}`;
        return "Serial number is not available";
      }
      return null;
    },
    [selectedSerialNumbers, serialOptions, serialNumbers?.data]
  );

  const validateBatchNumber = useCallback(
    (value: string, qty: number, index: number) => {
      if (!value) return "Batch number is required";
      const isDuplicate = selectedBatchNumbers.some(
        (bn, i) => bn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";
      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        const bn = batchNumbers?.data?.find((b) => b.id === value);
        if (bn) return `Batch number is ${bn.status}`;
        return "Batch number is not available";
      }
      if (qty <= 0) return "Quantity must be greater than 0";
      if (qty > batchOption.availableQuantity)
        return `Quantity cannot exceed available quantity (${batchOption.availableQuantity})`;
      return null;
    },
    [selectedBatchNumbers, batchOptions, batchNumbers?.data]
  );

  // Update functions for serial numbers
  const updateSerialNumber = useCallback(
    (serialNumber: { index: number; id: string }) => {
      setSelectedSerialNumbers((prev) => {
        const newSerialNumbers = [...prev];
        newSerialNumbers[serialNumber.index] = serialNumber;
        return newSerialNumbers;
      });
    },
    []
  );

  const addSerialNumber = useCallback(() => {
    setSelectedSerialNumbers((prev) => {
      // When prefill is allowed, seed the new row with the next unused serial.
      // Prefer the remaining pick-method-ordered suggestion (FEFO/FIFO/LIFO),
      // so added rows stay consistent with the seeded ones; only fall back to
      // the picker's default FEFO/FIFO order once the suggestion is exhausted.
      // When prefill is off, the row starts empty — auto-picking a tracked
      // entity the operator never chose is a traceability hazard.
      if (!canSeedSuggestion) {
        return [...prev, { index: prev.length, id: "" }];
      }
      const used = new Set(prev.map((s) => s.id).filter(Boolean));
      const fromSuggestion = seedAllocation.find(
        (lot) => !used.has(lot.trackedEntityId)
      );
      const next = fromSuggestion
        ? serialOptions.find((o) => o.value === fromSuggestion.trackedEntityId)
        : serialOptions.find((o) => !used.has(o.value) && !o.isExpired);
      return [...prev, { index: prev.length, id: next?.value ?? "" }];
    });
  }, [serialOptions, seedAllocation, canSeedSuggestion]);

  const removeSerialNumber = useCallback((indexToRemove: number) => {
    setSelectedSerialNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setSerialErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  // Update functions for batch numbers
  const updateBatchNumber = useCallback(
    (batchNumber: { index: number; id: string; quantity: number }) => {
      setSelectedBatchNumbers((prev) => {
        const newBatchNumbers = [...prev];
        newBatchNumbers[batchNumber.index] = batchNumber;
        return newBatchNumbers;
      });
    },
    []
  );

  const addBatchNumber = useCallback(() => {
    setSelectedBatchNumbers((prev) => {
      // When prefill is allowed, seed the new row with the next unused batch.
      // Prefer the remaining pick-method-ordered suggestion (FEFO/FIFO/LIFO) so
      // added rows match the seeded ones; fall back to the picker's default
      // FEFO/FIFO order once the suggestion is exhausted. Default qty is
      // clamped to the lot's on-hand. When prefill is off, the row starts
      // empty — auto-picking a tracked entity is a traceability hazard.
      if (!canSeedSuggestion) {
        return [...prev, { index: prev.length, id: "", quantity: 1 }];
      }
      const used = new Set(prev.map((b) => b.id).filter(Boolean));
      const fromSuggestion = seedAllocation.find(
        (lot) => !used.has(lot.trackedEntityId)
      );
      const next = fromSuggestion
        ? batchOptions.find((o) => o.value === fromSuggestion.trackedEntityId)
        : batchOptions.find((o) => !used.has(o.value) && !o.isExpired);
      return [
        ...prev,
        {
          index: prev.length,
          id: next?.value ?? "",
          quantity: next ? Math.min(1, next.availableQuantity) : 1
        }
      ];
    });
  }, [batchOptions, seedAllocation, canSeedSuggestion]);

  const removeBatchNumber = useCallback((indexToRemove: number) => {
    setSelectedBatchNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setBatchErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  const validateBatchInput = useCallback(
    (value: string, index: number) => {
      if (!value) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is required"
        }));
        return false;
      }

      const duplicateIndices = selectedBatchNumbers
        .map((bn, i) => (bn.id === value && i !== index ? i : -1))
        .filter((i) => i !== -1);

      if (duplicateIndices.length > 0) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Duplicate batch number"
        }));
        return false;
      }

      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is not available"
        }));
        return false;
      }

      const currentBatchNumber = selectedBatchNumbers[index];
      if (currentBatchNumber.quantity > batchOption.availableQuantity) {
        const remainingQuantity =
          currentBatchNumber.quantity - batchOption.availableQuantity;

        updateBatchNumber({
          ...currentBatchNumber,
          id: value,
          quantity: batchOption.availableQuantity
        });

        setSelectedBatchNumbers((prev) => {
          const newIndex = prev.length;
          return [
            ...prev,
            { index: newIndex, id: "", quantity: remainingQuantity }
          ];
        });
      }

      setBatchErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
      return true;
    },
    [selectedBatchNumbers, batchOptions, updateBatchNumber]
  );

  const toggleTrackedInput = useCallback((id: string) => {
    setSelectedTrackedInputs((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  }, []);

  // Update functions for unconsume batch rows
  const updateUnconsumedBatch = useCallback(
    (batch: { index: number; id: string }) => {
      setUnconsumedBatches((prev) => {
        const newBatches = [...prev];
        newBatches[batch.index] = batch;
        return newBatches;
      });
    },
    []
  );

  const addUnconsumedBatch = useCallback(() => {
    setUnconsumedBatches((prev) => {
      // Pre-fill the new row with the next consumed batch not already selected
      const used = new Set(prev.map((b) => b.id).filter(Boolean));
      const next = trackedInputs.find((input) => !used.has(input.id));
      return [...prev, { index: prev.length, id: next?.id ?? "" }];
    });
  }, [trackedInputs]);

  const removeUnconsumedBatch = useCallback((indexToRemove: number) => {
    setUnconsumedBatches((prev) =>
      prev
        .filter((_, i) => i !== indexToRemove)
        .map((item, i) => ({ ...item, index: i }))
    );
  }, []);

  // Submit handlers
  const handleSubmitSerial = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for serial tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedSerialNumbers.forEach((sn) => {
      const error = validateSerialNumber(sn.id, sn.index);
      if (error) {
        newErrors[sn.index] = error;
        hasErrors = true;
      }
    });

    setSerialErrors(newErrors);

    if (!hasErrors) {
      const overrideFields =
        hasExpiredSelection && expiryOverrideReason.trim().length > 0
          ? {
              overrideExpired: true,
              overrideReason: expiryOverrideReason.trim()
            }
          : {};
      // Per-unit/per-step attribution context (assembly view only).
      const contextFields = {
        ...(jobOperationStepId ? { jobOperationStepId } : {}),
        ...(unitNumber !== undefined ? { unitNumber } : {})
      };
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            })),
            ...contextFields,
            ...overrideFields
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            })),
            ...contextFields,
            ...overrideFields
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedSerialNumbers,
    validateSerialNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher,
    hasExpiredSelection,
    expiryOverrideReason,
    jobOperationStepId,
    unitNumber
  ]);

  const handleSubmitBatch = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for batch tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedBatchNumbers.forEach((bn) => {
      const error = validateBatchNumber(bn.id, bn.quantity, bn.index);
      if (error) {
        newErrors[bn.index] = error;
        hasErrors = true;
      }
    });

    setBatchErrors(newErrors);

    if (!hasErrors) {
      const overrideFields =
        hasExpiredSelection && expiryOverrideReason.trim().length > 0
          ? {
              overrideExpired: true,
              overrideReason: expiryOverrideReason.trim()
            }
          : {};
      // Per-unit/per-step attribution context (assembly view only).
      const contextFields = {
        ...(jobOperationStepId ? { jobOperationStepId } : {}),
        ...(unitNumber !== undefined ? { unitNumber } : {})
      };
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            })),
            ...contextFields,
            ...overrideFields
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            })),
            ...contextFields,
            ...overrideFields
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedBatchNumbers,
    validateBatchNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher,
    hasExpiredSelection,
    expiryOverrideReason,
    jobOperationStepId,
    unitNumber
  ]);

  const handleUnconsumeSerial = useCallback(() => {
    if (selectedTrackedInputs.length === 0) {
      toast.error("Please select at least one item to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: selectedTrackedInputs.map((id) => ({
        trackedEntityId: id,
        quantity: 1
      }))
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [selectedTrackedInputs, material?.id, parentId, unconsumeFetcher]);

  const handleUnconsumeBatch = useCallback(() => {
    const selectedBatches = unconsumedBatches.filter((batch) => batch.id);
    if (selectedBatches.length === 0) {
      toast.error("Please select at least one batch to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: selectedBatches.map((batch) => ({
        trackedEntityId: batch.id,
        quantity:
          trackedInputs.find((input) => input.id === batch.id)?.quantity ?? 0
      }))
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [
    unconsumedBatches,
    material?.id,
    parentId,
    trackedInputs,
    unconsumeFetcher
  ]);

  // Handle fetcher responses
  const processedFetcherData = useRef<typeof fetcher.data | null>(null);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data !== processedFetcherData.current
    ) {
      processedFetcherData.current = fetcher.data;

      if (fetcher.data.success) {
        const warning = (fetcher.data as { warning?: string }).warning;
        if (warning) toast.warning(warning);
        if (
          fetcher.data.splitEntities &&
          fetcher.data.splitEntities.length > 0
        ) {
          // A partial issue split the lot: the consumed portion departed as a
          // new child entity and the surviving lineside lot kept its id (and
          // its label). A one-line confirmation replaces the old full-screen
          // split ceremony — nothing to print, nothing to act on.
          for (const split of fetcher.data.splitEntities) {
            const lotLabel =
              split.readableId ||
              getItemReadableId(items, material?.itemId) ||
              "batch";
            const issuedQuantity = numberFormatter.format(split.quantity);
            const remainingQuantity =
              split.remainingQuantity !== undefined
                ? numberFormatter.format(split.remainingQuantity)
                : null;
            toast.success(
              remainingQuantity !== null
                ? t`Issued ${issuedQuantity} of ${lotLabel} — ${remainingQuantity} remains`
                : t`Issued ${issuedQuantity} of ${lotLabel}`
            );
          }
          onClose();
        } else {
          onClose();
          if (fetcher.data.message) {
            toast.success(fetcher.data.message);
          }
        }
      } else if (fetcher.data.message) {
        toast.error(fetcher.data.message);
      }
    }
  }, [
    fetcher.state,
    fetcher.data,
    onClose,
    items,
    material?.itemId,
    numberFormatter,
    t
  ]);

  useEffect(() => {
    if (unconsumeFetcher.data?.success) {
      onClose();
      if (unconsumeFetcher.data.message) {
        toast.success(unconsumeFetcher.data.message);
      }
    } else if (unconsumeFetcher.data?.message) {
      toast.error(unconsumeFetcher.data.message);
    }
  }, [unconsumeFetcher.data, onClose]);

  useEffect(() => {
    if (inventoryFetcher.data?.success) {
      onClose();
    }
  }, [inventoryFetcher.data, onClose]);

  // Determine what to render based on state
  const showItemSelector = !material?.itemId;
  const showContent = material?.itemId || itemDetails;

  const hasTrackedInputs = trackedInputs.length > 0;

  return (
    <>
      <Modal open onOpenChange={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {material?.description ??
                getItemReadableId(items, selectedItemId) ??
                "Issue Material"}
            </ModalTitle>
            {!material && (
              <ModalDescription>
                Select an item and specify the quantity to issue
              </ModalDescription>
            )}
          </ModalHeader>

          {trackingType === "Inventory" ||
          trackingType === "Non-Inventory" ||
          trackingType === null ? (
            // Untracked item (Inventory or Non-Inventory, e.g. consumables and
            // services) - use ValidatedForm; the issue edge function skips the
            // itemLedger for Non-Inventory items but still posts the WIP cost
            <ValidatedForm
              method="post"
              action={path.to.issue}
              onSubmit={onClose}
              validator={issueValidator}
              defaultValues={{
                materialId: material?.id ?? "",
                jobOperationId: operationId,
                itemId: selectedItemId,
                // Default to the remaining qty (or one unit's worth in the
                // assembly view's one-at-a-time flow), but never submit
                // zero/negative — that's how this modal ends up posting an
                // invalid form and the server bouncing it silently when a
                // material has been fully issued already.
                quantity: Math.max(
                  1,
                  issuePerUnit
                    ? (material?.quantity ?? material?.estimatedQuantity ?? 1)
                    : (material?.estimatedQuantity ?? 0) -
                        (material?.quantityIssued ?? 0)
                ),
                adjustmentType: "Negative Adjmt."
              }}
              fetcher={inventoryFetcher}
            >
              <ModalBody>
                <Hidden name="jobOperationId" />
                <Hidden name="materialId" />
                {/* Scope an unplanned part (no materialId) to the step it's
                    issued on so the assembly view shows it on that step. */}
                {!material?.id && jobOperationStepId && (
                  <Hidden
                    name="jobOperationStepId"
                    value={jobOperationStepId}
                  />
                )}
                {material?.id && (
                  <Hidden name="adjustmentType" value="Negative Adjmt." />
                )}
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={(value) => {
                          handleItemChange(value);
                        }}
                        options={itemOptions}
                      />
                      <input
                        type="hidden"
                        name="itemId"
                        value={selectedItemId}
                      />
                    </div>
                  )}
                  {material?.id && (
                    <Hidden name="itemId" value={selectedItemId} />
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent &&
                    (trackingType === "Inventory" ||
                      trackingType === "Non-Inventory") && (
                      <>
                        {!material?.id && (
                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Adjustment Type
                            </label>
                            <Select
                              name="adjustmentType"
                              defaultValue="Negative Adjmt."
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Positive Adjmt.">
                                  Add to Inventory
                                </SelectItem>
                                <SelectItem value="Negative Adjmt.">
                                  Pull from Inventory
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {/*
                        Use the form-aware `<Number>` (FormNumberInput) so
                        `name="quantity"` lands on react-aria's NumberField
                        and a hidden form input is rendered with the numeric
                        value. The previous inline NumberField put `name` on
                        NumberInput (the display slot), which react-aria
                        ignores — the form submitted with no `quantity` key,
                        the server's zod schema rejected it, and the action
                        returned a 400 the modal silently swallowed.
                      */}
                        <FormNumberInput
                          name="quantity"
                          label="Quantity"
                          minValue={0.01}
                        />
                      </>
                    )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" size="lg" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  isLoading={inventoryFetcher.state !== "idle"}
                  isDisabled={
                    inventoryFetcher.state !== "idle" ||
                    !selectedItemId ||
                    isLoadingItem
                  }
                >
                  Issue
                </Button>
              </ModalFooter>
            </ValidatedForm>
          ) : (
            // Tracked items (Serial or Batch)
            <>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={handleItemChange}
                        options={itemOptions}
                      />
                    </div>
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent && trackingType === "Serial" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-3 mb-4",
                          hasTrackedInputs && "grid-cols-4"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        <TabsTrigger value="scrap">
                          <LuTrash2 className="mr-2" />
                          Scrap
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scrap">
                        <ScrapTab
                          entities={scrappableEntities}
                          onScrap={(entity) =>
                            setScrapEntityTarget({
                              id: entity.id,
                              readableId: entity.readableId
                            })
                          }
                        />
                      </TabsContent>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-scan`}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <InputGroup>
                                    <Input
                                      autoFocus={index === 0}
                                      placeholder={`Serial Number ${index + 1}`}
                                      value={sn.id}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        const newSerialNumbers = [
                                          ...selectedSerialNumbers
                                        ];
                                        newSerialNumbers[index] = {
                                          index,
                                          id: newValue
                                        };
                                        setSelectedSerialNumbers(
                                          newSerialNumbers
                                        );
                                      }}
                                      onKeyDown={(e) => {
                                        // Barcode scanners emit the code then an
                                        // Enter keystroke — submit the issue on
                                        // Enter, same as clicking Issue.
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleSubmitSerial();
                                        }
                                      }}
                                      onBlur={(e) => {
                                        const newValue = e.target.value;
                                        const error = validateSerialNumber(
                                          newValue,
                                          index
                                        );
                                        setSerialErrors((prev) => {
                                          const newErrors = { ...prev };
                                          if (error) {
                                            newErrors[index] = error;
                                          } else {
                                            delete newErrors[index];
                                          }
                                          return newErrors;
                                        });
                                        if (!error) {
                                          updateSerialNumber({
                                            index,
                                            id: newValue
                                          });
                                        } else {
                                          const newSerialNumbers = [
                                            ...selectedSerialNumbers
                                          ];
                                          newSerialNumbers[index] = {
                                            index,
                                            id: ""
                                          };
                                          setSelectedSerialNumbers(
                                            newSerialNumbers
                                          );
                                        }
                                      }}
                                      className={cn(
                                        serialErrors[index] &&
                                          "border-destructive"
                                      )}
                                    />
                                    <InputRightElement className="pl-2">
                                      {!serialErrors[index] && sn.id ? (
                                        <LuCheck className="text-emerald-500" />
                                      ) : (
                                        <LuQrCode />
                                      )}
                                    </InputRightElement>
                                  </InputGroup>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-select`}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    placeholder={`Select Serial Number ${index + 1}`}
                                    value={sn.id}
                                    onChange={(value) => {
                                      const newSerialNumbers = [
                                        ...selectedSerialNumbers
                                      ];
                                      newSerialNumbers[index] = {
                                        index,
                                        id: value
                                      };
                                      setSelectedSerialNumbers(
                                        newSerialNumbers
                                      );
                                      const error = validateSerialNumber(
                                        value,
                                        index
                                      );
                                      setSerialErrors((prev) => {
                                        const newErrors = { ...prev };
                                        if (error) {
                                          newErrors[index] = error;
                                        } else {
                                          delete newErrors[index];
                                        }
                                        return newErrors;
                                      });
                                    }}
                                    options={serialOptions}
                                  />
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            {trackedInputs.map((input) => (
                              <div
                                key={input.id}
                                className="flex items-center gap-3 p-2 border rounded-md"
                              >
                                <Checkbox
                                  id={`unconsume-${input.id}`}
                                  checked={selectedTrackedInputs.includes(
                                    input.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleTrackedInput(input.id)
                                  }
                                />
                                <label
                                  htmlFor={`unconsume-${input.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="font-medium text-sm">
                                    {input.id}
                                  </div>
                                  {input.readableId && (
                                    <div className="text-xs text-muted-foreground">
                                      Serial: {input.readableId}
                                    </div>
                                  )}
                                </label>
                              </div>
                            ))}
                            {trackedInputs.length === 0 && (
                              <Alert variant="warning">
                                <AlertTitle>No consumed materials</AlertTitle>
                                <AlertDescription>
                                  There are no consumed materials to unconsume.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}

                  {showContent && trackingType === "Batch" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-3 mb-4",
                          hasTrackedInputs && "grid-cols-4"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        <TabsTrigger value="scrap">
                          <LuTrash2 className="mr-2" />
                          Scrap
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scrap">
                        <ScrapTab
                          entities={scrappableEntities}
                          onScrap={(entity) =>
                            setScrapEntityTarget({
                              id: entity.id,
                              readableId: entity.readableId
                            })
                          }
                        />
                      </TabsContent>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <InputGroup>
                                    <Input
                                      autoFocus={index === 0}
                                      value={batch.id}
                                      onChange={(e) => {
                                        // A shelf-label scan resolves to its
                                        // allocated lineside child (see
                                        // resolveScannedBatchId).
                                        const newValue = resolveScannedBatchId(
                                          e.target.value
                                        );
                                        updateBatchNumber({
                                          ...batch,
                                          id: newValue
                                        });
                                      }}
                                      onKeyDown={(e) => {
                                        // Barcode scanners emit the code then an
                                        // Enter keystroke — submit the issue on
                                        // Enter, same as clicking Issue.
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleSubmitBatch();
                                        }
                                      }}
                                      onBlur={(e) => {
                                        validateBatchInput(
                                          resolveScannedBatchId(e.target.value),
                                          index
                                        );
                                      }}
                                      placeholder="Scan batch number"
                                    />
                                    <InputRightElement className="pl-2">
                                      {!batchErrors[index] && batch.id ? (
                                        <LuCheck className="text-emerald-500" />
                                      ) : (
                                        <LuQrCode />
                                      )}
                                    </InputRightElement>
                                  </InputGroup>
                                </div>
                                <div className="w-24">
                                  <NumberField
                                    id={`quantity-${index}`}
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    value={batch.id}
                                    onChange={(value) => {
                                      updateBatchNumber({
                                        ...batch,
                                        id: value
                                      });
                                      validateBatchInput(value, index);
                                    }}
                                    options={batchOptions}
                                    placeholder="Select batch number"
                                  />
                                </div>
                                <div className="w-24">
                                  <NumberField
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add Batch
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            {unconsumedBatches.map((batch, index) => (
                              <div key={index} className="flex gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    value={batch.id}
                                    onChange={(value) =>
                                      updateUnconsumedBatch({
                                        index,
                                        id: value
                                      })
                                    }
                                    options={unconsumeOptions.filter(
                                      (option) =>
                                        !unconsumedBatches.some(
                                          (b, i) =>
                                            b.id === option.value && i !== index
                                        )
                                    )}
                                    placeholder="Select batch to unconsume"
                                  />
                                </div>
                                {batch.id && (
                                  <div className="w-24">
                                    <Input
                                      isReadOnly
                                      value={
                                        trackedInputs
                                          .find(
                                            (input) => input.id === batch.id
                                          )
                                          ?.quantity.toString() ?? "0"
                                      }
                                    />
                                  </div>
                                )}
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeUnconsumedBatch(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                            ))}
                            <div>
                              <Button
                                type="button"
                                variant="secondary"
                                leftIcon={<LuCirclePlus />}
                                onClick={addUnconsumedBatch}
                                isDisabled={
                                  unconsumedBatches.length >=
                                  trackedInputs.length
                                }
                              >
                                Add Batch
                              </Button>
                            </div>
                            <div className="h-8" />
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}
                  {hasExpiredSelection && activeTab !== "unconsume" && (
                    <Alert
                      variant={
                        expiredEntityPolicy === "Warn"
                          ? "warning"
                          : "destructive"
                      }
                    >
                      <AlertTitle>
                        {expiredEntityPolicy === "Warn"
                          ? "Expired stock selected"
                          : "Override required"}
                      </AlertTitle>
                      <AlertDescription>
                        <div className="flex flex-col gap-2">
                          <p>
                            {expiredSerialIds.length + expiredBatchIds.length}{" "}
                            of the selected{" "}
                            {trackingType === "Serial" ? "serials" : "batches"}{" "}
                            are past their expiration date.
                            {expiredEntityPolicy === "Warn"
                              ? " The issue will go through with a warning."
                              : " Enter a reason below to record the override."}
                          </p>
                          {expiredEntityPolicy === "BlockWithOverride" && (
                            <textarea
                              className="border rounded-md p-2 text-sm bg-background"
                              placeholder="Reason for issuing expired stock"
                              value={expiryOverrideReason}
                              onChange={(e) =>
                                setExpiryOverrideReason(e.target.value)
                              }
                              rows={2}
                            />
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" size="lg" onClick={onClose}>
                  Cancel
                </Button>
                {activeTab === "unconsume" ? (
                  <Button
                    variant="destructive"
                    size="lg"
                    onClick={
                      trackingType === "Serial"
                        ? handleUnconsumeSerial
                        : handleUnconsumeBatch
                    }
                    isLoading={unconsumeFetcher.state !== "idle"}
                    isDisabled={
                      unconsumeFetcher.state !== "idle" ||
                      (trackingType === "Serial"
                        ? selectedTrackedInputs.length === 0
                        : !unconsumedBatches.some((batch) => batch.id))
                    }
                  >
                    Unconsume
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={
                      trackingType === "Serial"
                        ? handleSubmitSerial
                        : handleSubmitBatch
                    }
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={
                      fetcher.state !== "idle" ||
                      !selectedItemId ||
                      isLoadingItem
                    }
                  >
                    Issue
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {scrapEntityTarget && (
        <ScrapEntityModal
          materialId={material?.id ?? ""}
          trackedEntityId={scrapEntityTarget.id}
          readableId={scrapEntityTarget.readableId}
          parentId={parentId}
          isMakeToOrder={material?.methodType === "Make to Order"}
          onClose={() => setScrapEntityTarget(null)}
        />
      )}
    </>
  );
}

function useSerialNumbers(itemId?: string) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId));
    }
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

// Hook for fetching batch numbers
function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
  }, [itemId, batchNumbersFetcher.load]);

  return { data: batchNumbersFetcher.data };
}

// Hook for the on-the-fly picking-list-style allocation suggestion.
// Loads only when args are provided (tracked item, no picking allocation).
function useSuggestedAllocation(args?: {
  itemId: string;
  locationId: string;
  quantity: number;
}) {
  const fetcher = useFetcher<{ data: SuggestedAllocationLot[]; error: null }>();
  const key =
    args && args.itemId && args.locationId && args.quantity > 0
      ? `${args.itemId}:${args.locationId}:${args.quantity}`
      : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on args identity
  useEffect(() => {
    if (args && key) {
      fetcher.load(
        path.to.api.suggestedAllocation(
          args.itemId,
          args.locationId,
          args.quantity
        )
      );
    }
  }, [key]);

  return { data: fetcher.data?.data ?? [] };
}

// Hook for the lots a picking list already picked for this job material. Loads
// only when a picking allocation exists (jobMaterialId provided).
function usePickedAllocation(jobMaterialId?: string) {
  const fetcher = useFetcher<{ data: SuggestedAllocationLot[]; error: null }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on jobMaterialId
  useEffect(() => {
    if (jobMaterialId) {
      fetcher.load(path.to.api.pickedAllocation(jobMaterialId));
    }
  }, [jobMaterialId]);

  return {
    data: fetcher.data?.data ?? [],
    // Has the request come back? An empty result only means "nothing picked"
    // once this is true — before that it's still loading. Guards the seed from
    // falling back to the suggestion before the picked lots have arrived.
    resolved: fetcher.state === "idle" && fetcher.data !== undefined
  };
}
