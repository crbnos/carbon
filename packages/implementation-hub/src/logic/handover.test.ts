// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { HANDOVER_QUESTIONS, HANDOVER_SECTIONS } from "../content/handover";
import { SCOPE_GOAL_KEY } from "../content/scope";
import type { HubContacts, Tier } from "../types";
import {
  answerLines,
  appliedHandoverValue,
  HANDOVER_APPLIED_KEY,
  type HandoverInput,
  type HandoverWrite,
  handoverAnswers,
  handoverFieldKey,
  planHandover
} from "./handover";
import { gateDateKey, PLAN_START_KEY } from "./timeline";

const GO_LIVE_KEY = gateDateKey("gate:golive");

// A hub as the apply sees it, and the same hub after the writes are made, the
// way apply-handover.ts makes them.
interface Hub {
  fields: Map<string, string>;
  contacts: HubContacts;
  tier: Tier;
  rows: {
    collection: string;
    payload: Record<string, unknown>;
    sourceRef?: string | null;
  }[];
}

function newHub(answers: Record<string, string>, hub: Partial<Hub> = {}): Hub {
  const fields = new Map(hub.fields ?? []);
  for (const [key, value] of Object.entries(answers)) {
    fields.set(handoverFieldKey(key), value);
  }
  return {
    fields,
    contacts: hub.contacts ?? {},
    tier: hub.tier ?? "self_serve",
    rows: hub.rows ?? []
  };
}

const inputOf = (hub: Hub): HandoverInput => ({
  answers: handoverAnswers(hub.fields),
  fields: hub.fields,
  contacts: hub.contacts,
  tier: hub.tier,
  rows: hub.rows
});

function applied(hub: Hub, writes: HandoverWrite[]): Hub {
  const next: Hub = {
    fields: new Map(hub.fields),
    contacts: hub.contacts,
    tier: hub.tier,
    rows: [...hub.rows]
  };
  for (const write of writes) {
    if (write.kind === "setTier") next.tier = write.tier;
    if (write.kind === "setField") next.fields.set(write.fieldKey, write.value);
    if (write.kind === "setContacts") next.contacts = write.contacts;
    if (write.kind === "addRow") {
      next.rows.push({
        collection: write.collection,
        payload: write.payload,
        sourceRef: write.sourceRef
      });
    }
  }
  next.fields.set(
    HANDOVER_APPLIED_KEY,
    appliedHandoverValue(hub.fields, writes)
  );
  return next;
}

const ANSWERS = {
  "deal.tier": "guided",
  "deal.planStart": "2026-11-02",
  "deal.goLive": "2027-02-15",
  "deal.hosting": "EU cloud region",
  "promises.features": "Quote from live costs\n\n  Lot tracking on receipts  ",
  "promises.integrations": "- Accounting sync",
  "why.success": "Quotes out the same day",
  "people.owner": "Avery Lin",
  "people.leads": "Sam Ortiz (production), Robin Hale (quality)",
  "systems.migrate": "Open purchase orders\nItem master",
  "risks.openPoints": "Which site goes live first?",
  "scope.projectGoal": "One system from quote to shipment."
};

