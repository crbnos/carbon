// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { PageCard, PageSection } from "./page";
import { splitPageQuestions } from "./page";
import {
  answerQuestionPayload,
  nextQuestionSelection,
  QUESTION_NOT_SURE,
  questionAnswered,
  readQuestion,
  withPendingAnswers,
  withQuestionAnswer
} from "./question";

describe("readQuestion", () => {
  it("reads a typed question", () => {
    expect(
      readQuestion({
        question: "Who owns labels?",
        answer: "The plant manager"
      })
    ).toEqual({ question: "Who owns labels?", answer: "The plant manager" });
  });

  it("keeps clean, unique options and drops choices outside them", () => {
    expect(
      readQuestion({
        question: "Base currency?",
        options: [" EUR ", "NOK", "EUR", "", 3, QUESTION_NOT_SURE],
        selected: ["NOK", "USD"]
      })
    ).toEqual({
      question: "Base currency?",
      options: ["EUR", "NOK"],
      selected: ["NOK"]
    });
  });

  it("keeps one choice unless the question allows several", () => {
    const payload = {
      question: "Which areas?",
      options: ["A", "B"],
      selected: ["A", "B"]
    };
    expect(readQuestion(payload).selected).toEqual(["A"]);
    expect(readQuestion({ ...payload, multiple: true }).selected).toEqual([
      "A",
      "B"
    ]);
  });

  it("keeps Not sure alone", () => {
    expect(
      readQuestion({
        question: "Q",
        options: ["A"],
        multiple: true,
        selected: ["A", QUESTION_NOT_SURE]
      }).selected
    ).toEqual([QUESTION_NOT_SURE]);
  });

  it("ignores choices on a question without options", () => {
    expect(readQuestion({ question: "Q", selected: ["A"] })).toEqual({
      question: "Q"
    });
  });
});

describe("questionAnswered", () => {
  it("counts a typed answer or a chosen option, not Not sure", () => {
    expect(questionAnswered({ question: "Q" })).toBe(false);
    expect(questionAnswered({ question: "Q", answer: "Yes" })).toBe(true);
    expect(
      questionAnswered({ question: "Q", options: ["A"], selected: ["A"] })
    ).toBe(true);
    expect(
      questionAnswered({
        question: "Q",
        options: ["A"],
        selected: [QUESTION_NOT_SURE]
      })
    ).toBe(false);
  });
});

describe("nextQuestionSelection", () => {
  it("lets Not sure clear the options, and an option clear Not sure", () => {
    expect(nextQuestionSelection(["A"], ["A", QUESTION_NOT_SURE])).toEqual([
      QUESTION_NOT_SURE
    ]);
    expect(
      nextQuestionSelection([QUESTION_NOT_SURE], [QUESTION_NOT_SURE, "B"])
    ).toEqual(["B"]);
    expect(nextQuestionSelection(["A", "B"], ["A"])).toEqual(["A"]);
  });
});

describe("withQuestionAnswer", () => {
  const payload = {
    question: "Q",
    options: ["A", "B"],
    selected: ["A"],
    note: "kept"
  };

  it("writes choices and keeps every other key", () => {
    expect(withQuestionAnswer(payload, { selected: ["B"] })).toEqual({
      question: "Q",
      options: ["A", "B"],
      note: "kept",
      selected: ["B"]
    });
  });

  it("removes an emptied answer or choice", () => {
    expect(withQuestionAnswer(payload, { selected: [] })).toEqual({
      question: "Q",
      options: ["A", "B"],
      note: "kept"
    });
    expect(
      withQuestionAnswer({ question: "Q", answer: "Old" }, { answer: "  " })
    ).toEqual({ question: "Q" });
  });
});

describe("splitPageQuestions", () => {
  const card = (
    id: string,
    kind: PageCard["kind"],
    extra: Partial<PageCard> = {}
  ) =>
    ({ id, kind, title: id, tick: null, evidence: [], ...extra }) as PageCard;
  const sections: PageSection[] = [
    {
      id: "section-0",
      title: "Decisions",
      cards: [
        card("question:a", "question", { rowId: "a" }),
        card("question:b", "question", { rowId: "b" })
      ]
    },
    {
      id: "section-1",
      title: "Setup",
      cards: [
        card("setup:suppliers", "setup"),
        card("question:c", "question", { rowId: "c" }),
        card("question:gone", "question", { missing: true })
      ]
    }
  ];

  it("lists the questions in page order and drops emptied sections", () => {
    const split = splitPageQuestions(sections);
    expect(split.questions.map((q) => q.id)).toEqual([
      "question:a",
      "question:b",
      "question:c"
    ]);
    expect(split.sections.map((s) => s.title)).toEqual(["Setup"]);
    expect(split.sections[0]?.cards.map((c) => c.id)).toEqual([
      "setup:suppliers",
      "question:gone"
    ]);
  });
});

describe("answerQuestionPayload", () => {
  const payload = { question: "Q", options: ["A", "B"] };

  it("answers with a choice and drops one outside the options", () => {
    expect(answerQuestionPayload(payload, { selected: ["B", "C"] })).toEqual({
      payload: { question: "Q", options: ["A", "B"], selected: ["B"] },
      answered: true
    });
  });

  it("leaves the question open on Not sure or an empty answer", () => {
    expect(
      answerQuestionPayload(payload, { selected: [QUESTION_NOT_SURE] }).answered
    ).toBe(false);
    expect(
      answerQuestionPayload({ question: "Q", answer: "Yes" }, { answer: "" })
    ).toEqual({ payload: { question: "Q" }, answered: false });
  });
});

describe("withPendingAnswers", () => {
  const row: { id: string; payload: Record<string, unknown> } = {
    id: "r1",
    payload: { question: "Q", options: ["A", "B"] }
  };

  it("shows a pending choice until the row holds it", () => {
    const pending = new Map([["r1", { selected: ["A"] }]]);
    const first = withPendingAnswers([row], pending);
    expect(first.rows[0]?.payload.selected).toEqual(["A"]);
    expect(first.pending.size).toBe(1);

    const saved = { ...row, payload: { ...row.payload, selected: ["A"] } };
    const second = withPendingAnswers([saved], first.pending);
    expect(second.rows[0]).toBe(saved);
    expect(second.pending.size).toBe(0);
  });
});
