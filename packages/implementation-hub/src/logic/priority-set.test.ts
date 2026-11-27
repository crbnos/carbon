// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  PRIORITY_ASSUMED,
  PRIORITY_BLANK_START_EFFECTS,
  PRIORITY_FEATURES,
  PRIORITY_SECTIONS
} from "../content/priority-set";
import {
  checkPriorityWrite,
  computePrioritySet,
  EMPTY_PRIORITY_STATE,
  encodeTools,
  isPriorityAnswerKey,
  PRIORITY_MAX_TOOLS,
  PRIORITY_NOT_SURE,
  PRIORITY_START_KEY,
  PRIORITY_TOOLS_KEY,
  PRIORITY_VIA_ASSISTANT,
  type PriorityState,
  type PriorityToolAnswer,
  priorityAnswerKey,
  priorityFeaturesIn,
  priorityFunctionEntries,
  priorityMaybe,
  priorityOptionPlacements,
  priorityOverrideKey,
  priorityProgress,
  priorityQuestion,
  priorityQuestionAnswered,
  priorityQuestionNumbers,
  priorityQuestions,
  prioritySections,
  prioritySetMarkdown,
  priorityStateFromFields,
  priorityToolDescribed,
  priorityToolSupport,
  priorityViaKey,
  stampPriorityOverride,
  withFunctionRenamed,
  withFunctionTool
} from "./priority-set";

// Most cases read easiest from the defaults; a company starts blank.
const state = (patch: Partial<PriorityState> = {}): PriorityState => ({
  ...EMPTY_PRIORITY_STATE,
  start: "defaults",
  ...patch
});
const blank = (patch: Partial<PriorityState> = {}) =>
  state({ start: "blank", ...patch });
// A tool with its follow-up: the areas it covers and its plan.
const tool = (
  name: string,
  rows: string[] = [],
  plan?: PriorityToolAnswer["plan"],
  extra: Partial<PriorityToolAnswer> = {}
): PriorityToolAnswer => ({
  id: name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
  name,
  ...(rows.length ? { rows } : {}),
  ...(plan ? { plan } : {}),
  ...extra
});
const counts = (s: PriorityState) => {
  const set = computePrioritySet(s);
  return ([0, 1, 2, 3] as const).map((c) => priorityFeaturesIn(set, c).length);
};

const DEFAULT_ZERO = [
  "items.parts",
  "items.materials",
  "items.methods",
  "resources.locations",
  "resources.processes",
  "resources.work-centers",
  "purchasing.suppliers",
  "purchasing.orders",
  "inventory.receipts",
  "inventory.shipments",
  "inventory.stock",
  "production.jobs",
  "mes.operations",
  "sales.customers",
  "sales.orders",
  "users.accounts"
];

