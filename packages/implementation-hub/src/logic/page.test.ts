// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ImplementationRowData } from "../types";
import {
  buildPageCatalogue,
  cardState,
  catalogueByItem,
  checkMemberPage,
  customCardKey,
  groupHubPeople,
  type HubPagePerson,
  type HubPersonStatus,
  pageProgress,
  resolveMemberPage,
  starterMemberPage,
  unmetReadiness
} from "./page";

const rows: ImplementationRowData[] = [
  {
    id: "row_obj",
    collection: "objective",
    payload: {
      title: "First job on the floor",
      event: "jobCompleted",
      targetDate: "2026-11-06"
    },
    sortOrder: 0
  },
  {
    id: "row_q",
    collection: "question",
    payload: { question: "Who approves purchase orders?" },
    sortOrder: 0
  },
  {
    id: "row_cust",
    collection: "customization",
    payload: {
      title: "Label template",
      kind: "documentTemplate",
      status: "done"
    },
    sortOrder: 0
  }
];

const items = catalogueByItem(buildPageCatalogue(rows));
const rowsById = new Map(rows.map((row) => [row.id, row]));

const page = (cards: unknown[]) => ({
  version: 1,
  user: "Alex@Example.com",
  sections: [{ title: "Next up", cards }]
});

describe("buildPageCatalogue", () => {
  it("lists template items and the company's own rows", () => {
    for (const item of [
      "setup:locations",
      "task:first-quote",
      "step:configure-bom",
      "data:parts",
      "training:pur-1",
      "cutover:freeze",
      "requirement:SAL.QT.01",
      "objective:row_obj",
      "question:row_q",
      "customization:row_cust"
    ]) {
      expect(items.has(item), item).toBe(true);
    }
  });

  it("leaves out what a page places another way", () => {
    // A Configure group task rolls up its setup items; the Setup Map step
    // pointed at a page that no longer exists.
    expect(items.has("task:setup-resources")).toBe(false);
    expect(items.has("step:configure-data")).toBe(false);
  });

  it("lists each first document once", () => {
    const keys = buildPageCatalogue([]).map((entry) => entry.item);
    expect(keys.filter((key) => key === "task:first-quote")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("checkMemberPage", () => {
  it("accepts a valid page and lowercases the email", () => {
    const result = checkMemberPage(
      JSON.stringify(
        page([
          { item: "setup:locations", due: "2026-10-20" },
          { custom: { key: "approval-limits", title: "Agree approval limits" } }
        ])
      ),
      items
    );
    expect(result.problems).toEqual([]);
    expect(result.page?.user).toBe("alex@example.com");
  });

  it("names every unknown item and every duplicate", () => {
    const result = checkMemberPage(
      page([
        { item: "setup:locations" },
        { item: "setup:nowhere" },
        { item: "setup:locations" },
        { custom: { key: "a", title: "One" } },
        { custom: { key: "a", title: "Two" } }
      ]),
      items
    );
    expect(result.page).toBeNull();
    expect(result.problems).toEqual([
      'sections[0].cards[1].item: "setup:nowhere" is not a hub item. Read the catalogue for the valid keys.',
      "sections[0].cards[2]: setup:locations is already on this page at sections[0].cards[0].",
      "sections[0].cards[4]: custom:a is already on this page at sections[0].cards[3]."
    ]);
  });

  it("reports schema problems with their path", () => {
    const result = checkMemberPage(
      page([
        { item: "setup:locations", due: "20 Oct" },
        { item: "setup:parts", custom: { key: "x", title: "X" } },
        { custom: { key: "Bad Key", title: "X", link: "ftp://x" } }
      ]),
      items
    );
    expect(result.page).toBeNull();
    expect(result.problems).toEqual([
      "sections[0].cards[0].due: Use a date in the form YYYY-MM-DD",
      "sections[0].cards[1]: A card needs either an item or a custom card, not both",
      "sections[0].cards[2].custom.key: Use lowercase letters, digits and hyphens",
      "sections[0].cards[2].custom.link: Use a Carbon path starting with /x/, or an https link"
    ]);
  });

  it("lists schema and catalogue problems together, in file order", () => {
    const result = checkMemberPage(
      page([
        { item: "setup:nowhere" },
        { item: "setup:locations", due: "next week" },
        { item: "setup:locations" }
      ]),
      items
    );
    expect(result.page).toBeNull();
    expect(result.problems).toEqual([
      'sections[0].cards[0].item: "setup:nowhere" is not a hub item. Read the catalogue for the valid keys.',
      "sections[0].cards[1].due: Use a date in the form YYYY-MM-DD",
      "sections[0].cards[2]: setup:locations is already on this page at sections[0].cards[1]."
    ]);
  });

  it("refuses text that is not JSON", () => {
    const result = checkMemberPage("{ not json", items);
    expect(result.page).toBeNull();
    expect(result.problems[0]).toMatch(/^The file is not valid JSON/);
  });
});

describe("resolveMemberPage", () => {
  const checked = checkMemberPage(
    page([
      { item: "setup:locations", title: "Your two plants" },
      { item: "objective:row_obj" },
      { item: "requirement:SAL.QT.01" },
      { item: "training:pur-1" },
      { item: "customization:row_cust" },
      { custom: { key: "approval-limits", title: "Agree approval limits" } }
    ]),
    items
  );
  const sections = resolveMemberPage(checked.page!, items, "user_1");
  const [setup, objective, requirement, training, customization, custom] =
    sections[0]!.cards;

  it("keeps the hub item's state key and takes the page's title", () => {
    expect(setup!.title).toBe("Your two plants");
    expect(setup!.tick?.itemKey).toBe("flag:setup.locations");
  });

  it("uses a row's own target date when the page sets none", () => {
    expect(objective!.due).toBe("2026-11-06");
    expect(objective!.evidence[0]?.count).toBe("completedJobs");
  });

  it("stores a custom card's tick per person", () => {
    expect(custom!.tick?.itemKey).toBe(
      customCardKey("user_1", "approval-limits")
    );
    expect(custom!.tick?.itemKey).toBe("check:custom.user_1.approval-limits");
  });

  it("marks an item removed from the hub after loading", () => {
    const gone = resolveMemberPage(
      checked.page!,
      catalogueByItem(buildPageCatalogue([])),
      "user_1"
    );
    const card = gone[0]!.cards.find((c) => c.id === "objective:row_obj");
    expect(card?.missing).toBe(true);
    expect(card?.kind).toBe("objective");
  });

  it("counts done cards and leaves out scope toggles and training", () => {
    const states = new Map([
      ["flag:setup.locations", "1"],
      ["check:objective.row_obj", "0"],
      ["flag:SAL.QT.01", "0"]
    ]);
    expect(cardState(requirement!, new Map(), rowsById)).toEqual({
      on: true,
      done: null
    });
    expect(cardState(requirement!, states, rowsById).on).toBe(false);
    expect(cardState(training!, states, rowsById).done).toBeNull();
    expect(cardState(customization!, states, rowsById).done).toBe(true);
    // Setup, objective, customization and custom count; 2 of 4 are done.
    expect(pageProgress(sections, states, rowsById)).toEqual({
      done: 2,
      total: 4
    });
  });
});

describe("unmetReadiness", () => {
  it("lists the records still missing", () => {
    expect(
      unmetReadiness(
        [
          { count: "customers", min: 1 },
          { count: "items", min: 1 }
        ],
        { customers: 2, items: null }
      )
    ).toEqual(["items"]);
  });
});

describe("groupHubPeople", () => {
  const person = (
    id: string,
    name: string,
    email: string | null,
    status: HubPersonStatus = "Active"
  ): HubPagePerson => ({ id, name, email, status });

  it("puts Carbon staff in their own group, page or not", () => {
    const groups = groupHubPeople(
      [
        person("u1", "Sam", "sam@carbon.ms"),
        person("u2", "Ana", "ana@carbon.us.org")
      ],
      ["u1"]
    );
    expect(groups.carbon).toEqual([
      { ...person("u2", "Ana", "ana@carbon.us.org"), hasPage: false },
      { ...person("u1", "Sam", "sam@carbon.ms"), hasPage: true }
    ]);
    expect(groups.configured).toEqual([]);
    expect(groups.unconfigured).toEqual([]);
  });

  it("splits everyone else by whether they have a page, sorted by name", () => {
    const groups = groupHubPeople(
      [
        person("u3", "Zoe", "zoe@example.com"),
        person("u4", "Ben", "ben@example.com", "Invited"),
        person("u5", "Cleo", "cleo@example.com"),
        person("u6", "Dev", "dev@example.com")
      ],
      ["u5", "u3"]
    );
    expect(groups.configured.map((p) => p.name)).toEqual(["Cleo", "Zoe"]);
    expect(groups.unconfigured.map((p) => p.name)).toEqual(["Ben", "Dev"]);
  });

  it("lists inactive people too, after everyone else", () => {
    const groups = groupHubPeople(
      [
        person("u7", "Adam", "adam@example.com", "Inactive"),
        person("u8", "Bea", "bea@example.com", "Invited"),
        person("u9", "Cal", "cal@example.com", "Inactive"),
        person("u10", "Dot", "dot@example.com")
      ],
      ["u9"]
    );
    expect(groups.configured.map((p) => p.id)).toEqual(["u9"]);
    expect(groups.unconfigured.map((p) => p.name)).toEqual([
      "Bea",
      "Dot",
      "Adam"
    ]);
  });
});

describe("starterMemberPage", () => {
  it("is a page file the hub accepts, holding the questionnaire", () => {
    const starter = starterMemberPage("new.person@example.com", "Start here");
    const checked = checkMemberPage(
      JSON.stringify(starter),
      catalogueByItem(buildPageCatalogue([]))
    );
    expect(checked.problems).toEqual([]);
    expect(checked.page?.sections[0]?.cards).toEqual([
      { item: "priority:questionnaire" }
    ]);
  });
});
