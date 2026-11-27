// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A person's Implementation Hub: one table of cards, defined by Carbon staff in
// a page file. A card that places a hub item ticks the same state the item's
// old page did, so the company's progress is shared; a custom card is ticked
// by its person alone. A row is answered or ticked in place; a row with more
// than it shows (its details, a note, fields, a checklist, files, a long
// answer) opens the card in a modal.

import {
  Badge,
  Button,
  ChoiceCardGroup,
  type ChoiceCardOption,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MultiChoiceCardGroup,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useMemo, useState } from "react";
import {
  LuArrowRight,
  LuBookOpen,
  LuListChecks,
  LuPaperclip,
  LuPlay,
  LuStickyNote
} from "react-icons/lu";
import { READINESS_LABEL } from "../content/page";
import { isOverdue } from "../logic/assignments";
import {
  buildPageCatalogue,
  cardChecklists,
  cardState,
  catalogueByItem,
  checklistProgress,
  type PageCard,
  pageCards,
  pageProgress,
  resolveMemberPage,
  unmetReadiness
} from "../logic/page";
import {
  nextQuestionSelection,
  QUESTION_NOT_SURE,
  readQuestion
} from "../logic/question";
import type { MemberPage } from "../models";
import type { ImplementationRowData } from "../types";
import { MemberPageEditor, type PageEditor } from "./MemberPageEditor";
import { CardFieldsView, CardStatus, PriorityProgress } from "./PageCardParts";
import {
  CardFiles,
  type PageFiles,
  PageFilesProvider,
  usePageFilesByCard
} from "./PageFiles";
import {
  CardTitle,
  CardTypeLabel,
  DueBadge,
  MetaChip,
  OpensHint,
  PageCell,
  PageRow,
  PageTable,
  useCardText
} from "./PageTable";
import {
  EditableInput,
  EvidenceCount,
  LearnLink,
  PageHeader,
  SourceBadge,
  VerifiedBadge
} from "./primitives";
import { ProgressPill } from "./ProgressPill";
import {
  useCanEdit,
  useCheckMap,
  useCheckRowMap,
  useCounts,
  useHub,
  useHubActions,
  useIsInternal,
  useResolveScreenUrl,
  useResolveVideoUrl,
  useShowsStaffDetail
} from "./state";

export function MemberPageView({
  page,
  memberId,
  memberName,
  editor,
  files
}: {
  page: MemberPage;
  memberId: string;
  memberName?: string;
  // Given for Carbon staff: the page is edited in place, unless they are
  // previewing the customer's view.
  editor?: PageEditor;
  // The page's files and how to store them, from the app.
  files?: PageFiles;
}) {
  const canEdit = useCanEdit();
  return (
    <PageFilesProvider value={files ?? null}>
      {canEdit && editor ? (
        <MemberPageEditor
          page={page}
          memberId={memberId}
          memberName={memberName}
          editor={editor}
        />
      ) : (
        <MemberPageRead
          page={page}
          memberId={memberId}
          memberName={memberName}
        />
      )}
    </PageFilesProvider>
  );
}

// What a card shows beyond its row, worked out once for the row and its
// modal.
function useCardView(card: PageCard, row: ImplementationRowData | undefined) {
  const { i18n } = useLingui();
  const text = useCardText();
  const states = useCheckMap();
  const counts = useCounts();
  const resolveScreenUrl = useResolveScreenUrl();
  const resolveVideoUrl = useResolveVideoUrl();
  const showsStaffDetail = useShowsStaffDetail();
  const rowsById = useMemo(() => new Map(row ? [[row.id, row]] : []), [row]);
  const state = cardState(card, states, rowsById);
  const screenUrl = card.screenKey
    ? resolveScreenUrl(card.screenKey)
    : undefined;
  const question =
    card.kind === "question" && row && !card.missing
      ? readQuestion(row.payload)
      : null;
  const waitingFor =
    card.kind === "task" && !state.on
      ? unmetReadiness(card.ready, counts).flatMap((count) => {
          const label = READINESS_LABEL[count];
          return label ? [i18n._(label)] : [];
        })
      : [];
  // An objective's group is its event, which the title already names. A
  // customization's group is its type of work, which is Carbon's own
  // tracking, like its estimate and the requirement it serves.
  const group =
    card.kind === "objective" ||
    (card.kind === "customization" && !showsStaffDetail)
      ? undefined
      : text(card.group);
  return {
    state,
    title: text(card.title) ?? "",
    detail: text(card.detail),
    group,
    question,
    waitingFor,
    screenUrl,
    openUrl: card.href ?? screenUrl,
    watchUrl:
      (card.videoKey ? resolveVideoUrl(card.videoKey) : undefined) ??
      card.academyUrl,
    serves: showsStaffDetail ? text(card.serves) : undefined,
    estimateDays: showsStaffDetail ? card.estimateDays : undefined,
    // A card that cannot be done shows no due date (`takesDueDate`).
    due: state.done !== null ? card.due : undefined
  };
}