describe("priority set content", () => {
  const featureKeys = new Set(PRIORITY_FEATURES.map((f) => f.key));

  it("has unique feature keys and every need names a feature", () => {
    expect(featureKeys.size).toBe(PRIORITY_FEATURES.length);
    for (const feature of PRIORITY_FEATURES)
      for (const group of feature.needs)
        for (const key of group) expect(featureKeys).toContain(key);
  });

  it("has unique question keys, unique option keys per question, and effects on real features", () => {
    const questions = priorityQuestions();
    expect(new Set(questions.map((q) => q.key)).size).toBe(questions.length);
    for (const question of questions) {
      const options = question.options.map((o) => o.key);
      expect(new Set(options).size).toBe(options.length);
      for (const option of question.options) {
        for (const effect of option.effects)
          expect(featureKeys).toContain(effect.feature);
        if (option.when) {
          expect(featureKeys).toContain(option.when.effect.feature);
          expect(
            priorityQuestion(option.when.question)?.options.map((o) => o.key)
          ).toContain(option.when.option);
        }
      }
      for (const row of question.systems ?? [])
        for (const key of row.features) expect(featureKeys).toContain(key);
    }
  });

  it("points every condition, assumption and blank-start effect at real keys", () => {
    for (const section of PRIORITY_SECTIONS) {
      if (!section.condition) continue;
      const options = priorityQuestion(section.condition.question)?.options.map(
        (o) => o.key
      );
      for (const option of section.condition.options)
        expect(options).toContain(option);
    }
    for (const assumed of PRIORITY_ASSUMED)
      expect(featureKeys).toContain(assumed.feature);
    for (const extra of PRIORITY_BLANK_START_EFFECTS) {
      expect(
        priorityQuestion(extra.question)?.options.map((o) => o.key)
      ).toContain(extra.option);
      for (const effect of extra.effects)
        expect(featureKeys).toContain(effect.feature);
    }
  });

  it("links only to docs.carbon.ms, and only from questions that say why", () => {
    for (const question of priorityQuestions()) {
      if (question.learnMore?.length) expect(question.why).toBeDefined();
      for (const link of question.learnMore ?? [])
        expect(link.url).toMatch(/^https:\/\/docs\.carbon\.ms\//);
    }
  });

  // The MCP guide (priority-set-guide.md) asks each question with a client's
  // multiple-choice tool, which shows at most four options, and names `buy`
  // as the one question whose options and Not sure do not fit.
  it("fits every question but buy in four options with Not sure", () => {
    const over = priorityQuestions()
      .filter((q) => !q.systems && q.options.length > 3)
      .map((q) => [q.key, q.options.length]);
    expect(over).toEqual([["buy", 4]]);
  });

  it("gives no two options of a question the same outcome", () => {
    for (const question of priorityQuestions()) {
      const outcomes = question.options
        .map((o) => JSON.stringify(o.effects))
        .filter((o) => o !== "[]");
      expect(new Set(outcomes).size).toBe(outcomes.length);
    }
  });
});

describe("computePrioritySet from defaults", () => {
  it("starts every feature at its default", () => {
    expect(counts(state())).toEqual([16, 16, 26, 9]);
    const set = computePrioritySet(state());
    expect(
      priorityFeaturesIn(set, 0)
        .map((f) => f.key)
        .sort()
    ).toEqual([...DEFAULT_ZERO].sort());
  });

  it("raises what an answer names and records the answer as the reason", () => {
    const set = computePrioritySet(
      state({ answers: { business: ["toOrder"] } })
    );
    expect(set.category["sales.quotes"]).toBe(0);
    expect(set.category["documents.files"]).toBe(0);
    expect(set.reasons["sales.quotes"]).toEqual([
      { type: "answer", question: "business", option: "toOrder" }
    ]);
  });

  it("raises what a raised feature needs to 0", () => {
    const set = computePrioritySet(
      state({ answers: { business: ["configure"] } })
    );
    expect(set.category["items.configurator"]).toBe(0);
    expect(set.category["sales.quotes"]).toBe(0);
    expect(set.unmetNeeds).toEqual([]);
  });

  it("never moves a feature that already sits higher", () => {
    // "Replace later" raises production to 1, but jobs default to 0.
    const set = computePrioritySet(
      state({ tools: [tool("ERP", ["production"], "later")] })
    );
    expect(set.category["production.jobs"]).toBe(0);
    expect(set.reasons["production.jobs"]).toEqual([]);
    expect(set.category["mes.operations"]).toBe(0);
  });

  it("applies a lower effect only when nothing raised the feature", () => {
    expect(
      computePrioritySet(state({ answers: { invoicing: ["elsewhere"] } }))
        .category["invoicing.sales"]
    ).toBe(3);
    const retired = computePrioritySet(
      state({
        answers: { invoicing: ["elsewhere"] },
        tools: [tool("Accounting app", ["invoicing"], "retire")]
      })
    );
    expect(retired.category["invoicing.sales"]).toBe(0);
    expect(retired.reasons["invoicing.sales"]).toEqual([
      {
        type: "system",
        row: "invoicing",
        choice: "retire",
        tool: "Accounting app"
      }
    ]);
  });

  it("applies a conditional effect only with the other answer", () => {
    expect(
      computePrioritySet(state({ answers: { designChanges: ["often"] } }))
        .category["items.change-control"]
    ).toBe(1);
    expect(
      computePrioritySet(
        state({
          answers: { designChanges: ["often"], qualityStandard: ["yes"] }
        })
      ).category["items.change-control"]
    ).toBe(0);
  });

  it("ignores answers in a section that is not asked", () => {
    // Quality detail is asked only without a standard; finance only when Carbon keeps the books.
    const withStandard = computePrioritySet(
      state({
        answers: { qualityStandard: ["yes"], inspections: ["yes"] }
      })
    );
    expect(withStandard.category["quality.issues"]).toBe(0);
    const noStandard = computePrioritySet(
      state({ answers: { qualityStandard: ["no"], inspections: ["yes"] } })
    );
    expect(noStandard.category["quality.inspections"]).toBe(0);
    expect(noStandard.category["quality.issues"]).toBe(1);
    expect(
      computePrioritySet(state({ answers: { fixedAssets: ["yes"] } })).category[
        "accounting.fixed-assets"
      ]
    ).toBe(3);
    expect(
      computePrioritySet(
        state({ answers: { books: ["yes"], fixedAssets: ["yes"] } })
      ).category["accounting.fixed-assets"]
    ).toBe(1);
  });

  it("skips the shop floor section when the office records work", () => {
    const set = computePrioritySet(
      state({ answers: { shopFloor: ["office"], capacity: ["yes"] } })
    );
    expect(set.category["mes.operations"]).toBe(1);
    expect(set.category["production.scheduling"]).toBe(1);
  });

  it("lets an override win over every answer", () => {
    const set = computePrioritySet(
      state({
        answers: { orderStart: ["quote"] },
        overrides: {
          "sales.quotes": { category: 2, reason: "Quotes stay in the CRM." }
        }
      })
    );
    expect(set.category["sales.quotes"]).toBe(2);
    expect(set.reasons["sales.quotes"]).toEqual([
      { type: "override", reason: "Quotes stay in the CRM." }
    ]);
  });

  it("reports a need set by hand to a later category instead of moving it", () => {
    const set = computePrioritySet(
      state({
        answers: { business: ["configure"] },
        overrides: { "items.methods": { category: 2 } }
      })
    );
    expect(set.category["items.methods"]).toBe(2);
    expect(set.overriddenNeeds).toContainEqual({
      feature: "items.configurator",
      need: "items.methods"
    });
  });

  it("records not sure as an open question and changes nothing", () => {
    const set = computePrioritySet(
      state({
        answers: { buildTo: [PRIORITY_NOT_SURE] },
        tools: [tool("QMS", ["quality"], PRIORITY_NOT_SURE)]
      })
    );
    expect(set.category["production.mrp"]).toBe(1);
    expect(set.notSure).toEqual(["tools.qms", "buildTo"]);
  });

  it("flags keeping a current tool for an area Carbon needs live", () => {
    const set = computePrioritySet(
      state({ tools: [tool("Spreadsheet", ["inventory"], "keep")] })
    );
    expect(set.adoptionRisks).toEqual([
      { row: "inventory", tool: "Spreadsheet" }
    ]);
  });
});

describe("computePrioritySet from blank", () => {
  it("places only the assumed features and what they need", () => {
    const set = computePrioritySet(blank());
    expect(
      priorityFeaturesIn(set, 0)
        .map((f) => f.key)
        .sort()
    ).toEqual(
      [
        "items.parts",
        "resources.locations",
        "sales.customers",
        "sales.orders",
        "users.accounts"
      ].sort()
    );
    expect(set.category["purchasing.orders"]).toBeNull();
  });

  it("builds the list up from the foundation questions", () => {
    const set = computePrioritySet(
      blank({ answers: { buy: ["rawMaterial"], make: ["yes"] } })
    );
    for (const key of [
      "items.materials",
      "purchasing.suppliers",
      "purchasing.orders",
      "inventory.receipts",
      "production.jobs",
      "resources.processes",
      "resources.work-centers"
    ])
      expect(set.category[key]).toBe(0);
  });

  it("applies blank-start effects, and needs at every category", () => {
    expect(
      computePrioritySet(blank({ answers: { shopFloor: ["operators"] } }))
        .category["mes.operations"]
    ).toBe(0);
    const office = computePrioritySet(
      blank({ answers: { shopFloor: ["office"] } })
    );
    expect(office.category["mes.operations"]).toBe(1);
    expect(office.category["production.jobs"]).toBe(1);
    expect(office.reasons["production.jobs"]).toEqual([
      { type: "needed", by: "mes.operations" }
    ]);
    expect(
      computePrioritySet(blank({ answers: { invoicing: ["later"] } })).category[
        "invoicing.sales"
      ]
    ).toBe(1);
  });

  it("pulls nothing forward for a feature that is not needed now", () => {
    const set = computePrioritySet(
      blank({ overrides: { "integrations.cad": { category: 3 } } })
    );
    expect(set.category["integrations.cad"]).toBe(3);
    expect(set.category["items.methods"]).toBeNull();
  });

  it("rebuilds the default category 0 for a company that buys, makes and sells", () => {
    const set = computePrioritySet(
      blank({
        answers: {
          buy: ["rawMaterial", "components"],
          make: ["yes"],
          sell: ["products"],
          shopFloor: ["operators"]
        }
      })
    );
    const zero = priorityFeaturesIn(set, 0).map((f) => f.key);
    for (const key of DEFAULT_ZERO) expect(zero).toContain(key);
    expect(zero.filter((key) => !DEFAULT_ZERO.includes(key))).toEqual([
      "people.operators"
    ]);
  });

  it("asks the AI assistant, today's tools and accounting first, then the foundation only on a blank start", () => {
    expect(prioritySections("defaults").map((s) => s.key)).not.toContain(
      "foundation"
    );
    expect(
      prioritySections("defaults")
        .slice(0, 3)
        .map((s) => s.key)
    ).toEqual(["ai", "tools", "accounting"]);
    expect(
      prioritySections("blank")
        .slice(0, 4)
        .map((s) => s.key)
    ).toEqual(["ai", "tools", "accounting", "foundation"]);
    const numbers = priorityQuestionNumbers("blank");
    expect(numbers.get("aiAssistant")).toBe("Q1");
    expect(numbers.get("systems")).toBe("Q2");
    expect(numbers.get("books")).toBe("Q3");
    expect(numbers.get("invoicing")).toBe("Q4");
    expect(numbers.get("buy")).toBe("F1");
    expect(numbers.get("business")).toBe("Q5");
  });
});

describe("priorityProgress", () => {
  it("counts only the sections a company is asked", () => {
    const start = priorityProgress(state());
    const office = priorityProgress(
      state({ answers: { shopFloor: ["office"] } })
    );
    expect(office.answered).toBe(1);
    expect(office.total).toBeLessThan(start.total);
  });
});

describe("priorityStateFromFields", () => {
  it("reads what the hub stores and drops what the content no longer has", () => {
    const fields = new Map<string, string>([
      [PRIORITY_START_KEY, "blank"],
      [priorityAnswerKey("business"), JSON.stringify(["oem", "retired"])],
      [priorityAnswerKey("buildTo"), "not json"],
      [
        PRIORITY_TOOLS_KEY,
        JSON.stringify([
          {
            id: "t1",
            name: " Spreadsheet ",
            rows: ["inventory", "gone"],
            plan: "retire"
          },
          { id: "t2", name: " " },
          { id: "t1", name: "Twice" },
          { id: "bad id!", name: "x" }
        ])
      ],
      [
        priorityOverrideKey("sales.quotes"),
        JSON.stringify({ category: 0, reason: "Staff call", by: "a@b.c" })
      ],
      [priorityOverrideKey("sales.rentals"), JSON.stringify({ category: 7 })]
    ]);
    expect(priorityStateFromFields(fields)).toEqual({
      start: "blank",
      answers: { business: ["oem"] },
      tools: [
        { id: "t1", name: "Spreadsheet", rows: ["inventory"], plan: "retire" }
      ],
      overrides: {
        "sales.quotes": { category: 0, reason: "Staff call", by: "a@b.c" }
      },
      viaAssistant: []
    });
  });
});

describe("answers an AI assistant entered", () => {
  it("are read from the companion field, only while the answer exists", () => {
    const fields = new Map([
      [priorityAnswerKey("business"), JSON.stringify(["oem"])],
      [priorityViaKey(priorityAnswerKey("business")), PRIORITY_VIA_ASSISTANT],
      [priorityViaKey(priorityAnswerKey("buildTo")), PRIORITY_VIA_ASSISTANT],
      [PRIORITY_TOOLS_KEY, JSON.stringify([{ id: "t1", name: "JobBOSS" }])],
      [priorityViaKey(PRIORITY_TOOLS_KEY), PRIORITY_VIA_ASSISTANT]
    ]);
    expect(priorityStateFromFields(fields).viaAssistant).toEqual([
      "systems",
      "business"
    ]);
    fields.delete(PRIORITY_TOOLS_KEY);
    expect(priorityStateFromFields(fields).viaAssistant).toEqual(["business"]);
  });

  it("names the companion field after the answer, for answers only", () => {
    expect(priorityViaKey(priorityAnswerKey("business"))).toBe(
      "priority.via.answer.business"
    );
    expect(isPriorityAnswerKey(priorityAnswerKey("business"))).toBe(true);
    expect(isPriorityAnswerKey(PRIORITY_TOOLS_KEY)).toBe(true);
    expect(priorityViaKey(PRIORITY_TOOLS_KEY)).toBe("priority.via.tools");
    expect(isPriorityAnswerKey(priorityOverrideKey("sales.quotes"))).toBe(
      false
    );
    expect(isPriorityAnswerKey(PRIORITY_START_KEY)).toBe(false);
  });

  it("cannot be written by a client", () => {
    expect(
      checkPriorityWrite(
        priorityViaKey(priorityAnswerKey("business")),
        PRIORITY_VIA_ASSISTANT
      )
    ).toEqual({ error: "Not a priority set answer" });
  });

  it("are marked in the exported answers", () => {
    const s = blank({
      answers: { business: ["oem"], buildTo: ["toOrder"] },
      tools: [tool("Spreadsheet")],
      viaAssistant: ["business", "systems"]
    });
    const md = prioritySetMarkdown(s, computePrioritySet(s), {
      company: "Example Co",
      date: "2026-10-14",
      answeredBy: "questionnaire",
      label: (m) => m.message ?? "",
      personName: () => undefined
    });
    const answerLine = (number: string) =>
      md.split("\n").find((line) => line.startsWith(`- ${number}:`)) ?? "";
    const numbers = priorityQuestionNumbers("blank");
    expect(answerLine(numbers.get("business") ?? "")).toContain(
      "Entered by an AI assistant."
    );
    expect(answerLine(numbers.get("buildTo") ?? "")).not.toContain(
      "AI assistant"
    );
    expect(answerLine(numbers.get("systems") ?? "")).toContain(
      "Entered by an AI assistant."
    );
  });
});

describe("priorityOptionPlacements", () => {
  it("adds the blank start's extra effects and keeps the conditional one apart", () => {
    for (const question of priorityQuestions()) {
      for (const option of question.options) {
        const fromDefaults = priorityOptionPlacements(
          "defaults",
          question.key,
          option
        );
        expect(fromDefaults.effects).toEqual(option.effects);
        expect(fromDefaults.when).toEqual(option.when);
        const extras = PRIORITY_BLANK_START_EFFECTS.filter(
          (extra) =>
            extra.question === question.key && extra.option === option.key
        ).flatMap((extra) => extra.effects);
        expect(
          priorityOptionPlacements("blank", question.key, option).effects
        ).toEqual([...option.effects, ...extras]);
      }
    }
  });
});

describe("checkPriorityWrite", () => {
  it("accepts and re-encodes a valid answer, and clears with an empty value", () => {
    expect(
      checkPriorityWrite(
        priorityAnswerKey("business"),
        '["oem","oem","toOrder"]'
      )
    ).toEqual({ value: '["oem","toOrder"]' });
    expect(checkPriorityWrite(priorityAnswerKey("business"), "")).toEqual({
      value: ""
    });
  });

  it("refuses unknown questions, options, and two options on a single-choice question", () => {
    expect(checkPriorityWrite(priorityAnswerKey("nope"), '["yes"]')).toEqual({
      error: "Unknown question"
    });
    expect(
      checkPriorityWrite(priorityAnswerKey("orderStart"), '["quote","rfq"]')
    ).toEqual({ error: "This question takes one option" });
    expect(
      checkPriorityWrite(priorityAnswerKey("orderStart"), '["telepathy"]')
    ).toEqual({ error: "Unknown option" });
    expect(
      checkPriorityWrite(
        priorityAnswerKey("business"),
        JSON.stringify(["oem", PRIORITY_NOT_SURE])
      )
    ).toEqual({ error: "Not sure cannot be combined with an option" });
  });

  it("checks the tool list and overrides", () => {
    const write = (tools: unknown) =>
      checkPriorityWrite(PRIORITY_TOOLS_KEY, JSON.stringify(tools));
    expect(
      write([
        {
          plan: "keep",
          rows: ["inventory"],
          name: "  Spreadsheet ",
          id: "t1",
          setup: " Macros for reorder points "
        }
      ])
    ).toEqual({
      value:
        '[{"id":"t1","name":"Spreadsheet","rows":["inventory"],"setup":"Macros for reorder points","plan":"keep"}]'
    });
    expect(checkPriorityWrite(PRIORITY_TOOLS_KEY, "")).toEqual({ value: "" });
    expect(write({ id: "t1" })).toEqual({ error: "The tools are a list" });
    expect(write([{ id: "t1", name: "Excel", plan: "burn" }])).toEqual({
      error: "Not a tool"
    });
    expect(write([{ id: "t1", name: " " }])).toEqual({
      error: "A tool needs a name"
    });
    expect(write([{ id: "t1", name: "Excel", rows: ["galaxy"] }])).toEqual({
      error: "Unknown area"
    });
    expect(
      write([
        { id: "t1", name: "Excel" },
        { id: "t1", name: "Sheets" }
      ])
    ).toEqual({ error: "Two tools share an id" });
    expect(
      write(
        Array.from({ length: PRIORITY_MAX_TOOLS + 1 }, (_, i) => ({
          id: `t${i}`,
          name: `Tool ${i}`
        }))
      )
    ).toEqual({ error: `At most ${PRIORITY_MAX_TOOLS} tools` });
    expect(
      checkPriorityWrite(
        priorityOverrideKey("sales.quotes"),
        '{"category":0,"reason":" Staff call ","by":"spoofed"}'
      )
    ).toEqual({ value: '{"category":0,"reason":"Staff call"}' });
    expect(
      checkPriorityWrite(priorityOverrideKey("sales.quotes"), '{"category":5}')
    ).toEqual({ error: "A category is 0, 1, 2 or 3" });
  });

  it("refuses keys outside the priority set", () => {
    expect(checkPriorityWrite("plan.start", "2026-10-12")).toEqual({
      error: "Not a priority set answer"
    });
  });

  it("stamps an override with who set it and when", () => {
    expect(
      stampPriorityOverride('{"category":1}', "user_1", "2026-10-12")
    ).toBe('{"category":1,"by":"user_1","at":"2026-10-12"}');
  });
});

describe("the tool list", () => {
  const listed = [tool("JobBOSS"), tool("Excel")];

  it("answers the question and moves no feature until a follow-up names areas and a plan", () => {
    const s = state({ tools: listed });
    const systems = priorityQuestion("systems")!;
    expect(priorityQuestionAnswered(systems, s)).toBe(true);
    expect(priorityQuestionAnswered(systems, state())).toBe(false);
    expect(counts(s)).toEqual(counts(state()));
    expect(computePrioritySet(s).notSure).toEqual([]);
    expect(priorityProgress(s).answered).toBe(1);
  });

  it("writes the same text the server keeps", () => {
    const value = encodeTools([
      tool("JobBOSS", ["quoting", "orderEntry"], "retire", {
        other: "Shop travellers",
        setup: "Custom job card fields"
      }),
      tool("Xero", ["accounting"], "connect", {
        integration: "Invoices out, payments back"
      })
    ]);
    expect(checkPriorityWrite(PRIORITY_TOOLS_KEY, value)).toEqual({ value });
    expect(encodeTools([])).toBe("");
  });

  it("calls a follow-up answered when it names what the tool is for and its plan", () => {
    expect(priorityToolDescribed(tool("Excel"))).toBe(false);
    expect(priorityToolDescribed(tool("Excel", ["inventory"]))).toBe(false);
    expect(priorityToolDescribed(tool("Excel", ["inventory"], "keep"))).toBe(
      true
    );
    expect(
      priorityToolDescribed(tool("Excel", [], "keep", { other: "Labels" }))
    ).toBe(true);
  });

  it("is exported with each tool's follow-up", () => {
    const s = state({
      tools: [
        tool("JobBOSS", ["quoting", "orderEntry"], "retire", {
          other: "Shop travellers",
          setup: "Custom job card fields"
        }),
        tool("Excel")
      ]
    });
    const markdown = prioritySetMarkdown(s, computePrioritySet(s), {
      company: "Test Co",
      date: "2026-10-15",
      answeredBy: "questionnaire",
      label: (m) => m.message ?? m.id,
      personName: () => undefined
    });
    expect(markdown).toContain(
      "- Q2: JobBOSS (Quoting, Order entry); Excel. questionnaire"
    );
    expect(markdown).toContain(
      "- JobBOSS. Used for: Quoting; Order entry; Shop travellers. Set up: Custom job card fields. Plan: Replace with Carbon."
    );
    expect(markdown).toContain("- Excel. Follow-up not answered.");
  });
});

describe("the functions on the page", () => {
  let ids = 0;
  const newId = () => `new${++ids}`;
  const jobBoss = tool(
    "JobBOSS",
    ["quoting", "orderEntry", "invoicing"],
    undefined,
    {
      functions: ["Shop travellers"]
    }
  );
  const excel = tool("Excel");

  it("lists the starter functions with their tools, then every other function and tool", () => {
    const entries = priorityFunctionEntries(state({ tools: [jobBoss, excel] }));
    const starters = entries.filter((entry) => entry.starter);
    expect(starters.map((entry) => entry.func)).toEqual(
      priorityQuestion("systems")!
        .systems!.filter((row) => row.starter)
        .map((row) => ({ row: row.key }))
    );
    expect(starters.length).toBeGreaterThanOrEqual(5);
    expect(starters.length).toBeLessThanOrEqual(8);
    expect(
      starters
        .filter((entry) => entry.tool)
        .map((entry) => [entry.func, entry.tool])
    ).toEqual([
      [{ row: "quoting" }, "JobBOSS"],
      [{ row: "orderEntry" }, "JobBOSS"]
    ]);
    expect(
      entries
        .filter((entry) => !entry.starter)
        .map((entry) => [entry.func, entry.tool])
    ).toEqual([
      [{ row: "invoicing" }, "JobBOSS"],
      [{ text: "Shop travellers" }, "JobBOSS"],
      [{ text: "" }, "Excel"]
    ]);
  });

  it("moves a function to the tool named for it, merging by name and dropping a tool left with nothing", () => {
    const quoting = { row: "quoting" };
    expect(
      withFunctionTool([excel], quoting, undefined, " excel ", newId)
    ).toEqual([{ ...excel, rows: ["quoting"] }]);
    const moved = withFunctionTool(
      [jobBoss],
      quoting,
      jobBoss.id,
      "Paperless Parts",
      newId
    );
    expect(moved.map((t) => [t.name, t.rows ?? []])).toEqual([
      ["JobBOSS", ["orderEntry", "invoicing"]],
      ["Paperless Parts", ["quoting"]]
    ]);
    const only = tool("Bartender", [], undefined, { functions: ["Labels"] });
    expect(
      withFunctionTool([only], { text: "Labels" }, only.id, "", newId)
    ).toEqual([]);
    const planned = { ...only, plan: "keep" as const };
    expect(
      withFunctionTool([planned], { text: "Labels" }, only.id, "", newId)
    ).toEqual([
      { id: only.id, name: "Bartender", functions: [], plan: "keep" }
    ]);
  });

  it("renames or removes a tool named without a function", () => {
    expect(
      withFunctionTool([excel], { text: "" }, excel.id, "Google Sheets", newId)
    ).toEqual([{ ...excel, name: "Google Sheets" }]);
    expect(
      withFunctionTool([excel], { text: "" }, excel.id, "", newId)
    ).toEqual([]);
  });

  it("renames a function, and an area named for it leaves any other tool", () => {
    const renamed = withFunctionRenamed(
      [jobBoss, excel],
      excel.id,
      { text: "" },
      { row: "invoicing" }
    );
    expect(renamed.map((t) => [t.name, t.rows ?? []])).toEqual([
      ["JobBOSS", ["quoting", "orderEntry"]],
      ["Excel", ["invoicing"]]
    ]);
    expect(
      withFunctionRenamed(
        [jobBoss],
        jobBoss.id,
        { text: "Shop travellers" },
        {
          text: "Travellers"
        }
      )[0]?.functions
    ).toEqual(["Travellers"]);
  });

  it("keeps a tool's own functions trimmed, once each, as the server stores them", () => {
    expect(
      checkPriorityWrite(
        PRIORITY_TOOLS_KEY,
        JSON.stringify([
          { id: "t1", name: "Bartender", functions: [" Labels ", "labels", ""] }
        ])
      )
    ).toEqual({
      value: '[{"id":"t1","name":"Bartender","functions":["Labels"]}]'
    });
    expect(
      checkPriorityWrite(
        PRIORITY_TOOLS_KEY,
        JSON.stringify([{ id: "t1", name: "Bartender", functions: "Labels" }])
      )
    ).toEqual({ error: "Not a tool" });
  });
});

describe("the start", () => {
  it("is blank unless set to the defaults", () => {
    expect(EMPTY_PRIORITY_STATE.start).toBe("blank");
    expect(priorityStateFromFields(new Map()).start).toBe("blank");
    expect(
      priorityStateFromFields(new Map([[PRIORITY_START_KEY, "blank"]])).start
    ).toBe("blank");
    expect(
      priorityStateFromFields(new Map([[PRIORITY_START_KEY, "defaults"]])).start
    ).toBe("defaults");
  });

  it("stores blank as no value and refuses anything but blank or defaults", () => {
    expect(checkPriorityWrite(PRIORITY_START_KEY, "blank")).toEqual({
      value: ""
    });
    expect(checkPriorityWrite(PRIORITY_START_KEY, "")).toEqual({ value: "" });
    expect(checkPriorityWrite(PRIORITY_START_KEY, "defaults")).toEqual({
      value: "defaults"
    });
    expect(checkPriorityWrite(PRIORITY_START_KEY, "later")).toEqual({
      error: "The start is blank or defaults"
    });
  });
});

describe("priorityMaybe", () => {
  it("lists what an unsure answer could place and nothing has placed", () => {
    const s = blank({
      answers: {
        qualityStandard: [PRIORITY_NOT_SURE],
        traceability: ["yes"]
      },
      tools: [tool("QMS", ["quality"], PRIORITY_NOT_SURE)]
    });
    const set = computePrioritySet(s);
    const maybe = priorityMaybe(s, set);
    const quality = maybe.find((g) => g.key === "qualityStandard");
    expect(quality?.features).toContain("quality.inspections");
    // Placed by the traceability answer, so not open any more.
    expect(set.category["inventory.traceability"]).not.toBeNull();
    expect(quality?.features).not.toContain("inventory.traceability");
    expect(maybe.find((g) => g.key === "tools.qms")?.features).toContain(
      "quality.documents"
    );
    // Every listed feature is unplaced.
    for (const group of maybe)
      for (const feature of group.features)
        expect(set.category[feature] ?? null).toBeNull();
  });

  it("is empty when nothing is unsure", () => {
    const s = blank({ answers: { qualityStandard: ["yes"] } });
    expect(priorityMaybe(s, computePrioritySet(s))).toEqual([]);
  });
});

describe("today's tools", () => {
  it("connects a kept tool through its integration and leaves the area's features alone", () => {
    const set = computePrioritySet(
      state({ tools: [tool("Xero", ["accounting"], "connect")] })
    );
    expect(set.category["integrations.accounting"]).toBe(1);
    expect(set.reasons["integrations.accounting"]).toEqual([
      { type: "system", row: "accounting", choice: "connect", tool: "Xero" }
    ]);
    expect(set.category["accounting.ledger"]).toBe(2);
  });

  it("flags a kept tool only when the set places one of its area's features before go-live", () => {
    const kept = [tool("Spreadsheet", ["inventory"], "keep")];
    expect(computePrioritySet(blank({ tools: kept })).adoptionRisks).toEqual(
      []
    );
    expect(
      computePrioritySet(
        blank({ tools: kept, answers: { sell: ["products"] } })
      ).adoptionRisks
    ).toEqual([{ row: "inventory", tool: "Spreadsheet" }]);
    expect(
      computePrioritySet(
        blank({
          tools: [tool("Spreadsheet", ["inventory"], "connect")],
          answers: { sell: ["products"] }
        })
      ).adoptionRisks
    ).toEqual([{ row: "inventory", tool: "Spreadsheet" }]);
  });

  it("only keeps a tool Carbon does not replace", () => {
    expect(
      checkPriorityWrite(
        PRIORITY_TOOLS_KEY,
        JSON.stringify([
          { id: "t1", name: "SolidWorks", rows: ["cad"], plan: "retire" }
        ])
      )
    ).toEqual({
      error:
        "Carbon does not replace a tool for CAD or nesting: keep it, connected or separate"
    });
    expect(
      priorityStateFromFields(
        new Map([
          [
            PRIORITY_TOOLS_KEY,
            JSON.stringify([
              { id: "t1", name: "SolidWorks", rows: ["cad"], plan: "retire" }
            ])
          ]
        ])
      ).tools
    ).toEqual([{ id: "t1", name: "SolidWorks", rows: ["cad"] }]);
    expect(
      computePrioritySet(
        state({ tools: [tool("Onshape", ["cad"], "connect")] })
      ).category["integrations.cad"]
    ).toBe(1);
  });

  it("matches a named tool to Carbon's support, ignoring case, spaces and punctuation", () => {
    expect(priorityToolSupport("xero")?.name).toBe("Xero");
    expect(priorityToolSupport("Quick Books")?.support).toBe("unavailable");
    expect(priorityToolSupport("onshape-government")?.name).toBe("Onshape");
    expect(priorityToolSupport("QuickBooks Desktop")).toBeUndefined();
    expect(priorityToolSupport("")).toBeUndefined();
    expect(priorityToolSupport(undefined)).toBeUndefined();
  });

  it("lists what a tool Carbon connects to could place when the plan is not sure", () => {
    const s = blank({
      tools: [tool("SolidWorks", ["cad"], PRIORITY_NOT_SURE)]
    });
    expect(priorityMaybe(s, computePrioritySet(s))).toEqual([
      { key: "tools.solidworks", features: ["integrations.cad"] }
    ]);
  });

  it("exports a connected tool as the reason for its integration", () => {
    const s = state({ tools: [tool("Xero", ["accounting"], "connect")] });
    const markdown = prioritySetMarkdown(s, computePrioritySet(s), {
      company: "Test Co",
      date: "2026-10-15",
      answeredBy: "questionnaire",
      label: (m) => m.message ?? m.id,
      personName: () => undefined
    });
    expect(markdown).toContain(
      "`integrations.accounting` External accounting system integration. From 3: Q2, Accounting: keep and connect Xero."
    );
    expect(markdown).toContain(
      "- Xero. Used for: Accounting. Plan: Keep and connect."
    );
  });
});
