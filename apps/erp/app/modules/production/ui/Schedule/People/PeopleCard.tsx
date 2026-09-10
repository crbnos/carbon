import {
  cn,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatTimeOfDay } from "@carbon/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import {
  LuChevronRight,
  LuGripVertical,
  LuStickyNote,
  LuTriangleAlert
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { PeoplePill } from "./PeopleChip";
import type { PeopleAssignment, PeopleEmployee } from "./peopleShared";

/** page context the Working-hours editor needs on every card */
export type CardEditorContext = {
  date: string;
  shiftId: string | null;
  locationId: string;
  workCenters: { id: string; name: string }[];
};

export type PeopleCardItem = {
  employee: PeopleEmployee;
  assignment: PeopleAssignment | null;
  isAbsent: boolean;
  absenceId: string | null;
  missingAbilities: string[];
  /** the person's qualified (non-expired) abilities — badged on the card */
  abilities: string[];
  /** remaining unallocated hours (pool card of a partially-assigned person) */
  freeHours: number | null;
  /** hours this card occupies at its station (explicit or shift-derived) */
  displayHours: number | null;
  /** the person's whole day (all stations) — the Working-hours editor input */
  dayRows: {
    workCenterId: string;
    hours: number | null;
  }[];
  /** day-scoped overtime (max across the day's rows — never their sum) */
  overtimeHours: number;
  /** shift-ladder hours for this person/day */
  baseHours: number;
  /** "HH:MM" start of the person's day, for the editor's time echo */
  dayStartTime: string | null;
  /** "HH:MM" end of the person's shift, for the card's shift window */
  dayEndTime: string | null;
  /** day-scoped note (first non-empty across the day's rows) */
  note: string | null;
};

/** stable sortable/React id — assignment cards are keyed by the ROW, so one
 * person can appear in several columns (split days) */
export function cardId(item: PeopleCardItem) {
  if (item.assignment && !item.isAbsent) return item.assignment.id;
  return `${item.isAbsent ? "absent" : "free"}:${item.employee.id}`;
}

export function PeopleCard({
  item,
  editor,
  isOverlay,
  isDisabled,
  onOpen
}: {
  item: PeopleCardItem;
  editor: CardEditorContext;
  isOverlay?: boolean;
  isDisabled?: boolean;
  onOpen: (item: PeopleCardItem) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: cardId(item),
    data: { type: "item", item },
    // the overlay clone must not register as a sortable — it would inherit the
    // active card's drag transform/state and render as a ghost
    disabled: isOverlay || isDisabled || item.isAbsent
  });

  const style = isOverlay
    ? undefined
    : {
        transition,
        transform: CSS.Translate.toString(transform)
      };

  const stationName = (id: string) =>
    editor.workCenters.find((wc) => wc.id === id)?.name ?? id;

  // split day: this card's station is one of several
  const isSplit = item.assignment != null && item.dayRows.length > 1;
  const otherStations = isSplit
    ? item.dayRows.filter(
        (row) => row.workCenterId !== item.assignment!.workCenterId
      )
    : [];

  const shiftWindow =
    item.dayStartTime && item.dayEndTime
      ? `${formatTimeOfDay(item.dayStartTime, locale)} – ${formatTimeOfDay(
          item.dayEndTime,
          locale
        )}`
      : null;

  // the shift window is the card's anchor fact — it always shows; a split day
  // and a note are additions to it, never replacements
  const otherStationNames = otherStations
    .map((row) => stationName(row.workCenterId))
    .join(", ");

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      onClick={() => {
        if (!isOverlay && !isDisabled) onOpen(item);
      }}
      className={cn(
        // the schedule board's card shell, so both boards read the same
        "flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-[0.5px] bg-card px-3 py-2 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
        // the card body opens the editor; only the grip drags
        !isDisabled && !isOverlay && "cursor-pointer",
        isDragging && !isOverlay && "border-dashed bg-muted",
        isOverlay &&
          "ring-2 ring-primary opacity-100 !bg-card shadow-lg cursor-grabbing",
        item.isAbsent && "opacity-60"
      )}
    >
      {/* drag lives on the handle only — the rest of the card is tap-to-open.
          Ghost variant so it picks up the same hover fill as the schedule
          board's grip, but kept 44px tall for tablets. */}
      {!isDisabled && !item.isAbsent && (
        <IconButton
          aria-label={t`Drag to assign`}
          variant="ghost"
          icon={<LuGripVertical />}
          className={cn(
            "-ml-1.5 h-11 w-9 flex-shrink-0 touch-none text-muted-foreground/50 hover:text-muted-foreground",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onClick={(e) => e.stopPropagation()}
          {...(isOverlay ? {} : { ...attributes, ...listeners })}
        />
      )}
      {/* EmployeeAvatar hardcodes `truncate` and ignores className, so it
          clips instead of holding its size — pin it from the outside */}
      <div className="flex-shrink-0">
        <EmployeeAvatar
          employeeId={item.employee.id}
          withName={false}
          size="sm"
        />
      </div>
      <div className="min-w-[7rem] flex-1">
        <p className="truncate text-sm font-medium">{item.employee.name}</p>
        {/* one fact per line — nothing shares a row, so nothing truncates */}
        {!item.isAbsent && shiftWindow && (
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {shiftWindow}
          </p>
        )}
        {otherStationNames && (
          <p className="truncate text-xs text-muted-foreground">
            <Trans>also at {otherStationNames}</Trans>
          </p>
        )}
        {item.note && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <LuStickyNote className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{item.note}</span>
          </p>
        )}
        {/* what this person is qualified to do — an intrinsic property, so it
            shows even when they're absent */}
        {item.abilities.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.abilities.map((ability) => (
              <span
                key={ability}
                className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {ability}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
        {item.freeHours != null && !item.isAbsent && (
          <PeoplePill tone="emerald" tooltip={t`Hours not yet assigned`}>
            <Trans>{item.freeHours}h free</Trans>
          </PeoplePill>
        )}
        {item.assignment && item.displayHours != null && !item.isAbsent && (
          // only THIS station's hours — never "x of the shift", which reads as
          // under-scheduled on each half of a split day
          <PeoplePill tone="blue" tooltip={t`Hours at this station`}>
            {item.displayHours}h
          </PeoplePill>
        )}
        {item.overtimeHours > 0 && !item.isAbsent && (
          <PeoplePill
            tone="amber"
            tooltip={t`Authorized overtime on top of the shift`}
          >
            +{item.overtimeHours}h
          </PeoplePill>
        )}
        {item.missingAbilities.length > 0 && !item.isAbsent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-amber-500">
                <LuTriangleAlert />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t`Missing:`} {item.missingAbilities.join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
        {/* Absent is state only here — flipping it lives in the day editor,
            so the row stays readable when hours and overtime are also shown */}
        {item.isAbsent && (
          <PeoplePill tone="red" tooltip={t`Not working today`}>
            <Trans>Absent</Trans>
          </PeoplePill>
        )}
        {!isDisabled && !isOverlay && (
          <LuChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
        )}
      </div>
    </div>
  );
}
