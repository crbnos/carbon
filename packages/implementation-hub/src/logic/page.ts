// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A person's hub page: the catalogue of hub items a page can place, the checks
// a page file must pass, and what each card shows and ticks. Pure, so the app,
// the MCP tools and the tests share one definition.

import { isInternalEmail } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { BOARD_TASKS } from "../content/board";
import { CUSTOMIZATION_KINDS } from "../content/customization";
import { DATA_GROUPS } from "../content/data";
import {
  PRODUCT_STEP_EVIDENCE,
  PRODUCT_STEP_EVIDENCE_LABEL,
  SETUP_ROW_EVIDENCE,
  TASK_EVIDENCE_LABEL
} from "../content/evidence";
import { CUTOVER_STEPS } from "../content/golive";
import { OBJECTIVE_EVENTS } from "../content/objectives";
import {
  OBJECTIVE_EVIDENCE_LABEL,
  type PageCardKind,
  type PageItemKind,
  PRIORITY_CARD,
  SETUP_EVIDENCE_LABEL
} from "../content/page";
import { REQUIREMENTS } from "../content/requirements";
import { SETUP_GROUPS } from "../content/setup";
import { SPINE } from "../content/spine";
import { TRAINING_TRACKS } from "../content/training";
import {
  type MemberPage,
  type MemberPageCard,
  memberPageValidator
} from "../models";
import type { ImplementationRowData, ReadinessRule, StateKind } from "../types";
import { isCustomizationKind, readCustomization } from "./customization";
import { checkKey, flagKey, productStepKey, taskKey } from "./keys";
import { readObjective } from "./objectives";
import type { OnboardingCountKey } from "./status";

type Text = MessageDescriptor | string;

// The state a card ticks. `done` counts toward the page's progress; `scope` is
// an in/out toggle (a requirement), in scope until someone says otherwise.
export interface PageTick {
  itemKey: string;
  kind: StateKind;
  on: string;
  off: string;
  meaning: "done" | "scope";
}

export interface PageEvidence {
  count: OnboardingCountKey;
  label: MessageDescriptor;
}

// One hub item a page can place, by its key.
export interface PageCatalogueEntry {
  item: string;
  kind: PageItemKind;
  title: Text;
  detail?: Text;
  // Where it sits in the hub template: a Setup Map group, a phase, a module.
  group?: Text;
  tick: PageTick | null;
  evidence: PageEvidence[];
  // A Carbon screen, resolved by the app (`resolveScreenUrl`).
  screenKey?: string;
  // A link stored on a custom row.
  href?: string;
  videoKey?: string;
  docsUrl?: string;
  academyUrl?: string;
  // An operational task waits for these records before it can be done.
  ready?: ReadinessRule;
  // The custom row behind the card (objective, question, customization...).
  rowId?: string;
  // The row's own target date, used when the page sets no due date.
  targetDate?: string;
  // A customization's estimate, in days.
  estimateDays?: number;
  // The title of the requirement a customization serves; none once that
  // requirement is deleted.
  serves?: Text;
}

export interface PageCard extends Omit<PageCatalogueEntry, "kind" | "item"> {
  // Unique on the page: the item key, or custom:<key>.
  id: string;
  kind: PageCardKind;
  note?: string;
  due?: string;
  // The item was removed from the hub after the page was loaded.
  missing?: boolean;
}

export interface PageSection {
  // Its position on the page: sections have no key of their own.
  id: string;
  title: string;
  intro?: string;
  cards: PageCard[];
}

const setupKey = (id: string) => flagKey(`setup.${id}`);
const dataKey = (id: string) => flagKey(`data.${id}`);

const doneFlag = (itemKey: string): PageTick => ({
  itemKey,
  kind: "scopeFlag",
  on: "1",
  off: "0",
  meaning: "done"
});
const doneCheck = (itemKey: string): PageTick => ({
  itemKey,
  kind: "check",
  on: "1",
  off: "0",
  meaning: "done"
});

// A person's tick on one of their custom cards.
export const customCardKey = (userId: string, key: string) =>
  checkKey("custom", `${userId}.${key}`);

const stepTitle = new Map(SPINE.map((step) => [step.key, step.title]));

