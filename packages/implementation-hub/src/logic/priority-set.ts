// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A company's priority set, as a pure function of its answers and overrides:
// the category of every feature (content/priority-set.ts), and why it sits
// there. The questionnaire page, the person page card and the MCP tools all
// read it through computePrioritySet, so they can never disagree.
//
// Two starts. From defaults, every feature begins at its default category and
// answers move it. From blank, nothing is placed until an answer, the assumed
// features or a need places it, and the foundation questions are asked first.
//
// Rules, in the order they apply:
//   1. A plain effect raises a feature towards 0; it never moves one that
//      already sits higher. The highest raise wins.
//   2. A "lower" effect moves a feature away from 0, only if no answer raised it.
//   3. An override (set by hand) wins over every answer.
//   4. Needs: what a feature needs is placed no later than the feature. From
//      defaults this applies to category 0 only; on a blank start, to 0, 1
//      and 2 (a feature not needed now pulls nothing). A need set by hand is
//      never moved; it is reported instead.
//
// Stored as hub field values, one per answer (see priorityStateFromFields), so
// realtime, backups and the existing write path cover it with no new table.

import type { MessageDescriptor } from "@lingui/core";
import {
  PRIORITY_ASSUMED,
  PRIORITY_BLANK_START_EFFECTS,
  PRIORITY_FEATURES,
  PRIORITY_SECTIONS,
  PRIORITY_SYSTEM_CHOICE_LABEL,
  PRIORITY_TOOLS,
  type PriorityCategory,
  type PriorityEffect,
  type PriorityOption,
  type PriorityQuestion,
  type PrioritySection,
  type PrioritySystemChoice,
  type PrioritySystemRow,
  type PriorityTool
} from "../content/priority-set";

export type PriorityStart = "defaults" | "blank";

// The answer that changes nothing and is recorded as an open question.
export const PRIORITY_NOT_SURE = "?";

// A tool the company uses today (the systems question, Q2): the functions it
// is used for, as the question's areas (`rows`) and in the company's own words
// (`functions`), then its follow-up: anything else it is used for, how it is
// set up, its plan, and how it should work with Carbon when it is kept and
// connected. The follow-up is asked once the set has taken shape.
export interface PriorityToolAnswer {
  id: string;
  name: string;
  rows?: string[];
  functions?: string[];
  other?: string;
  setup?: string;
  plan?: PrioritySystemChoice | typeof PRIORITY_NOT_SURE;
  integration?: string;
}

export interface PriorityOverride {
  category: PriorityCategory;
  reason?: string;
  by?: string; // who set it
  at?: string; // when it was set, a UTC timestamp
}

export interface PriorityState {
  start: PriorityStart;
  // Question key -> chosen option keys, or [PRIORITY_NOT_SURE].
  answers: Record<string, string[]>;
  // The tools used today, in the order named.
  tools: PriorityToolAnswer[];
  // Feature key -> category set by hand.
  overrides: Record<string, PriorityOverride>;
  // Question keys whose answer an AI assistant entered over MCP ("systems"
  // for the tool list).
  viaAssistant: string[];
}

export const EMPTY_PRIORITY_STATE: PriorityState = {
  start: "blank",
  answers: {},
  tools: [],
  overrides: {},
  viaAssistant: []
};

export type PriorityReason =
  | { type: "answer"; question: string; option: string }
  | { type: "lower"; question: string; option: string }
  | {
      type: "system";
      row: string;
      choice: Exclude<PrioritySystemChoice, "keep">;
      tool?: string;
    }
  | { type: "assumed"; feature: string }
  | { type: "needed"; by: string }
  | { type: "override"; reason?: string; by?: string; at?: string };

export interface PrioritySet {
  // Feature key -> category; null when a blank start has not placed it.
  category: Record<string, PriorityCategory | null>;
  // Feature key -> why it sits where it is; empty at its default.
  reasons: Record<string, PriorityReason[]>;
  // A placed feature needs one of several features and none is placed in time.
  unmetNeeds: { feature: string; anyOf: string[] }[];
  // A feature needs one that was set by hand to a later category.
  overriddenNeeds: { feature: string; need: string }[];
  // Areas whose current tool is kept, connected or separate, next to a
  // feature this set places before go-live.
  adoptionRisks: { row: string; tool?: string }[];
  // Answered "not sure": question keys, and tools whose plan is not sure as
  // "tools.<id>".
  notSure: string[];
}

// ---------------------------------------------------------------------------
// Storage: one hub field value per answer
// ---------------------------------------------------------------------------

// Every company starts blank: nothing placed until an answer places it. The
// page offers no choice; Carbon staff can start a company from the defaults
// over MCP (`shared_setPriorityStart`), stored as "defaults".
export const PRIORITY_START_KEY = "priority.start";
export const priorityAnswerKey = (question: string) =>
  `priority.answer.${question}`;
// Every tool in one value: a JSON list of PriorityToolAnswer.
export const PRIORITY_TOOLS_KEY = "priority.tools";
export const PRIORITY_MAX_TOOLS = 30;
export const priorityOverrideKey = (feature: string) =>
  `priority.override.${feature}`;

