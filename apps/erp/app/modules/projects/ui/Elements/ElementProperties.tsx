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
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import {
  LuCalendar,
  LuCalendarCheck,
  LuCheck,
  LuCirclePlus,
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
  usePermissions,
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
import { useElementRoutes } from "./ElementRoutes";

// --- Saving one field ---------------------------------------------------------

/** `labelIds` and `isBilling` have their own branches in the update route. */
export type ElementUpdateField =
  | ProjectElementEditableField
  | "labelIds"
  | "isBilling";

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
  const routes = useElementRoutes(projectId);
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
        action: withChangeRequest(routes.update, changeRequestId)
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

export type PillVariant = "pill" | "chip" | "ghost" | "icon" | "plain";

type PillProps = ComponentPropsWithoutRef<"button"> & {
  variant?: PillVariant;
  isDisabled?: boolean;
};

/**
 * The trigger of every property editor. A `pill` is a 24 px chip (the rows of
 * the Plan list). A `chip` is a pill that always names its value or its
 * placeholder (the New element modal, as in Linear). A `ghost` fills the
 * value column of the element sidebar. An `icon` is a bare square that shows
 * only the value's icon or avatar. A `plain` is borderless muted text (a list
 * row's date, as in Linear).
 */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(
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
        variant === "pill" || variant === "chip"
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

/** A `ghost` and a `chip` name an empty value; the others show only its icon. */
function isLabelled(variant: PillVariant | undefined) {
  return variant === "ghost" || variant === "chip";
}

function Placeholder({ children }: { children: ReactNode }) {
  return <span className="truncate text-muted-foreground">{children}</span>;
}

/**
 * A property editor that holds no element: it shows `value` and reports a
 * change through `onChange`, only when the value differs. Each `*Pill` below
 * binds one to an element's field; the New element modal uses them unbound.
 */
type ControlProps<T> = {
  value: T;
  onChange: (value: T) => void;
  variant?: PillVariant;
  isDisabled?: boolean;
};

type FieldPillProps = {
  projectId: string;
  elementId: string;
  variant?: PillVariant;
  isDisabled?: boolean;
};

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

/** The state a new element takes: the default Unstarted state, else the
 *  first Unstarted one — as `insertProjectElement` picks it. */
export function defaultElementState(states: ProjectState[]) {
  return [...states]
    .filter((state) => state.group === "Unstarted")
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder
    )[0];
}

export function StateControl({
  value,
  onChange,
  states,
  variant,
  isDisabled
}: ControlProps<string> & { states: ProjectState[] }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const state = states.find((s) => s.id === value);
  const sorted = useMemo(() => sortStates(states), [states]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pill
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
            if (next !== value) onChange(next);
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

export function StatePill({
  projectId,
  elementId,
  stateId,
  ...props
}: FieldPillProps & { stateId: string; states: ProjectState[] }) {
  const { pending, submit } = useElementField(projectId, elementId, "stateId");
  return (
    <StateControl
      {...props}
      value={shown(pending, stateId) ?? stateId}
      onChange={submit}
    />
  );
}

// --- Owner --------------------------------------------------------------------

export function OwnerControl({
  value,
  onChange,
  variant,
  isDisabled
}: ControlProps<string | null>) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [people] = usePeople();
  const user = useUser();

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
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change owner`}
        >
          {value ? (
            <EmployeeAvatar
              employeeId={value}
              size={variant === "icon" ? "xs" : "xxs"}
              withName={isLabelled(variant)}
            />
          ) : (
            <>
              <LuUser className="size-3 shrink-0" />
              {isLabelled(variant) && (
                <Placeholder>
                  {variant === "chip" ? (
                    <Trans>Owner</Trans>
                  ) : (
                    <Trans>No owner</Trans>
                  )}
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
                      onChange(option.value || null);
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

export function OwnerPill({
  projectId,
  elementId,
  ownerId,
  ...props
}: FieldPillProps & { ownerId: string | null }) {
  const { pending, submit } = useElementField(projectId, elementId, "ownerId");
  return (
    <OwnerControl
      {...props}
      value={shown(pending, ownerId)}
      onChange={submit}
    />
  );
}

// --- Priority -----------------------------------------------------------------

/** `className` lands on the root, so `DropdownMenuIcon` can space it. */
export function ElementPriorityIcon({
  priority,
  className
}: {
  priority: ProjectElementPriority;
  className?: string;
}) {
  if (priority === "None") {
    return (
      <LuMinus
        className={cn("size-3 shrink-0 text-muted-foreground", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-3 shrink-0 items-center justify-center",
        className
      )}
    >
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

export function PriorityControl({
  value,
  onChange,
  variant,
  isDisabled
}: ControlProps<ProjectElementPriority>) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const labels = usePriorityLabels();

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Pill
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change priority`}
        >
          <ElementPriorityIcon priority={value} />
          {value !== "None" ? (
            <span className="truncate">{labels[value]}</span>
          ) : variant === "chip" ? (
            <Placeholder>
              <Trans>Priority</Trans>
            </Placeholder>
          ) : (
            variant === "ghost" && (
              <span className="truncate">{labels[value]}</span>
            )
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next !== value) onChange(next as ProjectElementPriority);
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

export function PriorityPill({
  projectId,
  elementId,
  priority,
  ...props
}: FieldPillProps & { priority: ProjectElementPriority }) {
  const { pending, submit } = useElementField(projectId, elementId, "priority");
  return (
    <PriorityControl
      {...props}
      value={shown(pending, priority) ?? "None"}
      onChange={submit}
    />
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

/**
 * Creates a company label by name from a labels picker, then hands its id to
 * `onCreated`. Null without permission to create one (projects create, the
 * label's RLS rule): the picker then offers no "Create" row.
 */
export function useCreateProjectLabel() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const onCreatedRef = useRef<((id: string) => void) | null>(null);
  const fetcher = useAction<{ id?: string; error?: { message: string } }>({
    onSuccess: (data) => {
      if (data.id) onCreatedRef.current?.(data.id);
      onCreatedRef.current = null;
    },
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to create the label`)
  });
  if (!permissions.can("create", "projects")) return null;
  return (name: string, onCreated: (id: string) => void) => {
    onCreatedRef.current = onCreated;
    fetcher.submit(
      { name },
      { method: "post", action: path.to.newProjectLabel }
    );
  };
}

export function LabelsControl({
  value,
  onChange,
  labels,
  variant,
  isDisabled
}: ControlProps<string[]> & { labels: ProjectLabel[] }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const createLabel = useCreateProjectLabel();
  const selected = labels.filter((l) => value.includes(l.id));
  const name = search.trim();
  const canCreate =
    !!createLabel &&
    name.length > 0 &&
    !labels.some((l) => l.name.toLowerCase() === name.toLowerCase());

  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill
          variant={variant}
          isDisabled={isDisabled}
          aria-label={t`Change labels`}
        >
          {selected.length === 0 ? (
            <>
              <LuTag className="size-3 shrink-0" />
              {isLabelled(variant) && (
                <Placeholder>
                  {variant === "chip" ? (
                    <Trans>Labels</Trans>
                  ) : (
                    <Trans>No labels</Trans>
                  )}
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
          <CommandInput
            placeholder={createLabel ? t`Search or create...` : t`Search...`}
            className="h-9"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {createLabel ? (
                <Trans>Type a name to create a label.</Trans>
              ) : (
                <Trans>No labels yet. Add them in Settings → Projects.</Trans>
              )}
            </CommandEmpty>
            <CommandGroup>
              {canCreate && (
                // Its value is the search itself, so the filter keeps it.
                <CommandItem
                  value={name}
                  className="gap-2"
                  onSelect={() => {
                    createLabel(name, (id) => onChange([...value, id]));
                    setSearch("");
                  }}
                >
                  <LuCirclePlus className="size-4 shrink-0" />
                  <span className="truncate">
                    <Trans>Create {name}</Trans>
                  </span>
                </CommandItem>
              )}
              {labels.map((label) => (
                <CommandItem
                  key={label.id}
                  value={label.name}
                  className="gap-2"
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

export function LabelsPill({
  projectId,
  elementId,
  labelIds,
  ...props
}: FieldPillProps & { labelIds: string[]; labels: ProjectLabel[] }) {
  const { pending, submit } = useElementField(projectId, elementId, "labelIds");
  const value =
    pending === undefined
      ? labelIds
      : pending === null
        ? []
        : pending.split(",");
  return (
    <LabelsControl
      {...props}
      value={value}
      onChange={(next) => submit(next.length > 0 ? next.join(",") : null)}
    />
  );
}

// --- Dates --------------------------------------------------------------------

export function DateControl({
  value,
  onChange,
  field,
  isComplete,
  variant,
  isDisabled
}: ControlProps<string | null> & {
  field: "startDate" | "targetDate";
  /** A completed element is never late. */
  isComplete?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const today = useCompanyToday();
  const { formatDate } = useDateFormatter();
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
            isLabelled(variant) && <Placeholder>{label}</Placeholder>
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
            if (nextValue !== value) onChange(nextValue);
            setOpen(false);
          }}
        />
        {value && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              onChange(null);
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

export function DatePill({
  projectId,
  elementId,
  field,
  date,
  ...props
}: FieldPillProps & {
  field: "startDate" | "targetDate";
  date: string | null;
  /** A completed element is never late. */
  isComplete?: boolean;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  return (
    <DateControl
      {...props}
      field={field}
      value={shown(pending, date)}
      onChange={submit}
    />
  );
}

// --- Milestone ----------------------------------------------------------------

export function MilestoneControl({
  value,
  onChange,
  milestones,
  variant,
  isDisabled
}: ControlProps<string | null> & { milestones: ProjectMilestone[] }) {
  const { t } = useLingui();
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
            isLabelled(variant) && (
              <Placeholder>
                {variant === "chip" ? (
                  <Trans>Milestone</Trans>
                ) : (
                  <Trans>No milestone</Trans>
                )}
              </Placeholder>
            )
          )}
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => {
            if (next !== (value ?? "")) onChange(next || null);
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

export function MilestonePill({
  projectId,
  elementId,
  milestoneId,
  ...props
}: FieldPillProps & {
  milestoneId: string | null;
  milestones: ProjectMilestone[];
}) {
  const { pending, submit } = useElementField(
    projectId,
    elementId,
    "milestoneId"
  );
  return (
    <MilestoneControl
      {...props}
      value={shown(pending, milestoneId)}
      onChange={submit}
    />
  );
}

// --- Hours and budget ---------------------------------------------------------

export function NumberControl({
  value,
  onChange,
  field,
  variant,
  isDisabled
}: ControlProps<number | null> & { field: "estimatedHours" | "budget" }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();

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
            isLabelled(variant) && <Placeholder>{label}</Placeholder>
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
            if (nextValue !== value) onChange(nextValue);
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

export function NumberPill({
  projectId,
  elementId,
  field,
  number,
  ...props
}: FieldPillProps & {
  field: "estimatedHours" | "budget";
  number: number | null;
}) {
  const { pending, submit } = useElementField(projectId, elementId, field);
  const raw = shown<number | string | null>(pending, number);
  return (
    <NumberControl
      {...props}
      field={field}
      value={raw === null || raw === undefined ? null : Number(raw)}
      onChange={(next) => submit(next === null ? null : String(next))}
    />
  );
}
