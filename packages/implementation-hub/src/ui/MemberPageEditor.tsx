// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A person's page as Carbon staff edit it: every section and card in place,
// questions included, with each change saved as it is made. Text is saved when
// its field loses focus, as on Implementation Hub 1.0. A change to the page saves
// the whole page (`PageEditor.save`); a change to a company item (its title, a
// question's options, a customization's status, type of work, estimate and the
// requirement it serves) updates the item, which every page that shows it
// reads.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  Combobox,
  cn,
  DatePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  Textarea,
  toast
} from "@carbon/react";
import { type CalendarDate, parseDate } from "@internationalized/date";
import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuEllipsisVertical,
  LuMoveRight,
  LuPlus,
  LuTrash2,
  LuX
} from "react-icons/lu";
import {
  CUSTOMIZATION_KINDS,
  CUSTOMIZATION_STATUSES
} from "../content/customization";
import { PAGE_CARD_KIND_LABEL } from "../content/page";
import {
  CUSTOMIZATION_KIND_KEYS,
  isCustomizationKind,
  parseEstimateDays,
  readCustomization
} from "../logic/customization";
import {
  buildPageCatalogue,
  cardState,
  catalogueByItem,
  type PageCard,
  type PageCatalogueEntry,
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
  editSection,
  isPageRowCollection,
  moveCard,
  moveCardToSection,
  moveSection,
  newCustomKey,
  PAGE_ROW_FIELDS,
  type PageRowCollection,
  type PageTarget,
  pageCardIds,
  parseOptionLines,
  placeCard,
  removeCard,
  removeSection
} from "../logic/page-edit";
import { readQuestion } from "../logic/question";
import {
  type MemberPage,
  type MemberPageCard,
  memberPageCustomCardValidator
} from "../models";
import type { CustomizationStatus, ImplementationRowData } from "../types";
import { CardStatus, EmptySection } from "./PageCardParts";
import { ProgressPill } from "./ProgressPill";
import { EditableInput } from "./primitives";
import { useCheckMap, useHub, useHubActions } from "./state";

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

type Text = MessageDescriptor | string | undefined;

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