describe("planHandover", () => {
  it("copies each answer to its destination", () => {
    const writes = planHandover(inputOf(newHub(ANSWERS)));

    expect(writes.filter((w) => w.kind === "setTier")).toEqual([
      { kind: "setTier", tier: "guided", questionKey: "deal.tier", key: "tier" }
    ]);
    expect(
      writes.flatMap((w) =>
        w.kind === "setField" ? [[w.fieldKey, w.value]] : []
      )
    ).toEqual([
      [PLAN_START_KEY, "2026-11-02"],
      [GO_LIVE_KEY, "2027-02-15"],
      [SCOPE_GOAL_KEY, "One system from quote to shipment."]
    ]);
    expect(writes.filter((w) => w.kind === "setContacts").at(-1)).toMatchObject(
      {
        contacts: {
          owner: "Avery Lin",
          champion: "Sam Ortiz (production), Robin Hale (quality)"
        }
      }
    );
    expect(
      writes.flatMap((w) =>
        w.kind === "addRow" ? [[w.collection, w.payload, w.sourceRef]] : []
      )
    ).toEqual([
      [
        "requirement",
        { requirement: "Quote from live costs" },
        "handover:promises.features:0"
      ],
      [
        "requirement",
        { requirement: "Lot tracking on receipts" },
        "handover:promises.features:1"
      ],
      [
        "requirement",
        { requirement: "Accounting sync" },
        "handover:promises.integrations:0"
      ],
      [
        "objective",
        { title: "Quotes out the same day" },
        "handover:why.success:0"
      ],
      [
        "data",
        { object: "Open purchase orders", today: "" },
        "handover:systems.migrate:0"
      ],
      [
        "data",
        { object: "Item master", today: "" },
        "handover:systems.migrate:1"
      ],
      [
        "question",
        { question: "Which site goes live first?" },
        "handover:risks.openPoints:0"
      ]
    ]);
    // An answer with no destination stays on the Handover page only.
    expect(writes.some((w) => w.questionKey === "deal.hosting")).toBe(false);
  });

  it("is a no-op when applied again", () => {
    const once = applied(
      newHub(ANSWERS),
      planHandover(inputOf(newHub(ANSWERS)))
    );
    expect(planHandover(inputOf(once))).toEqual([]);
  });

  it("adds only the lines appended since the last apply", () => {
    const once = applied(
      newHub(ANSWERS),
      planHandover(inputOf(newHub(ANSWERS)))
    );
    once.fields.set(
      handoverFieldKey("systems.migrate"),
      "Open purchase orders\nItem master\nOpen sales orders"
    );
    expect(planHandover(inputOf(once))).toEqual([
      {
        kind: "addRow",
        collection: "data",
        payload: { object: "Open sales orders", today: "" },
        sourceRef: "handover:systems.migrate:2",
        questionKey: "systems.migrate",
        key: "handover:systems.migrate:2"
      }
    ]);
  });

  it("never overwrites a value someone already set", () => {
    const hub = newHub(ANSWERS, {
      fields: new Map([
        [GO_LIVE_KEY, "2027-03-01"],
        [SCOPE_GOAL_KEY, "Replace the spreadsheets."]
      ]),
      contacts: { owner: "Jordan Pike", pocUserId: "user_1" }
    });
    const writes = planHandover(inputOf(hub));
    const after = applied(hub, writes);

    expect(after.fields.get(GO_LIVE_KEY)).toBe("2027-03-01");
    expect(after.fields.get(SCOPE_GOAL_KEY)).toBe("Replace the spreadsheets.");
    expect(after.fields.get(PLAN_START_KEY)).toBe("2026-11-02");
    expect(after.contacts).toEqual({
      owner: "Jordan Pike",
      pocUserId: "user_1",
      champion: "Sam Ortiz (production), Robin Hale (quality)"
    });
  });

  it("keeps what someone changed or removed after an apply", () => {
    const once = applied(
      newHub(ANSWERS),
      planHandover(inputOf(newHub(ANSWERS)))
    );
    // Staff move the hub to enterprise, clear the go-live date and delete a
    // requirement the handover made.
    once.tier = "enterprise";
    once.fields.set(GO_LIVE_KEY, "");
    once.rows = once.rows.filter(
      (row) => row.sourceRef !== "handover:promises.features:1"
    );
    expect(planHandover(inputOf(once))).toEqual([]);
  });

  it("skips a row an earlier apply made, even without the applied record", () => {
    const hub = newHub(
      { "risks.openPoints": "Which site goes live first?" },
      {
        rows: [
          {
            collection: "question",
            payload: { question: "Which site goes live first?" },
            sourceRef: "handover:risks.openPoints:0"
          }
        ]
      }
    );
    expect(planHandover(inputOf(hub))).toEqual([]);
  });

  it("sets the tier only to a valid tier that differs", () => {
    const plan = (answer: string, tier: Tier) =>
      planHandover(inputOf(newHub({ "deal.tier": answer }, { tier })));
    expect(plan("guided", "guided")).toEqual([]);
    expect(plan("premium", "self_serve")).toEqual([]);
    expect(plan(" enterprise ", "guided")).toMatchObject([
      { kind: "setTier", tier: "enterprise" }
    ]);
  });

  it("skips empty answers and a date that is not a date", () => {
    const hub = newHub({
      "deal.goLive": "next spring",
      "promises.features": " \n \n",
      "people.owner": "   "
    });
    expect(planHandover(inputOf(hub))).toEqual([]);
  });
});

describe("answerLines", () => {
  it("splits by line, trims, and drops blank lines and bullets", () => {
    expect(answerLines("  First\r\n\n- Second\n* Third\n• Fourth  \n")).toEqual(
      ["First", "Second", "Third", "Fourth"]
    );
  });

  it("keeps a hyphen that is part of the text", () => {
    expect(answerLines("-40 °C storage\nMake-to-order")).toEqual([
      "-40 °C storage",
      "Make-to-order"
    ]);
  });
});

describe("handover content", () => {
  it("gives every question a unique key", () => {
    const keys = HANDOVER_QUESTIONS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys each question under its section", () => {
    for (const section of HANDOVER_SECTIONS) {
      for (const question of section.questions) {
        expect(question.key.startsWith(`${section.key}.`), question.key).toBe(
          true
        );
      }
    }
  });

  it("never stores an answer in the applied record's field", () => {
    expect(
      HANDOVER_QUESTIONS.map((q) => handoverFieldKey(q.key))
    ).not.toContain(HANDOVER_APPLIED_KEY);
  });
});
