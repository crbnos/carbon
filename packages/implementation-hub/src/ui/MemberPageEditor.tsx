// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A person's page as Carbon staff define it: one table, a row per card, each
// row a short read-only summary. A row opens its card in a modal, where its
// fields are edited and saved together: the page's own fields (title, note,
// due date, custom fields, a file request) save the whole page
// (`PageEditor.save`); a company item's own fields (its title cell, a
// question's options, a customization's status, type of work, estimate and
// the requirement it serves) update the item, which every page that shows it
// reads. The page title and introduction are edited in place. A page shows no
// sections: the editor keeps every card in the first one (`singleSection`).

import {
  Button,
  Combobox,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from "@carbon/react";
import {
  type CalendarDate,
  getLocalTimeZone,
  parseDate,
  today
} from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuEllipsisVertical,
  LuLink,
  LuListChecks,
  LuPaperclip,
  LuPencil,
  LuPlus,
  LuTrash2,
  LuX
} from "react-icons/lu";
import {
  CUSTOMIZATION_KINDS,
  CUSTOMIZATION_STATUSES
} from "../content/customization";
import { PAGE_CARD_KIND_LABEL } from "../content/page";
import { isOverdue } from "../logic/assignments";
import {
  CUSTOMIZATION_KIND_KEYS,
  isCustomizationKind,
  parseEstimateDays,
  readCustomization
} from "../logic/customization";
import {
  buildPageCatalogue,
  cardChecklists,
  cardState,
  catalogueByItem,
  checklistProgress,
  type PageCard,
  type PageCatalogueEntry,
  pageCards,
  pageProgress,
  type RequirementChoice,
  requirementChoices,
  resolveMemberPage,
  takesDueDate
} from "../logic/page";
import {
  type CardPatch,
  customKeys,
  editCard,
  editPage,
  isPageRowCollection,
  moveCard,
  newCustomKey,
  PAGE_ROW_FIELDS,
  type PageRowCollection,
  type PageTarget,
  pageCardIds,
  parseOptionLines,
  placeCard,
  removeCard,
  singleSection
} from "../logic/page-edit";
import { readQuestion } from "../logic/question";
import {
  type MemberPage,
  type MemberPageCard,
  type MemberPageField,
  memberPageCustomCardValidator,
  PAGE_CARD_MAX_FIELDS,
  PAGE_CHECKLIST_MAX_POINTS
} from "../models";
import type { CustomizationStatus, ImplementationRowData } from "../types";
import { CardStatus } from "./PageCardParts";
import { CardFiles, usePageFilesByCard } from "./PageFiles";
import {
  CardTitle,
  CardTypeLabel,
  DueBadge,
  MetaChip,
  NoValue,
  PageCell,
  PageRow,
  PageTable,
  useCardText
} from "./PageTable";
import { EditableInput, EvidenceCount } from "./primitives";
import { ProgressPill } from "./ProgressPill";
import {
  useCheckMap,
  useCounts,
  useHub,
  useHubActions,
  useResolveScreenUrl
} from "./state";

// How the editor saves. The app supplies it: each call is one request, and a
// later save carries every earlier change, so a save the app cancels for a
// newer one loses nothing.
export interface PageEditor {
  // Save the whole page; the server checks it again.
  save: (page: MemberPage) => void;
  // Create a company item and put it on the page, in one request.
  addItem: (
    collection: PageRowCollection,
    payload: Record<string, unknown>,
    page: MemberPage,
    target: PageTarget
  ) => void;
}

// Every new card goes at the end of the page's one section.
const END_OF_PAGE: PageTarget = { section: 0 };

const isPageLink = (link: string) =>
  memberPageCustomCardValidator.shape.link.safeParse(link).success;