// How an answer was entered. The `setPriority` mutation writes this companion
// field with every answer: `assistant` when an AI assistant wrote it over MCP,
// empty when a person did on the page, which clears an earlier mark. Never
// accepted from a client (`checkPriorityWrite` refuses the key).
export const PRIORITY_VIA_ASSISTANT = "assistant";
export const isPriorityAnswerKey = (fieldKey: string) =>
  fieldKey.startsWith("priority.answer.") || fieldKey === PRIORITY_TOOLS_KEY;
export const priorityViaKey = (fieldKey: string) =>
  `priority.via.${fieldKey.slice("priority.".length)}`;

// The longest text an answer keeps: a tool name, a reason.
const MAX_TEXT = 500;
// The longest follow-up note: how a tool is used, set up or connected.
const MAX_NOTE = 2000;
// A function in the company's own words, and how many one tool keeps.
const MAX_FUNCTION = 100;
const MAX_FUNCTIONS = 20;

const isCategory = (value: unknown): value is PriorityCategory =>
  value === 0 || value === 1 || value === 2 || value === 3;

const isSystemChoice = (
  value: unknown
): value is PrioritySystemChoice | typeof PRIORITY_NOT_SURE =>
  value === "retire" ||
  value === "later" ||
  value === "connect" ||
  value === "keep" ||
  value === PRIORITY_NOT_SURE;

// Whether a row takes a choice: a row with no features (a tool Carbon works
// next to, such as CAD) is only kept, connected or separate.
const rowTakes = (row: PrioritySystemRow, choice: unknown) =>
  choice === PRIORITY_NOT_SURE ||
  row.choices.some((allowed) => allowed === choice);

const TOOL_ID = /^[A-Za-z0-9-]{1,40}$/;

const systemRows = () =>
  priorityQuestions().flatMap((question) => question.systems ?? []);

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

// One tool, or null when it is not one. Text is trimmed and capped; areas the
// content does not list are dropped, and so is a plan none of its areas takes.
function toolAnswer(raw: unknown): PriorityToolAnswer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { id, name, rows, functions, other, setup, plan, integration } =
    raw as Record<string, unknown>;
  if (typeof id !== "string" || !TOOL_ID.test(id)) return null;
  if (typeof name !== "string") return null;
  for (const value of [other, setup, integration])
    if (value !== undefined && typeof value !== "string") return null;
  if (rows !== undefined && !Array.isArray(rows)) return null;
  if (
    functions !== undefined &&
    (!Array.isArray(functions) ||
      !functions.every((value) => typeof value === "string"))
  )
    return null;
  if (plan !== undefined && !isSystemChoice(plan)) return null;
  const known = systemRows();
  const areas = [
    ...new Set(
      (rows ?? []).filter(
        (row): row is string =>
          typeof row === "string" && known.some((r) => r.key === row)
      )
    )
  ];
  const takes = areas.every((key) =>
    rowTakes(known.find((r) => r.key === key)!, plan)
  );
  const tool: PriorityToolAnswer = { id, name: text(name, MAX_TEXT) };
  if (areas.length) tool.rows = areas;
  const seen = new Set<string>();
  const named = ((functions ?? []) as string[])
    .map((value) => text(value, MAX_FUNCTION))
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FUNCTIONS);
  if (named.length) tool.functions = named;
  const notes = {
    other: text(other, MAX_NOTE),
    setup: text(setup, MAX_NOTE)
  };
  if (notes.other) tool.other = notes.other;
  if (notes.setup) tool.setup = notes.setup;
  if (plan && takes) tool.plan = plan;
  const connects = text(integration, MAX_NOTE);
  if (connects) tool.integration = connects;
  return tool;
}