// The hub items every company has: the template. Built once.
function templateEntries(): PageCatalogueEntry[] {
  const entries: PageCatalogueEntry[] = [];

  for (const group of SETUP_GROUPS) {
    for (const row of group.rows) {
      const evidence = SETUP_ROW_EVIDENCE[row.key];
      entries.push({
        item: `setup:${row.key}`,
        kind: "setup",
        title: row.object,
        detail: row.detail,
        group: group.title,
        tick: doneFlag(setupKey(row.key)),
        evidence: evidence
          ? [{ count: evidence, label: SETUP_EVIDENCE_LABEL }]
          : [],
        screenKey: row.key,
        docsUrl: group.docsUrl,
        academyUrl: group.academyUrl
      });
    }
  }

  // A Configure group task rolls up its Setup Map rows: place the rows instead.
  // The first documents are listed twice (one per tier's phase); once is enough.
  const seen = new Set<string>();
  for (const task of BOARD_TASKS) {
    if (task.setupKeys || seen.has(task.key)) continue;
    seen.add(task.key);
    const label = task.evidence
      ? TASK_EVIDENCE_LABEL[task.evidence]
      : undefined;
    entries.push({
      item: `task:${task.key}`,
      kind: "task",
      title: task.label,
      detail: task.hint,
      group: stepTitle.get(task.stepKey),
      tick: {
        itemKey: taskKey(task.key),
        kind: "task",
        on: "done",
        off: "todo",
        meaning: "done"
      },
      evidence: task.evidence && label ? [{ count: task.evidence, label }] : [],
      screenKey: task.evidence ? task.key : undefined,
      docsUrl: task.docsUrl,
      academyUrl: task.academyUrl,
      ready: task.ready
    });
  }

  for (const step of SPINE) {
    for (const nested of step.nested ?? []) {
      // "Set up your resources and settings" pointed at the Setup Map; a page
      // places those setup items directly.
      if (nested.key === productStepKey("configure-data")) continue;
      const slug = nested.key.slice("prod:".length);
      entries.push({
        item: `step:${slug}`,
        kind: "step",
        title: nested.label,
        detail: nested.detail,
        group: step.title,
        tick: {
          itemKey: nested.key,
          kind: "productStep",
          on: "done",
          off: "todo",
          meaning: "done"
        },
        evidence: (PRODUCT_STEP_EVIDENCE[nested.key] ?? []).flatMap((count) => {
          const label = PRODUCT_STEP_EVIDENCE_LABEL[count];
          return label ? [{ count, label }] : [];
        }),
        screenKey: nested.key,
        videoKey: nested.videoKey,
        docsUrl: nested.docsUrl
      });
    }
  }

  for (const group of DATA_GROUPS) {
    for (const row of group.rows) {
      entries.push({
        item: `data:${row.key}`,
        kind: "data",
        title: row.object,
        detail: row.today,
        group: group.title,
        tick: doneFlag(dataKey(row.key)),
        evidence: []
      });
    }
  }

  for (const track of TRAINING_TRACKS) {
    for (const course of track.courses) {
      entries.push({
        item: `training:${course.key}`,
        kind: "training",
        title: course.course,
        detail: course.audience,
        group: track.title,
        tick: null,
        evidence: [],
        videoKey: course.videoKey,
        docsUrl: course.docsUrl
      });
    }
  }

  for (const step of CUTOVER_STEPS) {
    entries.push({
      item: `cutover:${step.key}`,
      kind: "cutover",
      title: step.label,
      tick: doneCheck(checkKey("cutover", step.key)),
      evidence: []
    });
  }

  for (const mod of REQUIREMENTS) {
    for (const area of mod.areas) {
      for (const row of area.rows) {
        entries.push({
          item: `requirement:${row.code}`,
          kind: "requirement",
          title: row.requirement,
          detail: row.code,
          group: mod.name,
          tick: {
            itemKey: flagKey(row.code),
            kind: "scopeFlag",
            on: "1",
            off: "0",
            meaning: "scope"
          },
          evidence: []
        });
      }
    }
  }

  entries.push({
    item: PRIORITY_CARD.item,
    kind: "priority",
    title: PRIORITY_CARD.title,
    detail: PRIORITY_CARD.detail,
    tick: doneCheck(checkKey("priority", "questionnaire")),
    evidence: [],
    screenKey: PRIORITY_CARD.screenKey
  });

  return entries;
}

let template: PageCatalogueEntry[] | null = null;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