function toCalendarDate(value: string | undefined): CalendarDate | null {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

// A company row's payload with a patch applied: a cell is kept when it has a
// value and dropped when it is cleared.
function patchPayload(
  payload: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  for (const [key, value] of Object.entries(patch)) {
    const empty =
      value === undefined ||
      value === false ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = typeof value === "string" ? value.trim() : value;
  }
  return next;
}

export function MemberPageEditor({
  page: filePage,
  memberId,
  memberName,
  editor
}: {
  page: MemberPage;
  memberId: string;
  memberName?: string;
  editor: PageEditor;
}) {
  const { t } = useLingui();
  const rows = useHub((s) => s.rows);
  const states = useCheckMap();
  const actions = useHubActions();
  const catalogue = useMemo(() => buildPageCatalogue(rows), [rows]);
  const items = useMemo(() => catalogueByItem(catalogue), [catalogue]);
  // The page as the editor shows it and saves it: every card in one list.
  const page = useMemo(() => singleSection(filePage), [filePage]);
  const sections = useMemo(
    () => resolveMemberPage(page, items, memberId),
    [page, items, memberId]
  );
  const cards = useMemo(() => pageCards(sections), [sections]);
  const fileCards = page.sections[0]?.cards ?? [];
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  );
  const progress = pageProgress(sections, states, rowsById);
  const requirements = useMemo(
    () => requirementChoices(catalogue, states),
    [catalogue, states]
  );
  const todayIso = today(getLocalTimeZone()).toString();

  const [adding, setAdding] = useState(false);
  // The card open in a modal. It stays chosen after the modal closes, so the
  // modal keeps its content while it animates out.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const save = (next: MemberPage | null) => {
    if (next) editor.save(next);
  };
  const indexOf = (id: string) => cards.findIndex((card) => card.id === id);

  const editing = editingId ? cards[indexOf(editingId)] : undefined;
  const editingFileCard = editingId ? fileCards[indexOf(editingId)] : undefined;
  const deleting = deletingId ? cards[indexOf(deletingId)] : undefined;
  const deletingRow = deleting?.rowId
    ? rowsById.get(deleting.rowId)
    : undefined;
  const text = useCardText();

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-1 min-w-0 max-w-2xl flex-col gap-2">
          <EditableInput
            value={page.title ?? ""}
            placeholder={memberName ?? t`Page title`}
            className="text-lg"
            onCommit={(title) => save(editPage(page, { title }))}
          />
          <EditableInput
            value={page.intro ?? ""}
            placeholder={t`An introduction for this person (optional)`}
            variant="muted"
            multiline
            onCommit={(intro) => save(editPage(page, { intro }))}
          />
        </div>
        <ProgressPill
          done={progress.done}
          total={progress.total}
          label={t`done`}
        />
      </header>

      {cards.length ? (
        <PageTable
          headers={[
            { key: "type", label: t`Type`, className: "w-28" },
            { key: "card", label: t`Card`, className: "min-w-56" },
            { key: "details", label: t`Details`, className: "w-56" },
            { key: "note", label: t`Note`, className: "w-40" },
            { key: "due", label: t`Due`, className: "w-28" },
            { key: "status", label: t`Status`, className: "w-28" },
            { key: "menu", label: "", className: "w-10" }
          ]}
        >
          {cards.map((card, index) => (
            <StaffRow
              key={card.id}
              card={card}
              row={card.rowId ? rowsById.get(card.rowId) : undefined}
              memberId={memberId}
              todayIso={todayIso}
              position={{
                first: index === 0,
                last: index === cards.length - 1
              }}
              onEdit={() => {
                setEditingId(card.id);
                setEditOpen(true);
              }}
              onMove={(offset) => save(moveCard(page, 0, index, offset))}
              onRemove={() => save(removeCard(page, 0, index))}
              onDelete={() => {
                setDeletingId(card.id);
                setDeleteOpen(true);
              }}
            />
          ))}
        </PageTable>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          <Trans>Nothing on this page yet.</Trans>
        </p>
      )}

      <div>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          onClick={() => setAdding(true)}
        >
          <Trans>Add card</Trans>
        </Button>
      </div>

      <AddCardModal
        open={adding}
        page={page}
        catalogue={catalogue}
        editor={editor}
        onClose={() => setAdding(false)}
      />
      {editing && editingFileCard ? (
        <CardEditModal
          open={editOpen}
          card={editing}
          pageCard={editingFileCard}
          entry={
            editingFileCard.item ? items.get(editingFileCard.item) : undefined
          }
          row={editing.rowId ? rowsById.get(editing.rowId) : undefined}
          requirements={requirements}
          canDue={takesDueDate(editing, states, rowsById)}
          onSave={(patch, rowPayload) => {
            const index = indexOf(editing.id);
            if (index >= 0) {
              const next = editCard(page, 0, index, patch);
              if (JSON.stringify(next) !== JSON.stringify(page)) save(next);
            }
            if (rowPayload && editing.rowId) {
              actions.updateRow(editing.rowId, rowPayload);
            }
            setEditOpen(false);
          }}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
      {deleting ? (
        <ConfirmModal
          open={deleteOpen && Boolean(deletingRow)}
          title={t`Delete ${text(deleting.title) ?? ""}`}
          text={t`The item is deleted from the Implementation Hub and leaves this page. Other pages that show it will show it as removed until it is taken off them.`}
          confirm={t`Delete`}
          onConfirm={() => {
            // Off the page and out of the hub together: the page saved
            // without the card is valid whichever lands first.
            const index = indexOf(deleting.id);
            if (index >= 0) save(removeCard(page, 0, index));
            if (deletingRow) actions.deleteRow(deletingRow.id);
            setDeleteOpen(false);
          }}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </div>
  );
}

function StaffRow({
  card,
  row,
  memberId,
  todayIso,
  position,
  onEdit,
  onMove,
  onRemove,
  onDelete
}: {
  card: PageCard;
  row: ImplementationRowData | undefined;
  memberId: string;
  todayIso: string;
  position: { first: boolean; last: boolean };
  onEdit: () => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const text = useCardText();
  const states = useCheckMap();
  const rowsById = useMemo(() => new Map(row ? [[row.id, row]] : []), [row]);
  const state = cardState(card, states, rowsById);
  const due = state.done !== null ? card.due : undefined;
  const overdue = state.done !== null && isOverdue(due, state.done, todayIso);
  const title = text(card.title) ?? "";
  const group = card.kind === "objective" ? undefined : text(card.group);

  return (
    <PageRow done={Boolean(state.done)}>
      <PageCell>
        <CardTypeLabel card={card} group={group} />
      </PageCell>
      <PageCell wide>
        <CardTitle
          title={title}
          detail={text(card.detail)}
          done={Boolean(state.done)}
          onOpen={onEdit}
          openLabel={t`Edit ${title}`}
        />
      </PageCell>
      <PageCell wide>
        <CardSummary card={card} row={row} memberId={memberId} />
      </PageCell>
      <PageCell wide>
        {card.note ? (
          <span className="line-clamp-2 text-xs text-muted-foreground text-pretty">
            {card.note}
          </span>
        ) : (
          <NoValue />
        )}
      </PageCell>
      <PageCell>
        <DueBadge due={due} overdue={overdue} />
      </PageCell>
      <PageCell controls>
        <CardStatus card={card} on={state.on} row={row} memberId={memberId} />
      </PageCell>
      <PageCell controls className="max-md:ml-auto">
        <CardMenu
          title={title}
          position={position}
          canDelete={Boolean(row)}
          onEdit={onEdit}
          onMove={onMove}
          onRemove={onRemove}
          onDelete={onDelete}
        />
      </PageCell>
    </PageRow>
  );
}

// What a card holds beyond its title, in a line or two: a question's options
// and its answer, a customization's estimate, its link, its evidence, its
// fields and checklists, its files.
function CardSummary({
  card,
  row,
  memberId
}: {
  card: PageCard;
  row: ImplementationRowData | undefined;
  memberId: string;
}) {
  const { t } = useLingui();
  const text = useCardText();
  const states = useCheckMap();
  const counts = useCounts();
  const resolveScreenUrl = useResolveScreenUrl();
  const files = usePageFilesByCard().get(card.id) ?? [];
  const chips: ReactNode[] = [];
  let answer: string | undefined;

  if (card.missing) {
    chips.push(
      <MetaChip key="missing" tone="attention">
        <Trans>Removed from the Implementation Hub</Trans>
      </MetaChip>
    );
  }
  const question =
    card.kind === "question" && row ? readQuestion(row.payload) : null;
  if (question) {
    chips.push(
      <MetaChip key="question">
        {question.options ? (
          <Plural
            value={question.options.length}
            one="# option"
            other="# options"
          />
        ) : question.longAnswer ? (
          <Trans>Long answer</Trans>
        ) : (
          <Trans>Typed answer</Trans>
        )}
      </MetaChip>
    );
    if (question.multiple) {
      chips.push(
        <MetaChip key="multiple">
          <Trans>Pick several</Trans>
        </MetaChip>
      );
    }
    answer = question.selected?.length
      ? question.selected
          .map((choice) => (choice === "?" ? t`Not sure` : choice))
          .join(", ")
      : question.answer;
  }
  const customization =
    card.kind === "customization" && row
      ? readCustomization(row.payload)
      : null;
  if (customization?.estimateDays !== undefined) {
    chips.push(
      <MetaChip key="estimate">
        <Plural value={customization.estimateDays} one="# day" other="# days" />
      </MetaChip>
    );
  }
  if (card.href) {
    chips.push(
      <MetaChip key="link" icon={<LuLink className="size-3" />}>
        <span className="max-w-40 truncate">{card.href}</span>
      </MetaChip>
    );
  }
  for (const evidence of card.evidence) {
    chips.push(
      <span key={evidence.count} className="relative z-10">
        <EvidenceCount
          count={counts[evidence.count]}
          label={text(evidence.label) ?? ""}
          href={card.screenKey ? resolveScreenUrl(card.screenKey) : undefined}
        />
      </span>
    );
  }
  for (const [index, field] of (card.fields ?? []).entries()) {
    if ("value" in field) {
      chips.push(
        <MetaChip key={`field-${index}`}>
          <span className="max-w-48 truncate">
            {field.label}: {field.value}
          </span>
        </MetaChip>
      );
    }
  }
  for (const [index, checklist] of cardChecklists(card, memberId).entries()) {
    const progress = checklistProgress([checklist], states);
    chips.push(
      <MetaChip
        key={`checklist-${index}`}
        icon={<LuListChecks className="size-3" />}
      >
        <span className="max-w-40 truncate">{checklist.label}</span>{" "}
        <span className="tabular-nums">
          {progress.ticked}/{progress.total}
        </span>
      </MetaChip>
    );
  }
  if (card.askForFile || files.length) {
    chips.push(
      <MetaChip key="files" icon={<LuPaperclip className="size-3" />}>
        {files.length ? (
          <Plural value={files.length} one="# file" other="# files" />
        ) : (
          <Trans>Asks for a file</Trans>
        )}
      </MetaChip>
    );
  }

  if (chips.length === 0 && !answer) {
    return <NoValue />;
  }
  return (
    <div className="flex flex-col gap-1">
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      ) : null}
      {answer ? (
        <span className="line-clamp-2 text-xs text-pretty">
          <span className="text-muted-foreground">
            <Trans>Answer:</Trans>
          </span>{" "}
          {answer}
        </span>
      ) : null}
    </div>
  );
}

function CardMenu({
  title,
  position,
  canDelete,
  onEdit,
  onMove,
  onRemove,
  onDelete
}: {
  title: string;
  position: { first: boolean; last: boolean };
  canDelete: boolean;
  onEdit: () => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`Options for ${title}`}
          icon={<LuEllipsisVertical />}
          variant="ghost"
          size="sm"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onClick={onEdit}>
          <DropdownMenuIcon icon={<LuPencil />} />
          <Trans>Edit card</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={position.first} onClick={() => onMove(-1)}>
          <DropdownMenuIcon icon={<LuArrowUp />} />
          <Trans>Move up</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={position.last} onClick={() => onMove(1)}>
          <DropdownMenuIcon icon={<LuArrowDown />} />
          <Trans>Move down</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRemove}>
          <DropdownMenuIcon icon={<LuX />} />
          <Trans>Remove from page</Trans>
        </DropdownMenuItem>
        {canDelete ? (
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <DropdownMenuIcon icon={<LuTrash2 />} />
            <Trans>Delete item…</Trans>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A field as staff edit it: a value, or a checklist's points one per line.
interface DraftField {
  id: number;
  type: "text" | "checklist";
  label: string;
  value: string;
  points: string;
}

const toDraftFields = (fields: MemberPageField[] | undefined): DraftField[] =>
  (fields ?? []).map((field, id) =>
    "points" in field
      ? {
          id,
          type: "checklist",
          label: field.label,
          value: "",
          points: field.points.join("\n")
        }
      : { id, type: "text", label: field.label, value: field.value, points: "" }
  );

const fromDraftFields = (drafts: DraftField[]): MemberPageField[] =>
  drafts.map((draft) =>
    draft.type === "checklist"
      ? { label: draft.label, points: parseOptionLines(draft.points) }
      : { label: draft.label, value: draft.value }
  );

function CardEditModal({
  open,
  onClose,
  ...form
}: CardEditFormProps & { open: boolean }) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* The form is inside the content, so it starts from the card each time
          the modal opens. */}
      <ModalContent size="xlarge">
        <CardEditForm {...form} onClose={onClose} />
      </ModalContent>
    </Modal>
  );
}