// The page as its person sees it.
function MemberPageRead({
  page,
  memberId,
  memberName
}: {
  page: MemberPage;
  memberId: string;
  memberName?: string;
}) {
  const { t } = useLingui();
  const rows = useHub((s) => s.rows);
  const states = useCheckMap();

  const sections = useMemo(
    () =>
      resolveMemberPage(
        page,
        catalogueByItem(buildPageCatalogue(rows)),
        memberId
      ),
    [page, rows, memberId]
  );
  const cards = useMemo(() => pageCards(sections), [sections]);
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  );
  const progress = pageProgress(sections, states, rowsById);
  const todayIso = today(getLocalTimeZone()).toString();

  // The card open in the modal. It stays chosen after the modal closes, so
  // the modal keeps its content while it animates out.
  const [openId, setOpenId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const openCard = cards.find((card) => card.id === openId);

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={page.title ?? memberName ?? t`Your implementation`}
        lead={page.intro}
        aside={
          <ProgressPill
            done={progress.done}
            total={progress.total}
            label={t`done`}
          />
        }
      />
      {cards.length ? (
        <PageTable
          headers={[
            { key: "type", label: t`Type`, className: "w-32" },
            { key: "card", label: t`Card` },
            { key: "answer", label: t`Answer or status`, className: "w-72" },
            { key: "due", label: t`Due`, className: "w-32" },
            { key: "open", label: "", className: "w-8" }
          ]}
        >
          {cards.map((card) => (
            <PersonRow
              key={card.id}
              card={card}
              row={card.rowId ? rowsById.get(card.rowId) : undefined}
              memberId={memberId}
              todayIso={todayIso}
              onOpen={() => {
                setOpenId(card.id);
                setIsOpen(true);
              }}
            />
          ))}
        </PageTable>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          <Trans>Nothing on this page yet.</Trans>
        </p>
      )}
      {openCard ? (
        <PersonCardModal
          open={isOpen}
          card={openCard}
          row={openCard.rowId ? rowsById.get(openCard.rowId) : undefined}
          memberId={memberId}
          todayIso={todayIso}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function PersonRow({
  card,
  row,
  memberId,
  todayIso,
  onOpen
}: {
  card: PageCard;
  row: ImplementationRowData | undefined;
  memberId: string;
  todayIso: string;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const text = useCardText();
  const view = useCardView(card, row);
  const states = useCheckMap();
  const counts = useCounts();
  const showsStaffDetail = useShowsStaffDetail();
  const files = usePageFilesByCard().get(card.id) ?? [];
  const points = checklistProgress(cardChecklists(card, memberId), states);
  const overdue =
    view.state.done !== null && isOverdue(view.due, view.state.done, todayIso);

  const hasMore =
    Boolean(view.detail) ||
    Boolean(card.note) ||
    Boolean(card.fields?.length) ||
    Boolean(card.askForFile) ||
    files.length > 0 ||
    Boolean(view.question?.longAnswer) ||
    Boolean(card.missing) ||
    view.waitingFor.length > 0 ||
    Boolean(view.watchUrl) ||
    Boolean(card.docsUrl) ||
    Boolean(view.serves) ||
    card.kind === "priority";

  const meta: ReactNode[] = [];
  if (card.note) {
    meta.push(
      <MetaChip key="note" icon={<LuStickyNote className="size-3" />}>
        <Trans>Note</Trans>
      </MetaChip>
    );
  }
  if (points.total) {
    meta.push(
      <MetaChip key="points" icon={<LuListChecks className="size-3" />}>
        {points.ticked}/{points.total}
      </MetaChip>
    );
  }
  if (files.length) {
    meta.push(
      <MetaChip key="files" icon={<LuPaperclip className="size-3" />}>
        <Plural value={files.length} one="# file" other="# files" />
      </MetaChip>
    );
  } else if (card.askForFile) {
    meta.push(
      <MetaChip
        key="files"
        tone="attention"
        icon={<LuPaperclip className="size-3" />}
      >
        <Trans>File requested</Trans>
      </MetaChip>
    );
  }
  if (view.waitingFor.length) {
    meta.push(
      <MetaChip key="waiting" tone="attention">
        <Trans>Needs {view.waitingFor.join(", ")} first</Trans>
      </MetaChip>
    );
  }
  if (showsStaffDetail) {
    for (const evidence of card.evidence) {
      meta.push(
        <span key={evidence.count} className="relative z-10">
          <EvidenceCount
            count={counts[evidence.count]}
            label={text(evidence.label) ?? ""}
            href={view.screenUrl}
          />
        </span>
      );
    }
  }
  if (view.openUrl) {
    meta.push(
      <span key="open" className="relative z-10">
        <LearnLink
          href={view.openUrl}
          icon={<LuArrowRight className="size-3" />}
        >
          <Trans>Open</Trans>
        </LearnLink>
      </span>
    );
  }

  return (
    <PageRow done={Boolean(view.state.done)}>
      <PageCell>
        <CardTypeLabel card={card} group={view.group} />
      </PageCell>
      <PageCell wide>
        <CardTitle
          title={view.title}
          detail={view.detail}
          done={Boolean(view.state.done)}
          onOpen={hasMore ? onOpen : undefined}
          openLabel={t`Open ${view.title}`}
          meta={meta.length ? meta : undefined}
        />
      </PageCell>
      <PageCell controls wide>
        <RowAnswer
          card={card}
          row={row}
          memberId={memberId}
          on={view.state.on}
          onOpen={onOpen}
        />
      </PageCell>
      <PageCell>
        <DueBadge due={view.due} overdue={overdue} />
      </PageCell>
      <PageCell className="max-md:hidden">
        {hasMore ? <OpensHint /> : null}
      </PageCell>
    </PageRow>
  );
}

// What a row answers or ticks in place: a question's choice or typed answer,
// a to-do's Done, a decision's scope. A long answer is given in the modal.
function RowAnswer({
  card,
  row,
  memberId,
  on,
  onOpen
}: {
  card: PageCard;
  row: ImplementationRowData | undefined;
  memberId: string;
  on: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const actions = useHubActions();

  if (card.kind === "question" && row && !card.missing) {
    const question = readQuestion(row.payload);
    const chosen = question.selected ?? [];
    const options = [
      ...(question.options ?? []).map((option) => ({
        value: option,
        label: option
      })),
      { value: QUESTION_NOT_SURE, label: t`Not sure` }
    ];
    if (question.options && question.multiple) {
      return (
        <MultiSelect
          size="sm"
          value={chosen}
          options={options}
          placeholder={t`Choose all that apply`}
          onChange={(next) =>
            actions.answerQuestion(row.id, {
              selected: nextQuestionSelection(chosen, next)
            })
          }
        />
      );
    }
    if (question.options) {
      return (
        <Select
          value={chosen[0] ?? ""}
          onValueChange={(option) =>
            actions.answerQuestion(row.id, { selected: [option] })
          }
        >
          <SelectTrigger size="sm" aria-label={t`Answer`}>
            <SelectValue placeholder={t`Choose an answer`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (question.longAnswer) {
      return (
        <div className="flex min-w-0 flex-col items-start gap-1">
          {question.answer ? (
            <span className="line-clamp-2 text-xs text-muted-foreground text-pretty">
              {question.answer}
            </span>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onOpen}>
            {question.answer ? (
              <Trans>Edit answer</Trans>
            ) : (
              <Trans>Answer</Trans>
            )}
          </Button>
        </div>
      );
    }
    return (
      <EditableInput
        value={question.answer ?? ""}
        placeholder={t`Your answer`}
        variant="muted"
        onCommit={(answer) => actions.answerQuestion(row.id, { answer })}
      />
    );
  }
  return <CardStatus card={card} on={on} row={row} memberId={memberId} />;
}

function PersonCardModal({
  open,
  card,
  row,
  memberId,
  todayIso,
  onClose
}: {
  open: boolean;
  card: PageCard;
  row: ImplementationRowData | undefined;
  memberId: string;
  todayIso: string;
  onClose: () => void;
}) {
  const view = useCardView(card, row);
  const isInternal = useIsInternal();
  const checkRows = useCheckRowMap();
  const checkRow = card.tick ? checkRows.get(card.tick.itemKey) : undefined;
  const overdue =
    view.state.done !== null && isOverdue(view.due, view.state.done, todayIso);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <CardTypeLabel card={card} group={view.group} />
          <ModalTitle className="text-pretty">{view.title}</ModalTitle>
          {view.detail ? (
            <ModalDescription className="whitespace-pre-line text-pretty">
              {view.detail}
            </ModalDescription>
          ) : null}
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-5">
            {card.missing ? (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This item was removed from the Implementation Hub.
                </Trans>
              </p>
            ) : null}
            {card.note ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line text-pretty">
                {card.note}
              </p>
            ) : null}
            {view.serves ? (
              <p className="text-xs text-muted-foreground text-pretty">
                <Trans>Serves: {view.serves}</Trans>
              </p>
            ) : null}
            {view.waitingFor.length ? (
              <p className="text-sm text-muted-foreground">
                <Trans>Needs {view.waitingFor.join(", ")} first.</Trans>
              </p>
            ) : null}
            {card.kind === "priority" ? <PriorityProgress /> : null}
            {view.question && row ? <QuestionAnswer row={row} /> : null}
            <CardFieldsView card={card} memberId={memberId} />
            <CardFiles
              cardId={card.id}
              canUpload={Boolean(card.askForFile) || isInternal}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {view.due ? <DueBadge due={view.due} overdue={overdue} /> : null}
              {view.estimateDays !== undefined ? (
                <Badge variant="outline" className="font-normal tabular-nums">
                  <Plural
                    value={view.estimateDays}
                    one="Estimate # day"
                    other="Estimate # days"
                  />
                </Badge>
              ) : null}
              <VerifiedBadge row={checkRow} />
              <SourceBadge source={row?.source} />
              {view.openUrl ? (
                <LearnLink
                  href={view.openUrl}
                  icon={<LuArrowRight className="size-3" />}
                >
                  <Trans>Open</Trans>
                </LearnLink>
              ) : null}
              {view.watchUrl ? (
                <LearnLink
                  href={view.watchUrl}
                  icon={<LuPlay className="size-3" />}
                >
                  <Trans>Watch</Trans>
                </LearnLink>
              ) : null}
              {card.docsUrl ? (
                <LearnLink
                  href={card.docsUrl}
                  icon={<LuBookOpen className="size-3" />}
                >
                  <Trans>Docs</Trans>
                </LearnLink>
              ) : null}
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="justify-between">
          {card.kind === "question" ? (
            <span />
          ) : (
            <CardStatus
              card={card}
              on={view.state.on}
              row={row}
              memberId={memberId}
            />
          )}
          <Button variant="secondary" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// A question answered in full: choice cards, or a typed answer with room.
function QuestionAnswer({ row }: { row: ImplementationRowData }) {
  const { t } = useLingui();
  const actions = useHubActions();
  const question = readQuestion(row.payload);
  const chosen = question.selected ?? [];
  const options: ChoiceCardOption[] = [
    ...(question.options ?? []).map((option) => ({
      value: option,
      title: option
    })),
    { value: QUESTION_NOT_SURE, title: t`Not sure` }
  ];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {question.multiple ? (
          <Trans>Your answer: pick all that apply</Trans>
        ) : (
          <Trans>Your answer</Trans>
        )}
      </h3>
      {!question.options ? (
        <EditableInput
          value={question.answer ?? ""}
          placeholder={t`Your answer`}
          variant="muted"
          multiline
          className="min-h-32"
          onCommit={(answer) => actions.answerQuestion(row.id, { answer })}
        />
      ) : question.multiple ? (
        <MultiChoiceCardGroup
          value={chosen}
          onChange={(next) =>
            actions.answerQuestion(row.id, {
              selected: nextQuestionSelection(chosen, next)
            })
          }
          options={options}
        />
      ) : (
        <ChoiceCardGroup
          value={chosen[0] ?? ""}
          onChange={(option) =>
            actions.answerQuestion(row.id, { selected: [option] })
          }
          options={options}
        />
      )}
    </section>
  );
}

// What a person without a page sees.
export function MemberPageEmpty() {
  return (
    <div className="w-full max-w-xl mx-auto py-24 text-center flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight">
        <Trans>Implementation Hub</Trans>
      </h1>
      <p className="text-sm text-muted-foreground text-pretty">
        <Trans>
          Ask your Carbon admin to set up the Implementation Hub for you.
        </Trans>
      </p>
    </div>
  );
}