// The hub items this company added: custom rows, each under the same state
// key its own hub page used.
function rowEntry(row: ImplementationRowData): PageCatalogueEntry | null {
  const p = row.payload ?? {};
  switch (row.collection) {
    case "setup":
      return {
        item: `setup:${row.id}`,
        kind: "setup",
        title: text(p.object) ?? row.id,
        detail: text(p.today),
        tick: doneFlag(setupKey(row.id)),
        evidence: [],
        href: text(p.url),
        rowId: row.id
      };
    case "data":
      return {
        item: `data:${row.id}`,
        kind: "data",
        title: text(p.object) ?? row.id,
        detail: text(p.today),
        tick: doneFlag(dataKey(row.id)),
        evidence: [],
        rowId: row.id
      };
    case "golive":
      return {
        item: `cutover:${row.id}`,
        kind: "cutover",
        title: text(p.label) ?? row.id,
        tick: doneCheck(checkKey("cutover", row.id)),
        evidence: [],
        rowId: row.id
      };
    case "requirement":
      return {
        item: `requirement:${row.id}`,
        kind: "requirement",
        title: text(p.requirement) ?? row.id,
        tick: {
          itemKey: flagKey(row.id),
          kind: "scopeFlag",
          on: "1",
          off: "0",
          meaning: "scope"
        },
        evidence: [],
        rowId: row.id
      };
    case "objective": {
      const objective = readObjective(p);
      const event = objective.event ? OBJECTIVE_EVENTS[objective.event] : null;
      return {
        item: `objective:${row.id}`,
        kind: "objective",
        title: objective.title || row.id,
        detail: objective.detail,
        group: event?.label,
        tick: doneCheck(checkKey("objective", row.id)),
        evidence: event
          ? [{ count: event.countKey, label: OBJECTIVE_EVIDENCE_LABEL }]
          : [],
        rowId: row.id,
        targetDate: objective.targetDate
      };
    }
    case "question":
      return {
        item: `question:${row.id}`,
        kind: "question",
        title: text(p.question) ?? row.id,
        tick: doneCheck(checkKey("question", row.id)),
        evidence: [],
        rowId: row.id
      };
    case "customization": {
      const customization = readCustomization(p);
      return {
        item: `customization:${row.id}`,
        kind: "customization",
        title: customization.title || row.id,
        detail: customization.detail,
        // Its type of work, where other cards show their group. A row whose
        // type was never set shows none, not the default.
        group: isCustomizationKind(p.kind)
          ? CUSTOMIZATION_KINDS[p.kind]
          : undefined,
        tick: null,
        evidence: [],
        rowId: row.id,
        targetDate: customization.targetDate,
        estimateDays: customization.estimateDays
      };
    }
    default:
      return null;
  }
}

// Every hub item a page can place: the template, then the company's own rows.
export function buildPageCatalogue(
  rows: ImplementationRowData[]
): PageCatalogueEntry[] {
  template ??= templateEntries();
  const catalogue = [
    ...template,
    ...rows.flatMap((row) => {
      const entry = rowEntry(row);
      return entry ? [entry] : [];
    })
  ];
  // A customization stores the requirement it serves by id: a template
  // requirement's code or a requirement row's id.
  const items = catalogueByItem(catalogue);
  for (const row of rows) {
    if (row.collection !== "customization") continue;
    const served = readCustomization(row.payload ?? {}).requirementRowId;
    const entry = items.get(`customization:${row.id}`);
    if (served && entry)
      entry.serves = items.get(`requirement:${served}`)?.title;
  }
  return catalogue;
}

// A requirement's scope toggle: in scope until someone says otherwise.
const inScope = (tick: PageTick, states: Map<string, string>) =>
  (states.get(tick.itemKey) ?? tick.on) === tick.on;

export interface RequirementChoice {
  // What a customization stores: a template requirement's code or a
  // requirement row's id.
  id: string;
  title: Text;
  inScope: boolean;
}

// Pure: the requirements a customization can serve, in catalogue order.
export function requirementChoices(
  catalogue: PageCatalogueEntry[],
  states: Map<string, string>
): RequirementChoice[] {
  return catalogue.flatMap((entry) =>
    entry.kind === "requirement" && entry.tick
      ? [
          {
            id: entry.item.slice("requirement:".length),
            title: entry.title,
            inScope: inScope(entry.tick, states)
          }
        ]
      : []
  );
}

export function catalogueByItem(
  catalogue: PageCatalogueEntry[]
): Map<string, PageCatalogueEntry> {
  return new Map(catalogue.map((entry) => [entry.item, entry]));
}

const cardPath = (s: number, c: number) => `sections[${s}].cards[${c}]`;

