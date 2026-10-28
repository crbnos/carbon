// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A person's Implementation Hub: one page of cards, defined by Carbon staff in
// a page file. A card that places a hub item ticks the same state the item's
// old page did, so the company's progress is shared; a custom card is ticked
// by its person alone.

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuArrowRight, LuBookOpen, LuPlay } from "react-icons/lu";
import { CUSTOMIZATION_STATUSES } from "../content/customization";
import { PAGE_CARD_KIND_LABEL, READINESS_LABEL } from "../content/page";
import { isOverdue } from "../logic/assignments";
import { readCustomization } from "../logic/customization";
import {
  buildPageCatalogue,
  cardState,
  catalogueByItem,
  type PageCard,
  pageProgress,
  resolveMemberPage,
  splitPageQuestions,
  unmetReadiness
} from "../logic/page";
import type { MemberPage } from "../models";
import type { ImplementationRowData } from "../types";
import { PageQuestions } from "./PageQuestions";
import { ProgressPill } from "./ProgressPill";
import {
  CUSTOMIZATION_STATUS_VARIANTS,
  EvidenceCount,
  isSourceShown,
  LearnLink,
  PageHeader,
  SourceBadge,
  StatusToggle,
  VerifiedBadge
} from "./primitives";
import {
  useCheckMap,
  useCheckRowMap,
  useCounts,
  useHub,
  useHubActions,
  useIsInternal,
  useResolveScreenUrl,
  useResolveVideoUrl
} from "./state";

type Text = MessageDescriptor | string | undefined;

