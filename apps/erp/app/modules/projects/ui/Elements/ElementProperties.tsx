// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Calendar,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  NumberField,
  NumberInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ReactNode, RefObject } from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuCalendar,
  LuCalendarCheck,
  LuCheck,
  LuClock,
  LuDollarSign,
  LuFlag,
  LuMinus,
  LuTag,
  LuUser
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { getPriorityIcon } from "~/modules/quality/ui/Issue/IssueIcons";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type {
  ProjectElementEditableField,
  ProjectElementPriority,
  ProjectStateGroup
} from "../../projects.models";
import {
  projectElementPriorities,
  projectStateGroups
} from "../../projects.models";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";

// --- Saving one field ---------------------------------------------------------

export type ElementUpdateField = ProjectElementEditableField | "labelIds";

/**
 * Saves one field of one element through the update route. The fetcher key
 * is `element:{id}:{field}`, so every pill of one field reads the same
 * pending value.
 */
export function useElementField(
  projectId: string,
  elementId: string,
  field: ElementUpdateField
) {
  const key = elementFieldKey(elementId, field);
  const changeRequestId = useActiveChangeRequestId();
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({
    key,
    // The same field can show twice (a list row and the open element), so the
    // toast id keeps one message per failed save.
    onError: (data) =>
      toast.error(data.error?.message ?? "Failed to save", { id: key })
  });

  const pendingValue = fetcher.formData?.get("value");
  const pending =
    typeof pendingValue === "string"
      ? pendingValue === ""
        ? null
        : pendingValue
      : undefined;

  const submit = (value: string | null) => {
    fetcher.submit(
      { ids: elementId, field, value: value ?? "" },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementUpdate(projectId),
          changeRequestId
        )
      }
    );
  };

  return { pending, submit, isSubmitting: fetcher.state !== "idle" };
}

function elementFieldKey(elementId: string, field: ElementUpdateField) {
  return `element:${elementId}:${field}`;
}

/** The value to show: the pending value while a save runs, else the saved one. */
function shown<T>(pending: string | null | undefined, saved: T) {
  return pending === undefined ? saved : (pending as T);
}

// --- The pill -----------------------------------------------------------------

export type PillVariant = "pill" | "ghost" | "icon" | "plain";

type PillProps = ComponentPropsWithoutRef<"button"> & {
  variant?: PillVariant;
  isDisabled?: boolean;
};

/**
 * The trigger of every property editor. A `pill` is a 24 px chip (the rows of
 * the Plan list). A `ghost` fills the value column of the element sidebar. An
 * `icon` is a bare square that shows only the value's icon or avatar. A
 * `plain` is borderless muted text (a list row's date, as in Linear).
 */
const Pill = forwardRef<HTMLButtonElement, PillProps>(
  (
    { variant = "pill", isDisabled, className, children, onClick, ...props },
    ref
  ) => (
    <button
      {...props}
      ref={ref}
      type="button"
      disabled={isDisabled}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        variant === "pill"
          ? "h-6 max-w-[12rem] shrink-0 rounded-md border border-border px-2 text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground"
          : variant === "icon"
            ? "size-6 shrink-0 justify-center rounded-md text-muted-foreground enabled:hover:bg-accent"
            : variant === "plain"
              ? "h-6 shrink-0 rounded-md px-1.5 text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground"
              : "h-8 w-full rounded-md px-2 text-sm text-foreground enabled:hover:bg-accent",
        className
      )}
      onClick={(event) => {
        // A pill sits inside a clickable row: keep the row from opening.
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {children}
    </button>
  )
);
Pill.displayName = "Pill";

function Placeholder({ children }: { children: ReactNode }) {
  return <span className="truncate text-muted-foreground">{children}</span>;
}

type FieldPillProps = {
  projectId: string;
  elementId: string;
  variant?: PillVariant;
  isDisabled?: boolean;
};

// --- Keyboard shortcuts -------------------------------------------------------

/** The pills a keyboard shortcut can open (`PROJECT_SHORTCUTS`). */
export type PillShortcutField = "state" | "owner" | "priority" | "labels";

export type PillShortcutRequest = {
  elementId: string;
  field: PillShortcutField;
};

const PillShortcutContext = createContext<PillShortcutRequest | null>(null);

/**
 * Pills under this provider open when a shortcut asks for their element and
 * field. The element page and the List layout each have one, so the open
 * peek and the list row never both answer.
 */
export const PillShortcutProvider = PillShortcutContext.Provider;

/**
 * The request a shortcut makes, for `PillShortcutProvider`. It clears itself
 * after one commit: the pills' effects run before this (parent) effect, so a
 * row that mounts later never reopens.
 */