export function MemberPageEditor({
  page,
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
  const catalogue = useMemo(() => buildPageCatalogue(rows), [rows]);
  const items = useMemo(() => catalogueByItem(catalogue), [catalogue]);
  // The page as it is built: every card in its section, questions included.
  const sections = useMemo(
    () => resolveMemberPage(page, items, memberId),
    [page, items, memberId]
  );
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  );
  const progress = pageProgress(sections, states, rowsById);
  const requirements = useMemo(
    () => requirementChoices(catalogue, states),
    [catalogue, states]
  );

  const [adding, setAdding] = useState<PageTarget | null>(null);
  const [removingSection, setRemovingSection] = useState<number | null>(null);

  const save = (next: MemberPage | null) => {
    if (next) editor.save(next);
  };
  const sectionTitles = page.sections.map((section) => section.title);

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8">
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

      {sections.map((section, s) => (
        // Sections have no key of their own; the editor follows the page.
        <section key={s} className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <div className="flex flex-1 min-w-0 max-w-2xl flex-col gap-1.5">
              <EditableInput
                value={section.title}
                placeholder={t`Section title`}
                onCommit={(title) => save(editSection(page, s, { title }))}
              />
              <EditableInput
                value={section.intro ?? ""}
                placeholder={t`An introduction for this section (optional)`}
                variant="muted"
                multiline
                onCommit={(intro) => save(editSection(page, s, { intro }))}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                aria-label={t`Move section up`}
                icon={<LuArrowUp />}
                variant="ghost"
                size="sm"
                isDisabled={s === 0}
                onClick={() => save(moveSection(page, s, -1))}
              />
              <IconButton
                aria-label={t`Move section down`}
                icon={<LuArrowDown />}
                variant="ghost"
                size="sm"
                isDisabled={s === sections.length - 1}
                onClick={() => save(moveSection(page, s, 1))}
              />
              <IconButton
                aria-label={t`Remove section`}
                icon={<LuTrash2 />}
                variant="ghost"
                size="sm"
                isDisabled={sections.length <= 1}
                onClick={() => setRemovingSection(s)}
              />
            </div>
          </div>
          {section.cards.length ? null : <EmptySection />}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.cards.map((card, c) => {
              const pageCard = page.sections[s]?.cards[c];
              if (!pageCard) return null;
              return (
                <EditCard
                  key={card.id}
                  card={card}
                  pageCard={pageCard}
                  entry={pageCard.item ? items.get(pageCard.item) : undefined}
                  row={card.rowId ? rowsById.get(card.rowId) : undefined}
                  requirements={requirements}
                  position={{
                    first: c === 0,
                    last: c === section.cards.length - 1
                  }}
                  otherSections={sectionTitles.flatMap((title, index) =>
                    index === s ? [] : [{ index, title }]
                  )}
                  onEdit={(patch) => save(editCard(page, s, c, patch))}
                  onMove={(offset) => save(moveCard(page, s, c, offset))}
                  onMoveTo={(to) => save(moveCardToSection(page, s, c, to))}
                  onRemove={() => save(removeCard(page, s, c))}
                />
              );
            })}
          </div>
          <div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPlus />}
              onClick={() => setAdding({ section: s })}
            >
              <Trans>Add card</Trans>
            </Button>
          </div>
        </section>
      ))}

      <div>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          onClick={() => setAdding({ newSection: "" })}
        >
          <Trans>Add section</Trans>
        </Button>
      </div>

      {adding ? (
        <AddCardModal
          page={page}
          target={adding}
          catalogue={catalogue}
          editor={editor}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {removingSection !== null && page.sections[removingSection] ? (
        <ConfirmModal
          title={t`Remove ${page.sections[removingSection]?.title ?? ""}`}
          text={t`The section and its cards leave this page. Items on it stay in the catalogue and can be added again.`}
          confirm={t`Remove`}
          onConfirm={() => {
            save(removeSection(page, removingSection));
            setRemovingSection(null);
          }}
          onClose={() => setRemovingSection(null)}
        />
      ) : null}
    </div>
  );
}