export function MemberPageView({
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
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  );
  // Progress counts every card, questions included; the questions are shown
  // apart, as one list.
  const progress = pageProgress(sections, states, rowsById);
  const split = useMemo(() => splitPageQuestions(sections), [sections]);
  const todayIso = today(getLocalTimeZone()).toString();

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8">
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
      <PageQuestions
        questions={split.questions}
        rowsById={rowsById}
        todayIso={todayIso}
      />
      {split.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{section.title}</h2>
            {section.intro ? (
              <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
                {section.intro}
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.cards.map((card) => (
              <PageCardView
                key={card.id}
                card={card}
                rowsById={rowsById}
                todayIso={todayIso}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
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

function PageCardView({
  card,
  rowsById,
  todayIso
}: {
  card: PageCard;
  rowsById: Map<string, ImplementationRowData>;
  todayIso: string;
}) {
  const { t, i18n } = useLingui();
  const states = useCheckMap();
  const checkRows = useCheckRowMap();
  const counts = useCounts();
  const resolveScreenUrl = useResolveScreenUrl();
  const resolveVideoUrl = useResolveVideoUrl();
  const isInternal = useIsInternal();

  const text = (value: Text) =>
    value === undefined || typeof value === "string" ? value : i18n._(value);

  const state = cardState(card, states, rowsById);
  const row = card.rowId ? rowsById.get(card.rowId) : undefined;
  const overdue =
    state.done !== null && isOverdue(card.due, state.done, todayIso);
  const screenUrl = card.screenKey
    ? resolveScreenUrl(card.screenKey)
    : undefined;
  const openUrl = card.href ?? screenUrl;
  const watchUrl =
    (card.videoKey ? resolveVideoUrl(card.videoKey) : undefined) ??
    card.academyUrl;
  const waitingFor =
    card.kind === "task" && !state.on
      ? unmetReadiness(card.ready, counts).flatMap((count) => {
          const label = READINESS_LABEL[count];
          return label ? [i18n._(label)] : [];
        })
      : [];
  // An objective's group is its event, which the title already names; in the
  // label it only ran off the card.
  const group = card.kind === "objective" ? undefined : text(card.group);
  const checkRow = card.tick ? checkRows.get(card.tick.itemKey) : undefined;
  const hasBody =
    Boolean(card.missing) || Boolean(card.note) || waitingFor.length > 0;
  const hasFooter =
    Boolean(card.due) ||
    card.evidence.length > 0 ||
    Boolean(checkRow?.verifiedAt) ||
    (isInternal && isSourceShown(row?.source)) ||
    Boolean(openUrl) ||
    Boolean(watchUrl) ||
    Boolean(card.docsUrl);

  return (
    <Card className={cn("flex flex-col", state.done && "bg-muted/40")}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-xxs font-medium uppercase tracking-wide text-muted-foreground">
            {i18n._(PAGE_CARD_KIND_LABEL[card.kind])}
            {group ? ` · ${group}` : ""}
          </span>
          <CardStatus card={card} on={state.on} row={row} />
        </div>
        <CardTitle
          className={cn(
            "text-sm leading-snug",
            state.done && "line-through text-muted-foreground"
          )}
        >
          {text(card.title)}
        </CardTitle>
        {card.detail ? (
          <CardDescription className="text-xs text-pretty">
            {text(card.detail)}
          </CardDescription>
        ) : null}
      </CardHeader>
      {/* The panel is drawn only with something in it: an empty one read as
          half a blank card. */}
      {hasBody || hasFooter ? (
        <CardContent className="flex flex-1 flex-col gap-3 text-sm">
          {card.missing ? (
            <p className="text-xs text-muted-foreground">
              <Trans>This item was removed from the hub.</Trans>
            </p>
          ) : null}
          {card.note ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-pretty">
              {card.note}
            </p>
          ) : null}
          {waitingFor.length ? (
            <p className="text-xs text-muted-foreground">
              <Trans>Needs {waitingFor.join(", ")} first.</Trans>
            </p>
          ) : null}
          {hasFooter ? (
            <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
              {card.due ? (
                <Badge
                  variant={overdue ? "red" : "outline"}
                  className="font-normal"
                >
                  {overdue ? t`Overdue` : t`Due`}{" "}
                  {formatDate(card.due, undefined, i18n.locale)}
                </Badge>
              ) : null}
              {card.evidence.map((evidence) => (
                <EvidenceCount
                  key={evidence.count}
                  count={counts[evidence.count]}
                  label={i18n._(evidence.label)}
                  href={screenUrl}
                />
              ))}
              <VerifiedBadge row={checkRow} />
              <SourceBadge source={row?.source} />
              {openUrl ? (
                <LearnLink
                  href={openUrl}
                  icon={<LuArrowRight className="size-3" />}
                >
                  <Trans>Open</Trans>
                </LearnLink>
              ) : null}
              {watchUrl ? (
                <LearnLink href={watchUrl} icon={<LuPlay className="size-3" />}>
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
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

// The card's state control: a toggle for anything it ticks, the status of a
// customization (Carbon staff change that), nothing for training.
function CardStatus({
  card,
  on,
  row
}: {
  card: PageCard;
  on: boolean;
  row: ImplementationRowData | undefined;
}) {
  const { t, i18n } = useLingui();
  const actions = useHubActions();

  if (card.kind === "customization" && row) {
    const status = readCustomization(row.payload).status;
    return (
      <Badge
        variant={CUSTOMIZATION_STATUS_VARIANTS[status]}
        className="shrink-0"
      >
        {i18n._(CUSTOMIZATION_STATUSES[status])}
      </Badge>
    );
  }
  const tick = card.tick;
  if (!tick || card.missing) return null;

  const labels =
    tick.meaning === "scope"
      ? { on: t`In scope`, off: t`Out of scope` }
      : card.kind === "setup"
        ? { on: t`Configured`, off: t`Not yet` }
        : card.kind === "data"
          ? { on: t`Validated`, off: t`Not yet` }
          : { on: t`Done`, off: t`To do` };

  return (
    <StatusToggle
      active={on}
      activeLabel={labels.on}
      inactiveLabel={labels.off}
      withIcon={tick.meaning === "done"}
      onToggle={() =>
        actions.setCheck(tick.itemKey, tick.kind, on ? tick.off : tick.on)
      }
    />
  );
}