// Pure: what is wrong with a page that the schema cannot see. Unknown items,
// and a card placed twice (its tick would show twice). Reads the page loosely,
// so a file the schema refuses still gets these checks in the same pass.
export function pageProblems(
  page: MemberPage | unknown,
  items: Map<string, PageCatalogueEntry>
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const sections = arrayAt(page, "sections");
  sections.forEach((section, s) => {
    arrayAt(section, "cards").forEach((card, c) => {
      const path = cardPath(s, c);
      const item = stringAt(card, "item");
      const customKey = stringAt(objectAt(card, "custom"), "key");
      if (item && !items.has(item)) {
        problems.push(
          `${path}.item: "${item}" is not a hub item. Read the catalogue for the valid keys.`
        );
      }
      const id = item ?? (customKey ? `custom:${customKey}` : null);
      if (!id) return;
      const first = seen.get(id);
      if (first) {
        problems.push(`${path}: ${id} is already on this page at ${first}.`);
      } else {
        seen.set(id, path);
      }
    });
  });
  return problems;
}

const objectAt = (value: unknown, key: string): unknown =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
const arrayAt = (value: unknown, key: string): unknown[] => {
  const found = objectAt(value, key);
  return Array.isArray(found) ? found : [];
};
const stringAt = (value: unknown, key: string): string | undefined => {
  const found = objectAt(value, key);
  return typeof found === "string" ? found : undefined;
};

const cardId = (card: MemberPageCard) =>
  card.item ?? `custom:${card.custom?.key ?? ""}`;

// The order a problem's path sorts in: page-level first, then by section and
// card, so the list reads top to bottom like the file.
function pathOrder(problem: string): [number, number] {
  const match = /^sections\[(\d+)\](?:\.cards\[(\d+)\])?/.exec(problem);
  if (!match) return [-1, -1];
  return [Number(match[1]), match[2] === undefined ? -1 : Number(match[2])];
}