function EditCard({
  card,
  pageCard,
  entry,
  row,
  requirements,
  position,
  otherSections,
  onEdit,
  onMove,
  onMoveTo,
  onRemove
}: {
  card: PageCard;
  pageCard: MemberPageCard;
  entry: PageCatalogueEntry | undefined;
  row: ImplementationRowData | undefined;
  requirements: RequirementChoice[];
  position: { first: boolean; last: boolean };
  otherSections: { index: number; title: string }[];
  onEdit: (patch: CardPatch) => void;
  onMove: (offset: -1 | 1) => void;
  onMoveTo: (section: number) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useLingui();
  const actions = useHubActions();
  const states = useCheckMap();
  const rowsById = useMemo(() => new Map(row ? [[row.id, row]] : []), [row]);
  const [deleting, setDeleting] = useState(false);
  // A due date still being typed. Its first year digit already makes a whole
  // date ("2"), so it is held here until the year has four digits.
  const [typedDue, setTypedDue] = useState<CalendarDate | null>(null);

  const text = (value: Text) =>
    value === undefined || typeof value === "string" ? value : i18n._(value);
  const collection =
    row && isPageRowCollection(row.collection) ? row.collection : null;
  const fields = collection ? PAGE_ROW_FIELDS[collection] : null;
  const payload = row?.payload ?? {};
  const field = (key: string | undefined) =>
    key && typeof payload[key] === "string" ? (payload[key] as string) : "";

  // An item's own cell: kept when it has a value, dropped when cleared.
  const updateRow = (patch: Record<string, unknown>) => {
    if (!row) return;
    const next: Record<string, unknown> = { ...row.payload };
    for (const [key, value] of Object.entries(patch)) {
      const empty =
        value === undefined ||
        value === false ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && value.length === 0);
      if (empty) delete next[key];
      else next[key] = typeof value === "string" ? value.trim() : value;
    }
    actions.updateRow(row.id, next);
  };

  const commitTitle = (title: string) => {
    if (pageCard.custom || !fields) {
      onEdit({ title });
      return;
    }
    if (!title.trim()) return;
    updateRow({ [fields.title]: title });
    // The item's own title shows from now on, not one this page set.
    if (pageCard.title) onEdit({ title: "" });
  };

  const commitLink = (link: string) => {
    if (link.trim() && !isPageLink(link.trim())) {
      toast.error(t`Use a Carbon path starting with /x/, or an https link`);
      return;
    }
    if (pageCard.custom) onEdit({ link });
    else if (fields?.link) updateRow({ [fields.link]: link });
  };

  const on = cardState(card, states, rowsById).on;
  const hasDue = takesDueDate(card, states, rowsById);

  const group = card.kind === "objective" ? undefined : text(card.group);
  const titleValue = pageCard.custom
    ? pageCard.custom.title
    : fields
      ? field(fields.title)
      : (pageCard.title ?? "");
  const detailValue = pageCard.custom
    ? (pageCard.custom.text ?? "")
    : field(fields?.detail);
  const hasDetail = Boolean(pageCard.custom || fields?.detail);
  const linkValue = pageCard.custom
    ? (pageCard.custom.link ?? "")
    : field(fields?.link);
  const hasLink = Boolean(pageCard.custom || fields?.link);
  const question = collection === "question" ? readQuestion(payload) : null;
  const customization =
    collection === "customization" ? readCustomization(payload) : null;
  const served = customization?.requirementRowId;
  // The in-scope requirements, and the one it serves when that is out of
  // scope or deleted.
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

  const commitEstimate = (input: string) => {
    const days = parseEstimateDays(input);
    if (input.trim() && days === undefined) {
      toast.error(t`Enter the estimate as a number of days`);
      return;
    }
    updateRow({ estimateDays: days });
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xxs font-medium uppercase tracking-wide text-muted-foreground">
            {i18n._(PAGE_CARD_KIND_LABEL[card.kind])}
            {group ? ` · ${group}` : ""}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {customization ? null : (
              <CardStatus card={card} on={on} row={row} />
            )}
            <CardMenu
              position={position}
              otherSections={otherSections}
              canDelete={Boolean(row)}
              onMove={onMove}
              onMoveTo={onMoveTo}
              onRemove={onRemove}
              onDelete={() => setDeleting(true)}
            />
          </div>
        </div>
        <EditableInput
          value={titleValue}
          placeholder={
            pageCard.custom
              ? t`Card title`
              : (text(entry?.title) ?? text(card.title) ?? t`Title`)
          }
          onCommit={commitTitle}
        />
        {hasDetail ? (
          <EditableInput
            value={detailValue}
            placeholder={t`Details (optional)`}
            variant="muted"
            multiline
            onCommit={(detail) =>
              pageCard.custom
                ? onEdit({ text: detail })
                : updateRow({ [fields?.detail ?? "detail"]: detail })
            }
          />
        ) : card.detail ? (
          <CardDescription className="text-xs text-pretty">
            {text(card.detail)}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        {card.missing ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              This item was removed from the Implementation Hub. Remove it from
              the page to save other changes.
            </Trans>
          </p>
        ) : null}
        {hasLink ? (
          <EditableInput
            value={linkValue}
            placeholder={t`Link (optional) — e.g. /x/settings/…`}
            variant="muted"
            onCommit={commitLink}
          />
        ) : null}
        {question ? (
          <>
            <EditableInput
              value={(question.options ?? []).join("\n")}
              placeholder={t`Options, one per line (leave empty for a typed answer)`}
              variant="muted"
              multiline
              onCommit={(lines) => {
                const options = parseOptionLines(lines);
                updateRow({
                  options,
                  multiple: options.length ? question.multiple : undefined
                });
              }}
            />
            {question.options?.length ? (
              <Switch
                variant="small"
                label={t`Pick several`}
                checked={Boolean(question.multiple)}
                onCheckedChange={(multiple) => updateRow({ multiple })}
              />
            ) : null}
          </>
        ) : null}
        {customization ? (
          <Labelled label={t`Status`}>
            <Select
              value={customization.status}
              onValueChange={(status) => updateRow({ status })}
            >
              <SelectTrigger size="sm" aria-label={t`Status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(CUSTOMIZATION_STATUSES) as CustomizationStatus[]
                ).map((status) => (
                  <SelectItem key={status} value={status}>
                    {i18n._(CUSTOMIZATION_STATUSES[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
        ) : null}
        {customization ? (
          <>
            <Labelled label={t`Type of work`}>
              <Select
                value={
                  isCustomizationKind(payload.kind) ? payload.kind : NOT_SET
                }
                onValueChange={(kind) =>
                  updateRow({ kind: kind === NOT_SET ? undefined : kind })
                }
              >
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
              <EditableInput
                value={
                  customization.estimateDays === undefined
                    ? ""
                    : String(customization.estimateDays)
                }
                placeholder={t`Days (optional)`}
                variant="muted"
                onCommit={commitEstimate}
              />
            </Labelled>
            <Labelled label={t`Serves requirement`}>
              <Select
                value={served ?? NOT_SET}
                onValueChange={(id) =>
                  updateRow({
                    requirementRowId: id === NOT_SET ? undefined : id
                  })
                }
              >
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
          </>
        ) : null}
        <EditableInput
          value={pageCard.note ?? ""}
          placeholder={t`A note for this person (optional)`}
          variant="muted"
          multiline
          onCommit={(note) => onEdit({ note })}
        />
        {/* Not a <label>: a click inside one goes to the picker's calendar
            button, so a typed date is lost. The picker names itself. A card
            that cannot be done takes no due date. */}
        {hasDue ? (
          <Labelled as="div" label={t`Due`}>
            <div className="flex items-center gap-1">
              <DatePicker
                aria-label={t`Due`}
                size="sm"
                value={typedDue ?? toCalendarDate(pageCard.due)}
                onChange={(date) => {
                  if (date && date.year < 1000) {
                    setTypedDue(date);
                    return;
                  }
                  setTypedDue(null);
                  onEdit({ due: date ? date.toString() : "" });
                }}
                onBlur={() => setTypedDue(null)}
              />
              {pageCard.due ? (
                <IconButton
                  aria-label={t`Clear the due date`}
                  icon={<LuX />}
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit({ due: "" })}
                />
              ) : null}
            </div>
          </Labelled>
        ) : null}
      </CardContent>
      {deleting && row ? (
        <ConfirmModal
          title={t`Delete ${titleValue || text(card.title) || ""}`}
          text={t`The item is deleted from the Implementation Hub and leaves this page. Other pages that show it will show it as removed until it is taken off them.`}
          confirm={t`Delete`}
          onConfirm={() => {
            // Off the page and out of the hub together: the page saved
            // without the card is valid whichever lands first.
            onRemove();
            actions.deleteRow(row.id);
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Card>
  );
}

function CardMenu({
  position,
  otherSections,
  canDelete,
  onMove,
  onMoveTo,
  onRemove,
  onDelete
}: {
  position: { first: boolean; last: boolean };
  otherSections: { index: number; title: string }[];
  canDelete: boolean;
  onMove: (offset: -1 | 1) => void;
  onMoveTo: (section: number) => void;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`Card options`}
          icon={<LuEllipsisVertical />}
          variant="ghost"
          size="sm"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem disabled={position.first} onClick={() => onMove(-1)}>
          <DropdownMenuIcon icon={<LuArrowUp />} />
          <Trans>Move up</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={position.last} onClick={() => onMove(1)}>
          <DropdownMenuIcon icon={<LuArrowDown />} />
          <Trans>Move down</Trans>
        </DropdownMenuItem>
        {otherSections.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DropdownMenuIcon icon={<LuMoveRight />} />
              <Trans>Move to section</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {otherSections.map((section) => (
                <DropdownMenuItem
                  key={section.index}
                  onClick={() => onMoveTo(section.index)}
                >
                  {section.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
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

type AddKind = "item" | "custom" | PageRowCollection;

// What a new card is, and the fields each kind asks for.
function AddCardModal({
  page,
  target,
  catalogue,
  editor,
  onClose
}: {
  page: MemberPage;
  target: PageTarget;
  catalogue: PageCatalogueEntry[];
  editor: PageEditor;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const [kind, setKind] = useState<AddKind>("item");
  const [sectionTitle, setSectionTitle] = useState("");
  const [item, setItem] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [link, setLink] = useState("");
  const [options, setOptions] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newSection = "newSection" in target;
  const text = (value: Text) =>
    value === undefined || typeof value === "string" ? value : i18n._(value);

  const kinds: { value: AddKind; label: string }[] = [
    { value: "item", label: t`Catalogue card` },
    { value: "custom", label: t`Custom card` },
    { value: "question", label: t`New open question` },
    { value: "objective", label: t`New objective` },
    { value: "customization", label: t`New customization` },
    { value: "requirement", label: t`New requirement` },
    { value: "setup", label: t`New setup item` },
    { value: "data", label: t`New data item` },
    { value: "golive", label: t`New cutover step` }
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
    objective: t`Objective`,
    customization: t`Customization`,
    requirement: t`Requirement`,
    setup: t`What to set up`,
    data: t`What data`,
    golive: t`Cutover step`
  };
  const detailLabel: Partial<Record<AddKind, string>> = {
    custom: t`Text (optional)`,
    objective: t`Details (optional)`,
    customization: t`Details (optional)`,
    setup: t`What it is`,
    data: t`Where it lives today`
  };
  const takesLink = kind === "custom" || kind === "setup";

  const submit = () => {
    const where: PageTarget = newSection
      ? { newSection: sectionTitle }
      : target;
    if (newSection && !sectionTitle.trim()) {
      setError(t`Give the new section a title`);
      return;
    }
    if (kind === "item") {
      const next = item ? placeCard(page, { item }, where) : null;
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
      const next = placeCard(page, card, where);
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
      ...(fields.link && link.trim() ? { [fields.link]: link.trim() } : {}),
      ...(kind === "question" && choices.length
        ? { options: choices, ...(multiple ? { multiple: true } : {}) }
        : {})
    };
    editor.addItem(kind, payload, page, where);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Wide enough for the hub item list, which grows to 560px to fit its
          longest title. */}
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            {newSection ? (
              <Trans>Add a section</Trans>
            ) : (
              <Trans>Add a card</Trans>
            )}
          </ModalTitle>
          <ModalDescription>
            {newSection ? (
              <Trans>
                A new section at the end of the page, with its first card.
              </Trans>
            ) : (
              <Trans>The card goes at the end of the section.</Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            {newSection ? (
              <Labelled label={t`Section title`}>
                <Input
                  value={sectionTitle}
                  onChange={(event) => {
                    setSectionTitle(event.target.value);
                    setError(null);
                  }}
                />
              </Labelled>
            ) : null}
            <Labelled label={t`Card`}>
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
              <Labelled label={t`Catalogue card`}>
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
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button onClick={submit}>
            {newSection ? <Trans>Add section</Trans> : <Trans>Add card</Trans>}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ConfirmModal({
  title,
  text,
  confirm,
  onConfirm,
  onClose
}: {
  title: string;
  text: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
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
  className,
  as: Wrapper = "label",
  children
}: {
  label: string;
  className?: string;
  as?: "label" | "div";
  children: ReactNode;
}) {
  return (
    <Wrapper className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </Wrapper>
  );
}
