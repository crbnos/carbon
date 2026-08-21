import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import type { Item, OperationItem } from "../types";
import { isBatchItem } from "../types";

// Operations the server's eligibility gate would accept: on a batchable
// process, not already batched, and not started. The edge function re-checks
// all of this — the client filter only exists so the checkbox never appears on
// a card the server would reject.
const SELECTABLE_STATUSES = new Set(["Todo", "Ready", "Waiting"]);

export function isBatchableOperation(item: Item): item is OperationItem {
  if (isBatchItem(item)) return false;
  return (
    "processBatchable" in item &&
    item.processBatchable === true &&
    !item.jobOperationBatchId &&
    SELECTABLE_STATUSES.has(item.status ?? "")
  );
}

// State + actions + meta, so consumers depend on the interface, not on how
// selection is stored (vercel-composition-patterns: state-context-interface).
interface BatchSelectionContextType {
  selectedIds: ReadonlySet<string>;
  // Only operations sharing one process can share a batch. The first selection
  // pins the process; cards on other processes stop being selectable until the
  // selection is cleared.
  selectedProcessId: string | null;
  isSelectable: (item: Item) => boolean;
  toggle: (item: OperationItem) => void;
  clear: () => void;
}

const BatchSelectionContext = createContext<BatchSelectionContextType | null>(
  null
);

export function BatchSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  const selectedProcessId = useMemo(() => {
    const first = selected.values().next();
    return first.done ? null : first.value;
  }, [selected]);

  const isSelectable = useCallback(
    (item: Item) => {
      if (!isBatchableOperation(item)) return false;
      return (
        selectedProcessId === null || item.columnType === selectedProcessId
      );
    },
    [selectedProcessId]
  );

  const toggle = useCallback((item: OperationItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item.columnType);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);

  const value = useMemo(
    () => ({ selectedIds, selectedProcessId, isSelectable, toggle, clear }),
    [selectedIds, selectedProcessId, isSelectable, toggle, clear]
  );

  return (
    <BatchSelectionContext.Provider value={value}>
      {children}
    </BatchSelectionContext.Provider>
  );
}

// Null-safe: boards without batching (or MES reuse) simply render no
// selection affordances — no boolean props threaded anywhere.
export function useBatchSelection() {
  return useContext(BatchSelectionContext);
}