// Pure: read a page file (JSON text or an object) and check it. Lists every
// problem in one pass and returns the page only when there are none, so
// nothing half-loads.
export function checkMemberPage(
  input: unknown,
  items: Map<string, PageCatalogueEntry>
): { page: MemberPage | null; problems: string[] } {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return {
        page: null,
        problems: [
          `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
        ]
      };
    }
  }
  const parsed = memberPageValidator.safeParse(value);
  const schemaProblems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const path = issue.path
          .map((part) =>
            typeof part === "number" ? `[${part}]` : `.${String(part)}`
          )
          .join("")
          .replace(/^\./, "");
        return path ? `${path}: ${issue.message}` : issue.message;
      });
  const problems = [...schemaProblems, ...pageProblems(value, items)]
    .map((problem, index) => ({ problem, index, order: pathOrder(problem) }))
    .sort(
      (a, b) =>
        a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.index - b.index
    )
    .map(({ problem }) => problem);
  return parsed.success && problems.length === 0
    ? { page: parsed.data, problems }
    : { page: null, problems };
}

const kindOf = (item: string): PageItemKind => {
  const prefix = item.slice(0, item.indexOf(":"));
  const kinds: PageItemKind[] = [
    "setup",
    "task",
    "step",
    "data",
    "training",
    "cutover",
    "requirement",
    "objective",
    "question",
    "customization",
    "priority"
  ];
  return kinds.find((kind) => kind === prefix) ?? "task";
};

// Pure: the cards of a person's page, as the page shows them.
export function resolveMemberPage(
  page: MemberPage,
  items: Map<string, PageCatalogueEntry>,
  userId: string
): PageSection[] {
  return page.sections.map((section, index) => ({
    id: `section-${index}`,
    title: section.title,
    intro: section.intro,
    cards: section.cards.map((card): PageCard => {
      if (card.custom) {
        return {
          id: cardId(card),
          kind: "custom",
          title: card.custom.title,
          detail: card.custom.text,
          tick: doneCheck(customCardKey(userId, card.custom.key)),
          evidence: [],
          href: card.custom.link,
          note: card.note,
          due: card.due
        };
      }
      const item = card.item ?? "";
      const entry = items.get(item);
      if (!entry) {
        return {
          id: item,
          kind: kindOf(item),
          title: card.title ?? item,
          tick: null,
          evidence: [],
          note: card.note,
          due: card.due,
          missing: true
        };
      }
      const { item: _item, kind, ...rest } = entry;
      return {
        ...rest,
        id: item,
        kind,
        title: card.title ?? entry.title,
        note: card.note,
        due: card.due ?? entry.targetDate
      };
    })
  }));
}

// Pure: a page's questions come out of their sections into one list, in page
// order, so they are answered in one place. A section left with no cards is
// dropped. A question removed from the hub stays where the page put it.
export function splitPageQuestions(sections: PageSection[]): {
  questions: PageCard[];
  sections: PageSection[];
} {
  const isQuestion = (card: PageCard) =>
    card.kind === "question" && Boolean(card.rowId) && !card.missing;
  return {
    questions: sections.flatMap((section) => section.cards.filter(isQuestion)),
    sections: sections
      .map((section) => ({
        ...section,
        cards: section.cards.filter((card) => !isQuestion(card))
      }))
      .filter((section) => section.cards.length > 0)
  };
}

// Pure: is the card on or done? `done` is null when the card has no done state
// (training, a requirement's scope toggle).
export function cardState(
  card: PageCard,
  states: Map<string, string>,
  rows: Map<string, ImplementationRowData>
): { on: boolean; done: boolean | null } {
  if (card.kind === "customization" && card.rowId) {
    const row = rows.get(card.rowId);
    const status = row ? readCustomization(row.payload).status : "proposed";
    const done = status === "done" || status === "dropped";
    return { on: done, done };
  }
  if (!card.tick) return { on: false, done: null };
  if (card.tick.meaning === "scope") {
    return { on: inScope(card.tick, states), done: null };
  }
  const on = states.get(card.tick.itemKey) === card.tick.on;
  return { on, done: on };
}

// Pure: how many of the page's cards are done, over the cards that can be.
export function pageProgress(
  sections: PageSection[],
  states: Map<string, string>,
  rows: Map<string, ImplementationRowData>
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const section of sections) {
    for (const card of section.cards) {
      if (card.missing) continue;
      const state = cardState(card, states, rows);
      if (state.done === null) continue;
      total += 1;
      if (state.done) done += 1;
    }
  }
  return { done, total };
}

// Pure: the records an operational task still waits for.
export function unmetReadiness(
  ready: ReadinessRule | undefined,
  counts: Partial<Record<OnboardingCountKey, number | null>>
): OnboardingCountKey[] {
  return (ready ?? [])
    .filter(({ count, min }) => (counts[count] ?? 0) < min)
    .map(({ count }) => count);
}

// Where a person stands in the company, as the `employees` view reports it:
// signed in and active, invited and not yet accepted, or neither (deactivated,
// or their invite was revoked).
export type HubPersonStatus = "Active" | "Invited" | "Inactive";

// A person the staff bar's picker can show: an employee of the company, or
// someone with a hub page who no longer is one.
export type HubPagePerson = {
  id: string;
  name: string;
  email: string | null;
  status: HubPersonStatus;
};

export type HubPeopleGroups = {
  // Carbon staff in the company, with or without a page.
  carbon: (HubPagePerson & { hasPage: boolean })[];
  // Everyone else with a hub page.
  configured: HubPagePerson[];
  // Everyone else without one.
  unconfigured: HubPagePerson[];
};

// Pure: the staff bar's three groups, everyone in each. Staff are told apart by
// their email, as everywhere in the hub. Inactive people sort last.
export function groupHubPeople(
  people: HubPagePerson[],
  memberIds: Iterable<string>
): HubPeopleGroups {
  const withPage = new Set(memberIds);
  const order = (a: HubPagePerson, b: HubPagePerson) =>
    Number(a.status === "Inactive") - Number(b.status === "Inactive") ||
    a.name.localeCompare(b.name);
  const groups: HubPeopleGroups = {
    carbon: [],
    configured: [],
    unconfigured: []
  };
  for (const person of people) {
    const hasPage = withPage.has(person.id);
    if (isInternalEmail(person.email)) {
      groups.carbon.push({ ...person, hasPage });
    } else if (hasPage) {
      groups.configured.push(person);
    } else {
      groups.unconfigured.push(person);
    }
  }
  groups.carbon.sort(order);
  groups.configured.sort(order);
  groups.unconfigured.sort(order);
  return groups;
}

// Pure: the smallest page file for a person who has none, for staff to edit
// before loading: the priority set questionnaire under one section.
export function starterMemberPage(
  email: string,
  sectionTitle: string
): MemberPage {
  return {
    version: 1,
    user: email,
    sections: [{ title: sectionTitle, cards: [{ item: PRIORITY_CARD.item }] }]
  };
}