interface CardEditFormProps {
  card: PageCard;
  pageCard: MemberPageCard;
  entry: PageCatalogueEntry | undefined;
  row: ImplementationRowData | undefined;
  requirements: RequirementChoice[];
  canDue: boolean;
  // The page's own changes, and the item's new payload when it changed.
  onSave: (
    patch: CardPatch,
    rowPayload: Record<string, unknown> | null
  ) => void;
  onClose: () => void;
}

function CardEditForm({
  card,
  pageCard,
  entry,
  row,
  requirements,
  canDue,
  onSave,
  onClose
}: CardEditFormProps) {
  const { t, i18n } = useLingui();
  const text = useCardText();
  const collection =
    row && isPageRowCollection(row.collection) ? row.collection : null;
  const rowFields = collection ? PAGE_ROW_FIELDS[collection] : null;
  const payload = row?.payload ?? {};
  const cell = (key: string | undefined) =>
    key && typeof payload[key] === "string" ? (payload[key] as string) : "";
  const question = collection === "question" ? readQuestion(payload) : null;
  const customization =
    collection === "customization" ? readCustomization(payload) : null;
  const custom = pageCard.custom;
  const ownTitle = text(entry?.title) ?? "";

  // The draft, from the card as the modal opened on it.
  const [title, setTitle] = useState(
    custom
      ? custom.title
      : rowFields
        ? cell(rowFields.title)
        : (pageCard.title ?? ownTitle)
  );
  const [detail, setDetail] = useState(
    custom ? (custom.text ?? "") : cell(rowFields?.detail)
  );
  const [link, setLink] = useState(
    custom ? (custom.link ?? "") : cell(rowFields?.link)
  );
  const [options, setOptions] = useState((question?.options ?? []).join("\n"));
  const [multiple, setMultiple] = useState(Boolean(question?.multiple));
  const [longAnswer, setLongAnswer] = useState(Boolean(question?.longAnswer));
  const [status, setStatus] = useState<CustomizationStatus>(
    customization?.status ?? "proposed"
  );
  const [workType, setWorkType] = useState(
    isCustomizationKind(payload.kind) ? payload.kind : NOT_SET
  );
  const [estimate, setEstimate] = useState(
    customization?.estimateDays === undefined
      ? ""
      : String(customization.estimateDays)
  );
  const [serves, setServes] = useState(
    customization?.requirementRowId ?? NOT_SET
  );
  const [note, setNote] = useState(pageCard.note ?? "");
  const [due, setDue] = useState<CalendarDate | null>(
    toCalendarDate(pageCard.due)
  );
  const [askForFile, setAskForFile] = useState(Boolean(pageCard.askForFile));
  const [fields, setFields] = useState(() => toDraftFields(pageCard.fields));
  const [error, setError] = useState<string | null>(null);

  const hasDetail = Boolean(custom || rowFields?.detail);
  const hasLink = Boolean(custom || rowFields?.link);
  const choices = parseOptionLines(options);

  // The in-scope requirements, and the one it serves when that is out of
  // scope or deleted.
  const served = customization?.requirementRowId;
  const servesChoices = requirements.flatMap((choice) =>
    choice.inScope
      ? [{ id: choice.id, label: text(choice.title) ?? choice.id }]
      : choice.id === served
        ? [
            {
              id: choice.id,
              label: `${text(choice.title) ?? choice.id} (${t`out of scope`})`
            }
          ]
        : []
  );
  if (served && !requirements.some((choice) => choice.id === served)) {
    servesChoices.unshift({ id: served, label: t`A removed requirement` });
  }

  const setField = (id: number, patch: Partial<DraftField>) =>
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );

  const submit = () => {
    if ((custom || rowFields) && !title.trim()) {
      setError(t`Give the card a title`);
      return;
    }
    if (hasLink && link.trim() && !isPageLink(link.trim())) {
      setError(t`Use a Carbon path starting with /x/, or an https link`);
      return;
    }
    // A date still being typed reads as year 2 until its year is whole.
    if (canDue && due && due.year < 1000) {
      setError(t`Enter the due date in full`);
      return;
    }
    const days = parseEstimateDays(estimate);
    if (customization && estimate.trim() && days === undefined) {
      setError(t`Enter the estimate as a number of days`);
      return;
    }
    for (const field of fields) {
      const content = field.type === "checklist" ? field.points : field.value;
      if (Boolean(field.label.trim()) !== Boolean(content.trim())) {
        setError(t`Give every field a label and a value`);
        return;
      }
      const points = parseOptionLines(field.points);
      if (
        field.type === "checklist" &&
        points.length > PAGE_CHECKLIST_MAX_POINTS
      ) {
        setError(
          t`A checklist takes up to ${PAGE_CHECKLIST_MAX_POINTS} points`
        );
        return;
      }
      if (
        field.type === "checklist" &&
        points.some((point) => point.length > 500)
      ) {
        setError(t`Keep each point under 500 characters`);
        return;
      }
    }

    // The page's own fields.
    const patch: CardPatch = {
      note,
      due: canDue && due ? due.toString() : "",
      askForFile,
      fields: fromDraftFields(fields)
    };
    if (custom) {
      patch.title = title;
      patch.text = detail;
      patch.link = link;
    } else if (rowFields) {
      // The item's own title shows from now on, not one this page set.
      if (pageCard.title) patch.title = "";
    } else {
      // A hub item's title on this page: the item's own when it is cleared
      // or typed back.
      patch.title = title.trim() === ownTitle ? "" : title;
    }

    // The item's own fields.
    let rowPayload: Record<string, unknown> | null = null;
    if (row && rowFields) {
      const rowPatch: Record<string, unknown> = { [rowFields.title]: title };
      if (rowFields.detail) rowPatch[rowFields.detail] = detail;
      if (rowFields.link) rowPatch[rowFields.link] = link;
      if (question) {
        rowPatch.options = choices;
        rowPatch.multiple = choices.length ? multiple : undefined;
        rowPatch.longAnswer = choices.length ? undefined : longAnswer;
      }
      if (customization) {
        rowPatch.status = status;
        rowPatch.kind = workType === NOT_SET ? undefined : workType;
        rowPatch.estimateDays = days;
        rowPatch.requirementRowId = serves === NOT_SET ? undefined : serves;
      }
      const next = patchPayload(row.payload, rowPatch);
      if (JSON.stringify(next) !== JSON.stringify(row.payload)) {
        rowPayload = next;
      }
    }
    onSave(patch, rowPayload);
  };

  return (
    <>
      <ModalHeader>
        <CardTypeLabel card={card} group={text(card.group)} />
        <ModalTitle>
          <Trans>Edit card</Trans>
        </ModalTitle>
        {row ? (
          <ModalDescription>
            <Trans>
              Changes to the item's title, details and answers show on every
              page that has it.
            </Trans>
          </ModalDescription>
        ) : null}
      </ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-5">
          {card.missing ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                This item was removed from the Implementation Hub. Remove it
                from the page to save other changes.
              </Trans>
            </p>
          ) : null}
          <Labelled label={question ? t`Question` : t`Title`}>
            {question ? (
              <Textarea
                value={title}
                rows={2}
                onChange={(event) => setTitle(event.target.value)}
              />
            ) : (
              <Input
                value={title}
                placeholder={ownTitle || undefined}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </Labelled>
          {hasDetail ? (
            <Labelled label={t`Details (optional)`}>
              <Textarea
                value={detail}
                rows={3}
                onChange={(event) => setDetail(event.target.value)}
              />
            </Labelled>
          ) : card.detail ? (
            <p className="text-sm text-muted-foreground text-pretty">
              {text(card.detail)}
            </p>
          ) : null}
          {hasLink ? (
            <Labelled label={t`Link (optional)`}>
              <Input
                value={link}
                placeholder="/x/…"
                onChange={(event) => setLink(event.target.value)}
              />
            </Labelled>
          ) : null}

          {question ? (
            <div className="flex flex-col gap-3">
              <Labelled
                label={t`Options, one per line (leave empty for a typed answer)`}
              >
                <Textarea
                  value={options}
                  rows={3}
                  onChange={(event) => setOptions(event.target.value)}
                />
              </Labelled>
              {choices.length ? (
                <Switch
                  variant="small"
                  label={t`Pick several`}
                  checked={multiple}
                  onCheckedChange={setMultiple}
                />
              ) : (
                <Switch
                  variant="small"
                  label={t`Long answer: answered in the card, not in its row`}
                  checked={longAnswer}
                  onCheckedChange={setLongAnswer}
                />
              )}
            </div>
          ) : null}

          {customization ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled as="div" label={t`Status`}>
                <Select
                  value={status}
                  onValueChange={(value) =>
                    setStatus(value as CustomizationStatus)
                  }
                >
                  <SelectTrigger size="sm" aria-label={t`Status`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(
                        CUSTOMIZATION_STATUSES
                      ) as CustomizationStatus[]
                    ).map((value) => (
                      <SelectItem key={value} value={value}>
                        {i18n._(CUSTOMIZATION_STATUSES[value])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labelled>
              <Labelled as="div" label={t`Type of work`}>
                <Select value={workType} onValueChange={setWorkType}>
                  <SelectTrigger size="sm" aria-label={t`Type of work`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET}>
                      <Trans>Not set</Trans>
                    </SelectItem>
                    {CUSTOMIZATION_KIND_KEYS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {i18n._(CUSTOMIZATION_KINDS[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labelled>
              <Labelled label={t`Estimate (days)`}>
                <Input
                  value={estimate}
                  placeholder={t`Days (optional)`}
                  inputMode="decimal"
                  onChange={(event) => setEstimate(event.target.value)}
                />
              </Labelled>
              <Labelled as="div" label={t`Serves requirement`}>
                <Select value={serves} onValueChange={setServes}>
                  <SelectTrigger size="sm" aria-label={t`Serves requirement`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={NOT_SET}>
                      <Trans>No linked requirement</Trans>
                    </SelectItem>
                    {servesChoices.map((choice) => (
                      <SelectItem key={choice.id} value={choice.id}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labelled>
            </div>
          ) : null}

          <Labelled label={t`A note for this person (optional)`}>
            <Textarea
              value={note}
              rows={2}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
          </Labelled>
          {/* Not a <label>: a click inside one goes to the picker's calendar
              button, so a typed date is lost. A card that cannot be done
              takes no due date. */}
          {canDue ? (
            <Labelled as="div" label={t`Due`}>
              <div className="flex items-center gap-1">
                <DatePicker
                  aria-label={t`Due`}
                  size="sm"
                  value={due}
                  onChange={(date) => setDue(date)}
                />
                {due ? (
                  <IconButton
                    aria-label={t`Clear the due date`}
                    icon={<LuX />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setDue(null)}
                  />
                ) : null}
              </div>
            </Labelled>
          ) : null}

          <FieldsEditor
            fields={fields}
            onAdd={(type) =>
              setFields((current) => [
                ...current,
                {
                  id: Math.max(-1, ...current.map((field) => field.id)) + 1,
                  type,
                  label: "",
                  value: "",
                  points: ""
                }
              ])
            }
            onChange={setField}
            onRemove={(id) =>
              setFields((current) => current.filter((field) => field.id !== id))
            }
          />

          <Switch
            variant="small"
            label={t`Ask the person for a file`}
            checked={askForFile}
            onCheckedChange={setAskForFile}
          />
          <CardFiles cardId={card.id} canUpload />

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button onClick={submit}>
          <Trans>Save</Trans>
        </Button>
      </ModalFooter>
    </>
  );
}

// The card's own fields: as many values and checklists as the card needs.
function FieldsEditor({
  fields,
  onAdd,
  onChange,
  onRemove
}: {
  fields: DraftField[];
  onAdd: (type: DraftField["type"]) => void;
  onChange: (id: number, patch: Partial<DraftField>) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useLingui();
  const full = fields.length >= PAGE_CARD_MAX_FIELDS;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          <Trans>Fields</Trans>
        </h3>
        <p className="text-xs text-muted-foreground text-pretty">
          <Trans>
            Shown to the person in the card. A checklist's points are ticked by
            them, and the card is marked done once every point is ticked.
          </Trans>
        </p>
      </div>
      {fields.map((field) => (
        <div
          key={field.id}
          className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_minmax(0,12rem)_1fr_auto] sm:items-start"
        >
          <Select
            value={field.type}
            onValueChange={(type) =>
              onChange(field.id, { type: type as DraftField["type"] })
            }
          >
            <SelectTrigger size="sm" aria-label={t`Field type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">
                <Trans>Value</Trans>
              </SelectItem>
              <SelectItem value="checklist">
                <Trans>Checklist</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
          <Input
            size="sm"
            value={field.label}
            placeholder={t`Label`}
            aria-label={t`Label`}
            maxLength={80}
            onChange={(event) =>
              onChange(field.id, { label: event.target.value })
            }
          />
          {field.type === "checklist" ? (
            <Textarea
              value={field.points}
              rows={3}
              placeholder={t`One point per line`}
              aria-label={t`Points, one per line`}
              onChange={(event) =>
                onChange(field.id, { points: event.target.value })
              }
            />
          ) : (
            <Textarea
              value={field.value}
              rows={1}
              placeholder={t`Value`}
              aria-label={t`Value`}
              maxLength={2000}
              onChange={(event) =>
                onChange(field.id, { value: event.target.value })
              }
            />
          )}
          <IconButton
            aria-label={t`Remove field`}
            icon={<LuTrash2 />}
            variant="ghost"
            size="sm"
            onClick={() => onRemove(field.id)}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuPlus />}
          isDisabled={full}
          onClick={() => onAdd("text")}
        >
          <Trans>Add field</Trans>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuListChecks />}
          isDisabled={full}
          onClick={() => onAdd("checklist")}
        >
          <Trans>Add checklist</Trans>
        </Button>
      </div>
    </section>
  );
}

// What staff can add: a card from the catalogue, a to-do of this page's own,
// or a new company question, decision or customization. Objectives and new
// setup, data and cutover items are not offered: a to-do covers them. Rows
// of those kinds made before still show and edit.
type AddKind = "item" | "custom" | "question" | "requirement" | "customization";

function AddCardModal({
  open,
  onClose,
  ...form
}: AddCardFormProps & { open: boolean }) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Wide enough for the catalogue list, which grows to 560px to fit its
          longest title. The form starts empty on each open. */}
      <ModalContent size="xlarge">
        <AddCardForm {...form} onClose={onClose} />
      </ModalContent>
    </Modal>
  );
}

interface AddCardFormProps {
  page: MemberPage;
  catalogue: PageCatalogueEntry[];
  editor: PageEditor;
  onClose: () => void;
}

// What a new card is, and the fields each kind asks for.
function AddCardForm({ page, catalogue, editor, onClose }: AddCardFormProps) {
  const { t, i18n } = useLingui();
  const text = useCardText();
  const [kind, setKind] = useState<AddKind>("item");
  const [item, setItem] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [link, setLink] = useState("");
  const [options, setOptions] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds: { value: AddKind; label: string }[] = [
    { value: "item", label: t`Catalogue card` },
    { value: "custom", label: t`To-do` },
    { value: "question", label: t`Question` },
    { value: "requirement", label: t`Decision` },
    { value: "customization", label: t`Customization (Carbon builds it)` }
  ];

  // Hub items not on the page yet.
  const onPage = pageCardIds(page);
  const itemOptions = catalogue
    .filter((entry) => !onPage.has(entry.item))
    .map((entry) => {
      const group = text(entry.group);
      return {
        value: entry.item,
        label: text(entry.title) ?? entry.item,
        helper: `${i18n._(PAGE_CARD_KIND_LABEL[entry.kind])}${group ? ` · ${group}` : ""}`
      };
    });

  const titleLabel: Record<Exclude<AddKind, "item">, string> = {
    custom: t`Title`,
    question: t`Question`,
    requirement: t`What to decide on`,
    customization: t`Customization`
  };
  const detailLabel: Partial<Record<AddKind, string>> = {
    custom: t`Details (optional)`,
    customization: t`Details (optional)`
  };
  const takesLink = kind === "custom";

  const submit = () => {
    if (kind === "item") {
      const next = item ? placeCard(page, { item }, END_OF_PAGE) : null;
      if (!next) {
        setError(t`Choose a catalogue card`);
        return;
      }
      editor.save(next);
      onClose();
      return;
    }
    if (!title.trim()) {
      setError(t`Fill in the ${titleLabel[kind]}`);
      return;
    }
    if (takesLink && link.trim() && !isPageLink(link.trim())) {
      setError(t`Use a Carbon path starting with /x/, or an https link`);
      return;
    }
    if (kind === "custom") {
      const card: MemberPageCard = {
        custom: {
          key: newCustomKey(title, customKeys(page)),
          title: title.trim(),
          ...(detail.trim() ? { text: detail.trim() } : {}),
          ...(link.trim() ? { link: link.trim() } : {})
        }
      };
      const next = placeCard(page, card, END_OF_PAGE);
      if (next) editor.save(next);
      onClose();
      return;
    }
    const fields = PAGE_ROW_FIELDS[kind];
    const choices = parseOptionLines(options);
    const payload: Record<string, unknown> = {
      [fields.title]: title.trim(),
      ...(fields.detail && detail.trim()
        ? { [fields.detail]: detail.trim() }
        : {}),
      ...(kind === "question" && choices.length
        ? { options: choices, ...(multiple ? { multiple: true } : {}) }
        : {})
    };
    editor.addItem(kind, payload, page, END_OF_PAGE);
    onClose();
  };

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Add a card</Trans>
        </ModalTitle>
        <ModalDescription>
          <Trans>The card goes at the end of the page.</Trans>
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-4">
          <Labelled as="div" label={t`Card`}>
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as AddKind);
                setError(null);
              }}
            >
              <SelectTrigger aria-label={t`Card`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          {kind === "item" ? (
            <Labelled as="div" label={t`Catalogue card`}>
              <Combobox
                value={item}
                options={itemOptions}
                placeholder={t`Choose a catalogue card`}
                emptyMessage={t`Every catalogue card is on this page`}
                onChange={(value) => {
                  setItem(value);
                  setError(null);
                }}
              />
            </Labelled>
          ) : (
            <>
              <Labelled label={titleLabel[kind]}>
                {kind === "question" || kind === "requirement" ? (
                  <Textarea
                    value={title}
                    rows={2}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setError(null);
                    }}
                  />
                ) : (
                  <Input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setError(null);
                    }}
                  />
                )}
              </Labelled>
              {detailLabel[kind] ? (
                <Labelled label={detailLabel[kind] ?? ""}>
                  <Textarea
                    value={detail}
                    rows={2}
                    onChange={(event) => setDetail(event.target.value)}
                  />
                </Labelled>
              ) : null}
              {takesLink ? (
                <Labelled label={t`Link (optional)`}>
                  <Input
                    value={link}
                    placeholder="/x/…"
                    onChange={(event) => {
                      setLink(event.target.value);
                      setError(null);
                    }}
                  />
                </Labelled>
              ) : null}
              {kind === "question" ? (
                <>
                  <Labelled
                    label={t`Options, one per line (leave empty for a typed answer)`}
                  >
                    <Textarea
                      value={options}
                      rows={3}
                      onChange={(event) => setOptions(event.target.value)}
                    />
                  </Labelled>
                  {parseOptionLines(options).length ? (
                    <Switch
                      variant="small"
                      label={t`Pick several`}
                      checked={multiple}
                      onCheckedChange={setMultiple}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            <Trans>
              Notes, a due date, fields and file requests are added by editing
              the card.
            </Trans>
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button onClick={submit}>
          <Trans>Add card</Trans>
        </Button>
      </ModalFooter>
    </>
  );
}

function ConfirmModal({
  open,
  title,
  text,
  confirm,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{text}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirm}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// Radix Select has no empty value; this stands for "none chosen".
const NOT_SET = "none";

function Labelled({
  label,
  as: Wrapper = "label",
  children
}: {
  label: string;
  as?: "label" | "div";
  children: ReactNode;
}) {
  return (
    <Wrapper className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </Wrapper>
  );
}