export function usePillShortcutRequest() {
  const [request, setRequest] = useState<PillShortcutRequest | null>(null);
  useEffect(() => {
    if (request) setRequest(null);
  }, [request]);
  return [request, setRequest] as const;
}

/**
 * Opens a pill when the nearest provider's request names it. A hidden copy
 * (the List row keeps a narrow and a wide state pill) has no box and stays
 * closed.
 */
function usePillShortcut(
  elementId: string,
  field: PillShortcutField,
  isDisabled: boolean | undefined,
  triggerRef: RefObject<HTMLButtonElement>,
  open: () => void
) {
  const request = useContext(PillShortcutContext);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!request || isDisabled) return;
    if (request.elementId !== elementId || request.field !== field) return;
    const trigger = triggerRef.current;
    if (!trigger || trigger.getClientRects().length === 0) return;
    openRef.current();
  }, [request, elementId, field, isDisabled, triggerRef]);
}

// --- State --------------------------------------------------------------------

const groupOrder = new Map<ProjectStateGroup, number>(
  projectStateGroups.map((group, index) => [group, index])
);

/** States in group order (Backlog → Cancelled), then by `sortOrder`. */
export function sortStates(states: ProjectState[]) {
  return [...states].sort(
    (a, b) =>
      (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
      a.sortOrder - b.sortOrder
  );
}

export function StatePill({
  projectId,
  elementId,
  stateId,
  states,
  variant,
  isDisabled
}: FieldPillProps & { stateId: string; states: ProjectState[] }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePillShortcut(elementId, "state", isDisabled, triggerRef, () =>
    setOpen(true)
  );
  const { pending, submit } = useElementField(projectId, elementId, "stateId");
  const value = shown(pending, stateId);
  const state = states.find((s) => s.id === value);
  const sorted = useMemo(() => sortStates(states), [states]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pill
          ref={triggerRef}
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change state`}
          title={variant === "icon" ? state?.name : undefined}
        >
          {state ? (
            <>
              <StateIcon group={state.group} color={state.color} />
              {variant !== "icon" && (
                <span className="truncate">{state.name}</span>
              )}
            </>
          ) : (
            <Placeholder>
              <Trans>State</Trans>
            </Placeholder>
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) submit(next);
          }}
        >
          {sorted.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id}>
              <DropdownMenuIcon
                icon={<StateIcon group={s.group} color={s.color} />}
              />
              <span>{s.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Owner --------------------------------------------------------------------

export function OwnerPill({
  projectId,
  elementId,
  ownerId,
  variant,
  isDisabled
}: FieldPillProps & { ownerId: string | null }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePillShortcut(elementId, "owner", isDisabled, triggerRef, () =>
    setOpen(true)
  );
  const [people] = usePeople();
  const user = useUser();
  const { pending, submit } = useElementField(projectId, elementId, "ownerId");
  const value = shown(pending, ownerId);

  const options = useMemo(
    () => [
      { value: "", label: t`No owner` },
      { value: user.id, label: `${user.firstName} ${user.lastName}` },
      ...people
        .filter((p) => p.id !== user.id && p.active !== false)
        .map((p) => ({ value: p.id, label: p.name }))
    ],
    [people, user, t]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill
          ref={triggerRef}
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change owner`}
        >
          {value ? (
            <EmployeeAvatar
              employeeId={value}
              size={variant === "icon" ? "xs" : "xxs"}
              withName={variant === "ghost"}
            />
          ) : (
            <>
              <LuUser className="size-3 shrink-0" />
              {variant === "ghost" && (
                <Placeholder>
                  <Trans>No owner</Trans>
                </Placeholder>
              )}
            </>
          )}
        </Pill>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t`Search...`} className="h-9" />
          <CommandList>
            <CommandEmpty>
              <Trans>No option found.</Trans>
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value || "none"}
                  value={option.label}
                  onSelect={() => {
                    if (option.value !== (value ?? "")) {
                      submit(option.value || null);
                    }
                    setOpen(false);
                  }}
                >
                  {option.label}
                  <LuCheck
                    className={cn(
                      "ml-auto size-4",
                      option.value === (value ?? "")
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// --- Priority -----------------------------------------------------------------

export function ElementPriorityIcon({
  priority
}: {
  priority: ProjectElementPriority;
}) {
  if (priority === "None") {
    return <LuMinus className="size-3 shrink-0 text-muted-foreground" />;
  }
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      {getPriorityIcon(priority === "Urgent" ? "Critical" : priority, false)}
    </span>
  );
}

export function usePriorityLabels(): Record<ProjectElementPriority, string> {
  const { t } = useLingui();
  return {
    Urgent: t`Urgent`,
    High: t`High`,
    Medium: t`Medium`,
    Low: t`Low`,
    None: t`No priority`
  };
}

export function PriorityPill({
  projectId,
  elementId,
  priority,
  variant,
  isDisabled
}: FieldPillProps & { priority: ProjectElementPriority }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePillShortcut(elementId, "priority", isDisabled, triggerRef, () =>
    setOpen(true)
  );
  const labels = usePriorityLabels();
  const { pending, submit } = useElementField(projectId, elementId, "priority");
  const value = shown(pending, priority) ?? "None";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pill
          ref={triggerRef}
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change priority`}
        >
          <ElementPriorityIcon priority={value} />
          {(variant === "ghost" || value !== "None") && (
            <span className="truncate">{labels[value]}</span>
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) submit(next);
          }}
        >
          {projectElementPriorities.map((p) => (
            <DropdownMenuRadioItem key={p} value={p}>
              <DropdownMenuIcon icon={<ElementPriorityIcon priority={p} />} />
              <span>{labels[p]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Labels -------------------------------------------------------------------

function LabelDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

export function LabelsPill({
  projectId,
  elementId,
  labelIds,
  labels,
  variant,
  isDisabled
}: FieldPillProps & { labelIds: string[]; labels: ProjectLabel[] }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  usePillShortcut(elementId, "labels", isDisabled, triggerRef, () =>
    setOpen(true)
  );
  const { pending, submit } = useElementField(projectId, elementId, "labelIds");
  const value =
    pending === undefined
      ? labelIds
      : pending === null
        ? []
        : pending.split(",");
  const selected = labels.filter((l) => value.includes(l.id));

  const toggle = (id: string) => {
    const next = value.includes(id)
      ? value.filter((v) => v !== id)
      : [...value, id];
    submit(next.length > 0 ? next.join(",") : null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill
          ref={triggerRef}
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change labels`}
        >
          {selected.length === 0 ? (
            <>
              <LuTag className="size-3 shrink-0" />
              {variant === "ghost" && (
                <Placeholder>
                  <Trans>No labels</Trans>
                </Placeholder>
              )}
            </>
          ) : selected.length === 1 || variant === "ghost" ? (
            <HStack spacing={2} className="min-w-0 flex-wrap">
              {selected.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex min-w-0 items-center gap-1"
                >
                  <LabelDot color={label.color} />
                  <span className="truncate">{label.name}</span>
                </span>
              ))}
            </HStack>
          ) : (
            <>
              <span className="flex -space-x-0.5">
                {selected.slice(0, 3).map((label) => (
                  <LabelDot key={label.id} color={label.color} />
                ))}
              </span>
              <span className="tabular-nums">
                <Plural
                  value={selected.length}
                  one="# label"
                  other="# labels"
                />
              </span>
            </>
          )}
        </Pill>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t`Search...`} className="h-9" />
          <CommandList>
            <CommandEmpty>
              <Trans>No labels in this project</Trans>
            </CommandEmpty>
            <CommandGroup>
              {labels.map((label) => (
                <CommandItem
                  key={label.id}
                  value={label.name}
                  onSelect={() => toggle(label.id)}
                >
                  <LabelDot color={label.color} />
                  <span className="truncate">{label.name}</span>
                  <LuCheck
                    className={cn(
                      "ml-auto size-4",
                      value.includes(label.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// --- Dates --------------------------------------------------------------------

export function DatePill({
  projectId,
  elementId,
  field,
  date,
  isComplete,
  variant,
  isDisabled
}: FieldPillProps & {
  field: "startDate" | "targetDate";
  date: string | null;
  /** A completed element is never late. */
  isComplete?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const today = useCompanyToday();
  const { formatDate } = useDateFormatter();
  const { pending, submit } = useElementField(projectId, elementId, field);
  const value = shown(pending, date);
  const isLate =
    field === "targetDate" && !isComplete && !!value && value < today;
  const Icon = field === "startDate" ? LuCalendar : LuCalendarCheck;
  const label = field === "startDate" ? t`Start date` : t`Target date`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill
          variant={variant}
          isDisabled={isDisabled}
          aria-label={label}
          className={cn(isLate && "text-red-500 enabled:hover:text-red-500")}
        >
          {(variant !== "plain" || !value) && (
            <Icon className="size-3 shrink-0" />
          )}
          {value ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDate(value, {
                month: "short",
                day: "numeric",
                year: variant === "ghost" ? "numeric" : undefined
              })}
            </span>
          ) : (
            variant === "ghost" && <Placeholder>{label}</Placeholder>
          )}
        </Pill>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Calendar
          aria-label={label}
          value={value ? parseDate(value) : null}
          onChange={(next) => {
            const nextValue = next?.toString() ?? null;
            if (nextValue !== value) submit(nextValue);
            setOpen(false);
          }}
        />
        {value && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              submit(null);
              setOpen(false);
            }}
          >
            <Trans>Clear</Trans>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Milestone ----------------------------------------------------------------

export function MilestonePill({
  projectId,
  elementId,
  milestoneId,
  milestones,
  variant,
  isDisabled
}: FieldPillProps & {
  milestoneId: string | null;
  milestones: ProjectMilestone[];
}) {
  const { t } = useLingui();
  const { pending, submit } = useElementField(
    projectId,
    elementId,
    "milestoneId"
  );
  const value = shown(pending, milestoneId);
  const milestone = milestones.find((m) => m.id === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change milestone`}
        >
          <LuFlag className="size-3 shrink-0" />
          {milestone ? (
            <span className="truncate">{milestone.name}</span>
          ) : (
            variant === "ghost" && (
              <Placeholder>
                <Trans>No milestone</Trans>
              </Placeholder>
            )
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => {
            if (next !== (value ?? "")) submit(next || null);
          }}
        >
          <DropdownMenuRadioItem value="">
            <Trans>No milestone</Trans>
          </DropdownMenuRadioItem>
          {milestones.length > 0 && <DropdownMenuSeparator />}
          {milestones.length > 0 && (
            <DropdownMenuLabel>
              <Trans>Milestones</Trans>
            </DropdownMenuLabel>
          )}
          {milestones.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <DropdownMenuIcon icon={<LuFlag />} />
              <span>{m.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- A choice from a fixed list -------------------------------------------------

/**
 * One value from a fixed list of options, saved through the update route.
 * With `noneLabel` the value can be cleared.
 */
export function ChoicePill({
  projectId,
  elementId,
  field,
  value: saved,
  options,
  noneLabel,
  placeholder,
  label,
  variant,
  isDisabled
}: FieldPillProps & {
  field: ProjectElementEditableField;
  value: string | null;
  options: { value: string; label: string }[];
  /** The label of the empty choice; without it the value cannot be cleared. */
  noneLabel?: string;
  /** Shown while no value is set. */
  placeholder: string;
  /** The accessible name of the trigger. */
  label: string;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const value = shown(pending, saved);
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill variant={variant} isDisabled={isDisabled} aria-label={label}>
          {current ? (
            <span className="truncate">{current.label}</span>
          ) : (
            <Placeholder>{placeholder}</Placeholder>
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => {
            if (next !== (value ?? "")) submit(next || null);
          }}
        >
          {noneLabel && (
            <DropdownMenuRadioItem value="">{noneLabel}</DropdownMenuRadioItem>
          )}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Hours and budget ---------------------------------------------------------

export function NumberPill({
  projectId,
  elementId,
  field,
  number,
  variant,
  isDisabled
}: FieldPillProps & {
  field: "estimatedHours" | "budget";
  number: number | null;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { pending, submit } = useElementField(projectId, elementId, field);
  const value = (() => {
    const raw = shown<number | string | null>(pending, number);
    return raw === null || raw === undefined ? null : Number(raw);
  })();

  const isHours = field === "estimatedHours";
  const label = isHours ? t`Estimated hours` : t`Budget`;
  const Icon = isHours ? LuClock : LuDollarSign;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill variant={variant} isDisabled={isDisabled} aria-label={label}>
          <Icon className="size-3 shrink-0" />
          {value !== null ? (
            <span className="whitespace-nowrap tabular-nums">
              {isHours
                ? t`${formatQuantity(value)} h`
                : formatMoney.format(value)}
            </span>
          ) : (
            variant === "ghost" && <Placeholder>{label}</Placeholder>
          )}
        </Pill>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <NumberField
          aria-label={label}
          autoFocus
          value={value ?? Number.NaN}
          minValue={0}
          formatOptions={
            isHours
              ? INPUT_FORMAT.quantity
              : INPUT_FORMAT.money(currency, decimals)
          }
          step={isHours ? INPUT_STEP.quantity : INPUT_STEP.money(decimals)}
          onChange={(next) => {
            const nextValue = Number.isNaN(next) ? null : next;
            if (nextValue !== value) {
              submit(nextValue === null ? null : String(nextValue));
            }
          }}
        >
          <NumberInput
            size="sm"
            className="tabular-nums"
            onKeyDown={(e) => {
              if (e.key === "Enter") setOpen(false);
            }}
          />
        </NumberField>
      </PopoverContent>
    </Popover>
  );
}
