// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The open questions a person's page places, as one numbered list answered in
// place, like the priority set questionnaire: choice cards when the question
// lists options, a typed answer otherwise. An answer sets the question's tick,
// so it counts towards the page's progress and reads answered everywhere.

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChoiceCardGroup,
  type ChoiceCardOption,
  MultiChoiceCardGroup
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { isOverdue } from "../logic/assignments";
import { cardState, type PageCard } from "../logic/page";
import {
  nextQuestionSelection,
  QUESTION_NOT_SURE,
  readQuestion
} from "../logic/question";
import type { ImplementationRowData } from "../types";
import { EditableInput, SourceBadge } from "./primitives";
import { useCheckMap, useHubActions, useShowsStaffDetail } from "./state";

export function PageQuestions({
  questions,
  rowsById,
  todayIso
}: {
  questions: PageCard[];
  rowsById: Map<string, ImplementationRowData>;
  todayIso: string;
}) {
  const states = useCheckMap();
  if (questions.length === 0) return null;
  const total = questions.length;
  const answered = questions.filter(
    (card) => cardState(card, states, rowsById).on
  ).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          <Trans>Questions</Trans>
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          <Trans>
            {answered} of {total} answered
          </Trans>
        </span>
      </div>
      <div className="flex max-w-3xl flex-col gap-3">
        {questions.map((card, index) => {
          const row = card.rowId ? rowsById.get(card.rowId) : undefined;
          return row ? (
            <QuestionCard
              key={card.id}
              number={index + 1}
              card={card}
              row={row}
              answered={cardState(card, states, rowsById).on}
              todayIso={todayIso}
            />
          ) : null;
        })}
      </div>
    </section>
  );
}

function QuestionCard({
  number,
  card,
  row,
  answered,
  todayIso
}: {
  number: number;
  card: PageCard;
  row: ImplementationRowData;
  answered: boolean;
  todayIso: string;
}) {
  const { t, i18n } = useLingui();
  const actions = useHubActions();
  const showsStaffDetail = useShowsStaffDetail();
  const question = readQuestion(row.payload);
  const chosen = question.selected ?? [];
  // Not sure leaves the question open; the badge says so in the list.
  const notSure = !answered && chosen.includes(QUESTION_NOT_SURE);
  const overdue = isOverdue(card.due, answered, todayIso);
  const title =
    card.title === undefined || typeof card.title === "string"
      ? card.title
      : i18n._(card.title);
  // Where an answer came from is shown to Carbon staff when it was not typed
  // on this page.
  const fromElsewhere =
    showsStaffDetail &&
    (row.source === "mcp" ||
      row.source === "handover" ||
      row.source === "interview");

  const options: ChoiceCardOption[] = [
    ...(question.options ?? []).map((option) => ({
      value: option,
      title: option
    })),
    { value: QUESTION_NOT_SURE, title: t`Not sure` }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {/* A question is read in full: no two-line clamp. */}
          <CardTitle className="text-sm leading-snug line-clamp-none">
            <span className="text-muted-foreground tabular-nums mr-1.5">
              {number}
            </span>
            {title}
          </CardTitle>
          {answered ? (
            <Badge variant="green" className="shrink-0">
              <Trans>Answered</Trans>
            </Badge>
          ) : notSure ? (
            <Badge variant="gray" className="shrink-0">
              <Trans>Not sure</Trans>
            </Badge>
          ) : null}
        </div>
        {card.note || question.multiple ? (
          <CardDescription className="text-pretty">
            {card.note}
            {card.note && question.multiple ? " " : null}
            {question.multiple ? <Trans>Pick all that apply.</Trans> : null}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!question.options ? (
          <EditableInput
            value={question.answer ?? ""}
            placeholder={t`Your answer`}
            variant="muted"
            multiline
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
        {card.due || fromElsewhere ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {card.due ? (
              <Badge
                variant={overdue ? "red" : "outline"}
                className="font-normal"
              >
                {overdue ? t`Overdue` : t`Due`}{" "}
                {formatDate(card.due, undefined, i18n.locale)}
              </Badge>
            ) : null}
            <SourceBadge source={row.source} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