// The stored form of the tool list: what the page writes and the server keeps
// are the same text, so a save is confirmed by an exact match.
export function encodeTools(tools: PriorityToolAnswer[]): string {
  return tools.length
    ? JSON.stringify(
        tools.map((tool) => ({
          id: tool.id,
          name: tool.name,
          ...(tool.rows?.length ? { rows: tool.rows } : {}),
          ...(tool.functions?.length ? { functions: tool.functions } : {}),
          ...(tool.other ? { other: tool.other } : {}),
          ...(tool.setup ? { setup: tool.setup } : {}),
          ...(tool.plan ? { plan: tool.plan } : {}),
          ...(tool.integration ? { integration: tool.integration } : {})
        }))
      )
    : "";
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The state held in a hub's field values. Tolerant: a value that does not
// parse, or names an option, row or feature the content no longer has, is
// dropped rather than failing the page.
export function priorityStateFromFields(
  fields: ReadonlyMap<string, string>
): PriorityState {
  const start: PriorityStart =
    fields.get(PRIORITY_START_KEY) === "defaults" ? "defaults" : "blank";
  const answers: Record<string, string[]> = {};
  const overrides: Record<string, PriorityOverride> = {};
  const viaAssistant: string[] = [];
  const via = (fieldKey: string) =>
    fields.get(priorityViaKey(fieldKey)) === PRIORITY_VIA_ASSISTANT;

  for (const question of priorityQuestions()) {
    if (question.systems) {
      if (via(PRIORITY_TOOLS_KEY)) viaAssistant.push(question.key);
      continue;
    }
    const value = parseJson(fields.get(priorityAnswerKey(question.key)));
    if (!Array.isArray(value)) continue;
    const valid = new Set([
      PRIORITY_NOT_SURE,
      ...question.options.map((o) => o.key)
    ]);
    const chosen = value.filter(
      (v): v is string => typeof v === "string" && valid.has(v)
    );
    if (!chosen.length) continue;
    answers[question.key] = chosen;
    if (via(priorityAnswerKey(question.key))) viaAssistant.push(question.key);
  }

  for (const feature of PRIORITY_FEATURES) {
    const value = parseJson(fields.get(priorityOverrideKey(feature.key)));
    if (!value || typeof value !== "object") continue;
    const { category, reason, by, at } = value as Record<string, unknown>;
    if (!isCategory(category)) continue;
    overrides[feature.key] = {
      category,
      ...(typeof reason === "string" && reason ? { reason } : {}),
      ...(typeof by === "string" && by ? { by } : {}),
      ...(typeof at === "string" && at ? { at } : {})
    };
  }

  const stored = parseJson(fields.get(PRIORITY_TOOLS_KEY));
  const seen = new Set<string>();
  const tools = (Array.isArray(stored) ? stored : [])
    .map(toolAnswer)
    .filter((tool): tool is PriorityToolAnswer => {
      if (!tool?.name || seen.has(tool.id)) return false;
      seen.add(tool.id);
      return true;
    })
    .slice(0, PRIORITY_MAX_TOOLS);
  // The mark belongs to the list; with no tool left there is no answer to mark.
  const marked = tools.length
    ? viaAssistant
    : viaAssistant.filter((key) => key !== "systems");

  return { start, answers, tools, overrides, viaAssistant: marked };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

// The sections a start asks, in order. Defaults skip the foundation.
export function prioritySections(
  start: PriorityStart = "blank"
): PrioritySection[] {
  return PRIORITY_SECTIONS.filter(
    (section) => start === "blank" || !section.blankStartOnly
  );
}

export function priorityQuestions(): PriorityQuestion[] {
  return PRIORITY_SECTIONS.flatMap((section) => section.questions);
}

export function priorityQuestion(key: string): PriorityQuestion | undefined {
  return priorityQuestions().find((question) => question.key === key);
}

const chosen = (state: PriorityState, question: string, option: string) =>
  (state.answers[question] ?? []).includes(option);

// Whether a section is asked, given the answers so far. A "when" section waits
// for its question to be answered; an "unless" section is asked until then.
export function prioritySectionAsked(
  section: PrioritySection,
  state: PriorityState
): boolean {
  if (section.blankStartOnly && state.start !== "blank") return false;
  const condition = section.condition;
  if (!condition) return true;
  const hit = condition.options.some((option) =>
    chosen(state, condition.question, option)
  );
  return condition.type === "when" ? hit : !hit;
}

export function priorityQuestionAnswered(
  question: PriorityQuestion,
  state: PriorityState
): boolean {
  if (question.systems) return state.tools.length > 0;
  return (state.answers[question.key] ?? []).length > 0;
}

// Answered and total questions across the sections a company is asked.
export function priorityProgress(state: PriorityState): {
  answered: number;
  total: number;
} {
  const questions = prioritySections(state.start)
    .filter((section) => prioritySectionAsked(section, state))
    .flatMap((section) => section.questions);
  return {
    answered: questions.filter((q) => priorityQuestionAnswered(q, state))
      .length,
    total: questions.length
  };
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

type Pending = { category: PriorityCategory; reason: PriorityReason };

function push(
  bag: Map<string, Pending[]>,
  feature: string,
  category: PriorityCategory,
  reason: PriorityReason
) {
  const list = bag.get(feature) ?? [];
  list.push({ category, reason });
  bag.set(feature, list);
}

export function computePrioritySet(state: PriorityState): PrioritySet {
  const blank = state.start === "blank";
  const category: Record<string, PriorityCategory | null> = {};
  const reasons: Record<string, PriorityReason[]> = {};
  const known = new Set<string>();
  for (const feature of PRIORITY_FEATURES) {
    category[feature.key] = blank ? null : feature.defaultCategory;
    reasons[feature.key] = [];
    known.add(feature.key);
  }

  const raises = new Map<string, Pending[]>();
  const lowers = new Map<string, Pending[]>();
  // Rows whose tool stays; a risk once the set places one of their features
  // before go-live, which is known only after every rule has applied.
  const kept: { row: PrioritySystemRow; tool?: string }[] = [];
  const notSure: string[] = [];

  if (blank) {
    for (const assumed of PRIORITY_ASSUMED) {
      push(raises, assumed.feature, assumed.category, {
        type: "assumed",
        feature: assumed.feature
      });
    }
  }

  const applyEffect = (
    effect: PriorityEffect,
    question: string,
    option: string
  ) => {
    if (effect.lower) {
      push(lowers, effect.feature, effect.category, {
        type: "lower",
        question,
        option
      });
    } else {
      push(raises, effect.feature, effect.category, {
        type: "answer",
        question,
        option
      });
    }
  };

  for (const section of prioritySections(state.start)) {
    if (!prioritySectionAsked(section, state)) continue;
    for (const question of section.questions) {
      if (question.systems) {
        // The list answers the question and moves nothing; a tool's follow-up
        // places features once it names the areas and the plan.
        for (const { id, name: tool, rows = [], plan } of state.tools) {
          if (!plan) continue;
          if (plan === PRIORITY_NOT_SURE) {
            notSure.push(`tools.${id}`);
            continue;
          }
          for (const key of rows) {
            const row = question.systems.find((r) => r.key === key);
            if (!row) continue;
            if (plan === "retire" || plan === "later") {
              for (const feature of row.features) {
                push(raises, feature, plan === "retire" ? 0 : 1, {
                  type: "system",
                  row: row.key,
                  choice: plan,
                  tool
                });
              }
              continue;
            }
            // Kept: the area's features do not move; connecting places the
            // integration that connects the tool.
            if (plan === "connect") {
              for (const effect of row.connect ?? []) {
                push(raises, effect.feature, effect.category, {
                  type: "system",
                  row: row.key,
                  choice: plan,
                  tool
                });
              }
            }
            kept.push({ row, tool });
          }
        }
        continue;
      }

      const options = state.answers[question.key] ?? [];
      if (options.includes(PRIORITY_NOT_SURE)) {
        notSure.push(question.key);
        continue;
      }
      for (const key of options) {
        const option = question.options.find((o) => o.key === key);
        if (!option) continue;
        for (const effect of option.effects)
          applyEffect(effect, question.key, key);
        if (blank) {
          for (const extra of PRIORITY_BLANK_START_EFFECTS) {
            if (extra.question !== question.key || extra.option !== key)
              continue;
            for (const effect of extra.effects)
              applyEffect(effect, question.key, key);
          }
        }
        if (
          option.when &&
          chosen(state, option.when.question, option.when.option)
        ) {
          applyEffect(option.when.effect, question.key, key);
        }
      }
    }
  }

  for (const [feature, pending] of raises) {
    if (!known.has(feature)) continue;
    const best = Math.min(
      ...pending.map((p) => p.category)
    ) as PriorityCategory;
    const current = category[feature] ?? null;
    if (current === null || best < current) {
      category[feature] = best;
      reasons[feature] = pending
        .filter((p) => p.category === best)
        .map((p) => p.reason);
    }
  }
  for (const [feature, pending] of lowers) {
    if (!known.has(feature) || raises.has(feature)) continue;
    const target = Math.max(
      ...pending.map((p) => p.category)
    ) as PriorityCategory;
    const current = category[feature] ?? null;
    if (current === null || target > current) {
      category[feature] = target;
      reasons[feature] = pending.map((p) => p.reason);
    }
  }
  for (const [feature, override] of Object.entries(state.overrides)) {
    if (!known.has(feature)) continue;
    category[feature] = override.category;
    reasons[feature] = [
      {
        type: "override",
        reason: override.reason,
        by: override.by,
        at: override.at
      }
    ];
  }

  // Needs. Repeats until nothing moves, since a placed need has needs of its own.
  const unmet = new Map<string, { feature: string; anyOf: string[] }>();
  const overridden = new Map<string, { feature: string; need: string }>();
  for (let changed = true, guard = 0; changed && guard < 100; guard++) {
    changed = false;
    for (const feature of PRIORITY_FEATURES) {
      const at = category[feature.key];
      // A feature that is not needed now (3) pulls nothing forward.
      if (at === null || at === undefined || at === 3 || (!blank && at !== 0))
        continue;
      for (const group of feature.needs) {
        const met = group.some((key) => {
          const c = category[key];
          return c !== null && c !== undefined && c <= at;
        });
        if (met) continue;
        if (group.length > 1) {
          unmet.set(`${feature.key}|${group.join(",")}`, {
            feature: feature.key,
            anyOf: group
          });
          continue;
        }
        const need = group[0]!;
        if (!known.has(need)) continue;
        if (state.overrides[need]) {
          overridden.set(`${feature.key}|${need}`, {
            feature: feature.key,
            need
          });
          continue;
        }
        category[need] = at;
        reasons[need] = [{ type: "needed", by: feature.key }];
        changed = true;
      }
    }
  }

  // An alternative may have been placed after it was first reported unmet.
  const unmetNeeds = [...unmet.values()].filter(({ feature, anyOf }) => {
    const at = category[feature];
    return (
      at !== null &&
      at !== undefined &&
      !anyOf.some((key) => {
        const c = category[key];
        return c !== null && c !== undefined && c <= at;
      })
    );
  });

  const adoptionRisks = kept
    .filter(({ row }) => row.features.some((key) => category[key] === 0))
    .map(({ row, tool }) => ({ row: row.key, tool }));

  return {
    category,
    reasons,
    unmetNeeds,
    overriddenNeeds: [...overridden.values()],
    adoptionRisks,
    notSure
  };
}

// What choosing one option places, to show before it is chosen: its own
// effects plus, on a blank start, the extra ones the blank start adds. `when`
// is the effect that applies only if another question has a given answer.
export function priorityOptionPlacements(
  start: PriorityStart,
  questionKey: string,
  option: PriorityOption
): { effects: PriorityEffect[]; when?: PriorityOption["when"] } {
  const extras =
    start === "blank"
      ? PRIORITY_BLANK_START_EFFECTS.filter(
          (extra) =>
            extra.question === questionKey && extra.option === option.key
        ).flatMap((extra) => extra.effects)
      : [];
  return {
    effects: [...option.effects, ...extras],
    ...(option.when ? { when: option.when } : {})
  };
}

// What a "not sure" answer leaves open: for each unsure question or tool plan,
// in asking order, the features one of its answers would place and nothing has
// placed yet. A feature two unsure answers could place is listed under both.
export function priorityMaybe(
  state: PriorityState,
  set: PrioritySet
): { key: string; features: string[] }[] {
  const unplaced = (feature: string) =>
    (set.category[feature] ?? null) === null;
  const groups: { key: string; features: string[] }[] = [];
  for (const key of set.notSure) {
    let candidates: string[] = [];
    if (key.startsWith("tools.")) {
      const tool = state.tools.find((t) => `tools.${t.id}` === key);
      candidates = systemRows()
        .filter((row) => tool?.rows?.includes(row.key))
        .flatMap((row) => [
          ...row.features,
          ...(row.connect ?? []).map((effect) => effect.feature)
        ]);
    } else {
      const question = priorityQuestion(key);
      if (!question) continue;
      candidates = question.options.flatMap((option) => {
        const { effects, when } = priorityOptionPlacements(
          state.start,
          key,
          option
        );
        return [
          ...effects.map((effect) => effect.feature),
          ...(when ? [when.effect.feature] : [])
        ];
      });
    }
    const features = PRIORITY_FEATURES.map((f) => f.key).filter(
      (feature) => candidates.includes(feature) && unplaced(feature)
    );
    if (features.length) groups.push({ key, features });
  }
  return groups;
}

// The features in one category, in catalogue order. `null` lists the features
// a blank start has not placed.
export function priorityFeaturesIn(
  set: PrioritySet,
  target: PriorityCategory | null
) {
  return PRIORITY_FEATURES.filter(
    (feature) => (set.category[feature.key] ?? null) === target
  );
}

// The number each question shows ("Q4", foundation "F1"), in asking order for
// a start. Numbers are display only; answers are stored by key.
export function priorityQuestionNumbers(
  start: PriorityStart
): Map<string, string> {
  const numbers = new Map<string, string>();
  let foundation = 0;
  let main = 0;
  for (const section of prioritySections(start)) {
    for (const question of section.questions) {
      numbers.set(
        question.key,
        section.blankStartOnly ? `F${++foundation}` : `Q${++main}`
      );
    }
  }
  return numbers;
}

const ENTERED_BY_ASSISTANT = " Entered by an AI assistant.";

// A note as a sentence in the file: it ends with a full stop.
const sentence = (note: string) => (/[.!?]$/.test(note) ? note : `${note}.`);

export interface PriorityMarkdownOptions {
  company: string;
  // Today, as YYYY-MM-DD; used for answers without a date of their own.
  date: string;
  // Who answered, for the answer lines.
  answeredBy: string;
  // Translates a content message.
  label: (message: MessageDescriptor) => string;
  // A person's name from their user id.
  personName: (userId: string) => string | undefined;
}

// The set as the company file the priority-set markdown describes: every
// feature under its category, a moved feature with "From N: reason. who, date.",
// then open questions and answers. What staff paste or download from the page.
export function prioritySetMarkdown(
  state: PriorityState,
  set: PrioritySet,
  options: PriorityMarkdownOptions
): string {
  const { label, personName } = options;
  const numbers = priorityQuestionNumbers(state.start);
  const questionLabel = (key: string) => {
    const question = priorityQuestion(key);
    return question ? label(question.label) : key;
  };
  const optionLabel = (question: string, option: string) => {
    const found = priorityQuestion(question)?.options.find(
      (o) => o.key === option
    );
    return found ? label(found.label) : option;
  };
  const systemRow = (key: string) =>
    priorityQuestions()
      .flatMap((q) => q.systems ?? [])
      .find((row) => row.key === key);
  const featureName = (key: string) => {
    const feature = PRIORITY_FEATURES.find((f) => f.key === key);
    return feature ? label(feature.name) : key;
  };

  const reasonText = (reason: PriorityReason): string => {
    switch (reason.type) {
      case "answer":
      case "lower":
        return `${numbers.get(reason.question) ?? reason.question}, ${optionLabel(reason.question, reason.option).replace(/\.$/, "")}`;
      case "system": {
        const row = systemRow(reason.row);
        const area = row ? label(row.area) : reason.row;
        const tool = reason.tool ?? "the current tool";
        const plan = {
          retire: `replace ${tool} with Carbon`,
          later: `replace ${tool} later`,
          connect: `keep and connect ${tool}`
        }[reason.choice];
        return `${numbers.get("systems") ?? "systems"}, ${area}: ${plan}`;
      }
      case "assumed": {
        const assumed = PRIORITY_ASSUMED.find(
          (a) => a.feature === reason.feature
        );
        return assumed ? `assumed: ${label(assumed.reason)}` : "assumed";
      }
      case "needed":
        return `needed by \`${reason.by}\``;
      case "override":
        return reason.reason || "set by hand";
    }
  };

  const lines = [
    `# Priority set: ${options.company || "<company>"}`,
    "",
    `Start: ${state.start === "blank" ? "blank" : "defaults"}`,
    ""
  ];
  const heads: Record<PriorityCategory, string> = {
    0: "Category 0: live before go-live",
    1: "Category 1: first months",
    2: "Category 2: later",
    3: "Category 3: not now"
  };
  for (const category of [0, 1, 2, 3] as const) {
    lines.push(`## ${heads[category]}`, "");
    for (const feature of PRIORITY_FEATURES) {
      const at = set.category[feature.key] ?? null;
      const unplaced = at === null;
      if (unplaced ? category !== 3 : at !== category) continue;
      let line = `- \`${feature.key}\` ${label(feature.name)}`;
      if (unplaced) {
        if (feature.defaultCategory !== 3)
          line += `. From ${feature.defaultCategory}: not placed by any answer. ${options.answeredBy}, ${options.date}.`;
      } else if (at !== feature.defaultCategory) {
        const reasons = set.reasons[feature.key] ?? [];
        const override = reasons.find((r) => r.type === "override");
        const who =
          override?.type === "override" && override.by
            ? (personName(override.by) ?? override.by)
            : options.answeredBy;
        // The server stamps an override with a UTC instant; the file shows its day.
        const when =
          override?.type === "override" && override.at
            ? override.at.slice(0, 10)
            : options.date;
        line += `. From ${feature.defaultCategory}: ${reasons.map(reasonText).join("; ") || "set by hand"}. ${who}, ${when}.`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  lines.push("## Open questions", "");
  for (const key of set.notSure) {
    if (key.startsWith("tools.")) {
      const tool = state.tools.find((t) => `tools.${t.id}` === key);
      lines.push(
        `- ${numbers.get("systems") ?? "systems"}, ${tool?.name ?? "a tool"}: not sure whether Carbon replaces it.`
      );
    } else {
      lines.push(
        `- ${numbers.get(key) ?? key}: not sure. ${questionLabel(key)}`
      );
    }
  }
  for (const { feature, anyOf } of set.unmetNeeds)
    lines.push(
      `- ${featureName(feature)} needs one of: ${anyOf.map(featureName).join(", ")}.`
    );
  for (const { feature, need } of set.overriddenNeeds)
    lines.push(
      `- ${featureName(feature)} needs ${featureName(need)}, which is set by hand to a later category.`
    );
  for (const { row, tool } of set.adoptionRisks) {
    const found = systemRow(row);
    lines.push(
      `- ${found ? label(found.area) : row}: keeping ${tool ?? "the current tool"} next to Carbon is an adoption risk.`
    );
  }

  lines.push("", "## Answers", "");
  for (const section of prioritySections(state.start)) {
    const asked = prioritySectionAsked(section, state);
    for (const question of section.questions) {
      const number = numbers.get(question.key) ?? question.key;
      if (question.systems) {
        const via = state.viaAssistant.includes(question.key)
          ? ENTERED_BY_ASSISTANT
          : "";
        if (state.tools.length)
          lines.push(
            `- ${number}: ${state.tools
              .map((tool) => {
                const uses = [
                  ...(tool.rows ?? []).map((key) => {
                    const row = systemRow(key);
                    return row ? label(row.area) : key;
                  }),
                  ...(tool.functions ?? [])
                ];
                return uses.length
                  ? `${tool.name} (${uses.join(", ")})`
                  : tool.name;
              })
              .join("; ")}. ${options.answeredBy}, ${options.date}.${via}`
          );
        continue;
      }
      const chosenOptions = state.answers[question.key] ?? [];
      if (!chosenOptions.length) continue;
      const text = chosenOptions
        .map((option) =>
          option === PRIORITY_NOT_SURE
            ? "Not sure"
            : optionLabel(question.key, option).replace(/\.$/, "")
        )
        .join("; ");
      const via = state.viaAssistant.includes(question.key)
        ? ENTERED_BY_ASSISTANT
        : "";
      lines.push(
        `- ${number}: ${text}.${asked ? "" : " Section not asked; not applied."} ${options.answeredBy}, ${options.date}.${via}`
      );
    }
  }

  // Each tool's follow-up: what it is used for, how it is set up, its plan
  // and how it should connect. Kept whether or not Carbon supports the tool.
  if (state.tools.length) {
    lines.push("", "## Tools", "");
    for (const tool of state.tools) {
      const areas = (tool.rows ?? []).map((key) => {
        const row = systemRow(key);
        return row ? label(row.area) : key;
      });
      const parts = [
        areas.length || tool.functions?.length || tool.other
          ? `Used for: ${[...areas, ...(tool.functions ?? []), ...(tool.other ? [tool.other] : [])].join("; ")}.`
          : "",
        tool.setup ? `Set up: ${sentence(tool.setup)}` : "",
        tool.plan
          ? `Plan: ${tool.plan === PRIORITY_NOT_SURE ? "not sure" : label(PRIORITY_SYSTEM_CHOICE_LABEL[tool.plan])}.`
          : "",
        tool.integration ? `Connect: ${sentence(tool.integration)}` : ""
      ].filter(Boolean);
      lines.push(
        `- ${tool.name}. ${parts.length ? parts.join(" ") : "Follow-up not answered."}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Today's tools
// ---------------------------------------------------------------------------

// A tool name as matched: case, spaces and punctuation ignored.
const toolKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

// What Carbon supports for a tool a company names, by its name or an alias;
// undefined when Carbon has no integration or import for it.
export function priorityToolSupport(
  tool: string | undefined
): PriorityTool | undefined {
  const key = toolKey(tool ?? "");
  if (!key) return undefined;
  return PRIORITY_TOOLS.find((known) =>
    [known.name, ...known.aliases].some((name) => toolKey(name) === key)
  );
}

// Whether a tool's follow-up is answered: what it is used for and its plan.
export function priorityToolDescribed(tool: PriorityToolAnswer): boolean {
  return (
    !!tool.plan &&
    (!!tool.rows?.length || !!tool.functions?.length || !!tool.other)
  );
}

// The question's answers as the page lists them: one entry per starter
// function, with its tool, then one per other function a tool is used for
// (another area, or one in the company's own words), and one for each tool
// named without a function.
export type PriorityFunction = { row: string } | { text: string };

export interface PriorityFunctionEntry {
  key: string;
  func: PriorityFunction;
  starter: boolean;
  toolId?: string;
  tool: string;
}

export function priorityFunctionEntries(
  state: PriorityState
): PriorityFunctionEntry[] {
  const rows = systemRows();
  const owner = (row: string) => state.tools.find((t) => t.rows?.includes(row));
  const entries: PriorityFunctionEntry[] = rows
    .filter((row) => row.starter)
    .map((row) => {
      const tool = owner(row.key);
      return {
        key: `row:${row.key}`,
        func: { row: row.key },
        starter: true,
        toolId: tool?.id,
        tool: tool?.name ?? ""
      };
    });
  for (const tool of state.tools) {
    const base = { starter: false, toolId: tool.id, tool: tool.name };
    for (const row of rows)
      if (!row.starter && tool.rows?.includes(row.key))
        entries.push({
          ...base,
          key: `row:${row.key}`,
          func: { row: row.key }
        });
    for (const text of tool.functions ?? [])
      entries.push({ ...base, key: `text:${tool.id}:${text}`, func: { text } });
    if (!tool.rows?.length && !tool.functions?.length)
      entries.push({ ...base, key: `tool:${tool.id}`, func: { text: "" } });
  }
  return entries;
}

const sameName = (a: string, b: string) => toolKey(a) === toolKey(b);

// A tool with nothing recorded but its name, once its last function is gone.
const bare = (tool: PriorityToolAnswer) =>
  !tool.rows?.length &&
  !tool.functions?.length &&
  !tool.other &&
  !tool.setup &&
  !tool.plan &&
  !tool.integration;

const withoutFunction = (
  tool: PriorityToolAnswer,
  func: PriorityFunction
): PriorityToolAnswer =>
  "row" in func
    ? { ...tool, rows: tool.rows?.filter((row) => row !== func.row) }
    : {
        ...tool,
        functions: tool.functions?.filter(
          (text) => text.toLowerCase() !== func.text.toLowerCase()
        )
      };

const withFunction = (
  tool: PriorityToolAnswer,
  func: PriorityFunction
): PriorityToolAnswer =>
  "row" in func
    ? { ...tool, rows: [...new Set([...(tool.rows ?? []), func.row])] }
    : func.text
      ? {
          ...tool,
          functions: [
            ...(tool.functions ?? []).filter(
              (text) => text.toLowerCase() !== func.text.toLowerCase()
            ),
            func.text
          ]
        }
      : tool;

// The list after a function's tool is named or changed: the function leaves
// the tool it was on (an area leaves every tool, since one tool covers it) and
// joins the tool with that name, which is added when it is new. A tool left
// with nothing recorded is dropped; an empty name only removes. On the entry
// of a tool named without a function, the name renames the tool, and an empty
// name removes it.
export function withFunctionTool(
  tools: PriorityToolAnswer[],
  func: PriorityFunction,
  fromToolId: string | undefined,
  name: string,
  newId: () => string
): PriorityToolAnswer[] {
  const trimmed = name.trim().slice(0, MAX_TEXT);
  const from = tools.find((tool) => tool.id === fromToolId);
  if (from && "text" in func && !func.text) {
    return trimmed
      ? tools.map((tool) =>
          tool.id === from.id ? { ...tool, name: trimmed } : tool
        )
      : tools.filter((tool) => tool.id !== from.id);
  }
  const next = tools.flatMap((tool) => {
    if (!("row" in func) && tool.id !== fromToolId) return [tool];
    const left = withoutFunction(tool, func);
    return bare(left) && !bare(tool) ? [] : [left];
  });
  if (!trimmed) return next;
  const target = next.find((tool) => sameName(tool.name, trimmed));
  return target
    ? next.map((tool) =>
        tool.id === target.id ? withFunction(tool, func) : tool
      )
    : [...next, withFunction({ id: newId(), name: trimmed }, func)];
}

// The list after a function's name is changed on one tool: an area becomes
// the new function. An empty name leaves the tool listed without it.
export function withFunctionRenamed(
  tools: PriorityToolAnswer[],
  toolId: string,
  from: PriorityFunction,
  to: PriorityFunction
): PriorityToolAnswer[] {
  return tools.map((tool) => {
    if (tool.id === toolId)
      return withFunction(withoutFunction(tool, from), to);
    // An area belongs to one tool.
    return "row" in to ? withoutFunction(tool, to) : tool;
  });
}

// ---------------------------------------------------------------------------
// Writes: what the server accepts
// ---------------------------------------------------------------------------

export const isPriorityOverrideKey = (fieldKey: string) =>
  fieldKey.startsWith("priority.override.");

// Pure: check one priority write and return the value to store, or why it is
// refused. An empty value clears the answer. Values are re-encoded, so what is
// stored is always canonical. Who may make an override is the caller's rule;
// the server adds who set it and when (`stampPriorityOverride`).
export function checkPriorityWrite(
  fieldKey: string,
  value: string
): { value: string } | { error: string } {
  if (fieldKey === PRIORITY_START_KEY) {
    if (value === "" || value === "blank") return { value: "" };
    return value === "defaults"
      ? { value }
      : { error: "The start is blank or defaults" };
  }

  if (fieldKey.startsWith("priority.answer.")) {
    const question = priorityQuestion(
      fieldKey.slice("priority.answer.".length)
    );
    if (!question || question.systems) return { error: "Unknown question" };
    if (value === "") return { value };
    const parsed = parseJson(value);
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string"))
      return { error: "An answer is a list of options" };
    const options = Array.from(new Set(parsed as string[]));
    if (options.includes(PRIORITY_NOT_SURE)) {
      return options.length === 1
        ? { value: JSON.stringify(options) }
        : { error: "Not sure cannot be combined with an option" };
    }
    const valid = new Set(question.options.map((o) => o.key));
    if (!options.every((o) => valid.has(o))) return { error: "Unknown option" };
    if (!question.multiple && options.length > 1)
      return { error: "This question takes one option" };
    return { value: options.length ? JSON.stringify(options) : "" };
  }

  if (fieldKey === PRIORITY_TOOLS_KEY) {
    if (value === "") return { value };
    const parsed = parseJson(value);
    if (!Array.isArray(parsed)) return { error: "The tools are a list" };
    if (parsed.length > PRIORITY_MAX_TOOLS)
      return { error: `At most ${PRIORITY_MAX_TOOLS} tools` };
    const tools: PriorityToolAnswer[] = [];
    for (const raw of parsed) {
      const tool = toolAnswer(raw);
      if (!tool) return { error: "Not a tool" };
      if (!tool.name) return { error: "A tool needs a name" };
      const { rows, plan } = raw as { rows?: unknown[]; plan?: unknown };
      if (new Set(rows ?? []).size !== (tool.rows ?? []).length)
        return { error: "Unknown area" };
      if (plan !== undefined && !tool.plan)
        return {
          error:
            "Carbon does not replace a tool for CAD or nesting: keep it, connected or separate"
        };
      if (tools.some((other) => other.id === tool.id))
        return { error: "Two tools share an id" };
      tools.push(tool);
    }
    return { value: encodeTools(tools) };
  }

  if (isPriorityOverrideKey(fieldKey)) {
    const feature = fieldKey.slice("priority.override.".length);
    if (!PRIORITY_FEATURES.some((f) => f.key === feature))
      return { error: "Unknown feature" };
    if (value === "") return { value };
    const parsed = parseJson(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { error: "An override is an object" };
    const { category, reason } = parsed as Record<string, unknown>;
    if (!isCategory(category)) return { error: "A category is 0, 1, 2 or 3" };
    if (reason !== undefined && typeof reason !== "string")
      return { error: "A reason is text" };
    const why =
      typeof reason === "string" ? reason.trim().slice(0, MAX_TEXT) : "";
    return {
      value: JSON.stringify({ category, ...(why ? { reason: why } : {}) })
    };
  }

  return { error: "Not a priority set answer" };
}

// Pure: an override as stored, with who set it and when.
export function stampPriorityOverride(
  value: string,
  by: string,
  at: string
): string {
  if (value === "") return value;
  const parsed = parseJson(value) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, by, at });
}
