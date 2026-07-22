// Customer-facing copy, lifted out of the view components so it lives in the
// editable content layer (a non-engineer can tweak wording here without touching
// JSX). PAGE_COPY drives each page's H1 + intro; UI_TEXT holds the small shared
// strings the surfaces share. Per-page section titles still live in their views
// for now — move them here as the need to re-word them arises.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface PageCopy {
  title: MessageDescriptor;
  // Optional: some pages compose a dynamic lead in the view (e.g. Plan's
  // step count) and only take the title from here.
  lead?: MessageDescriptor;
}

export const PAGE_COPY = {
  scope: {
    title: msg`Scope Summary`,
    lead: msg`Read this through. When it's right, sign off at the bottom. It's the statement your commercial agreement points to, with no prices or legal terms here.`
  },
  roles: {
    title: msg`Roles & Responsibilities`,
    lead: msg`Who does what, across the six steps. Your side is highlighted up top. Own it well and the project moves.`
  },
  setup: {
    title: msg`Setup Map`,
    lead: msg`The master data to set up when first configuring Carbon, grouped by module. Mark each one configured as you go — anything hidden says why.`
  },
  "how-you-run": {
    title: msg`Tell Us How You Run`,
    lead: msg`Your answers, and the plan they built. Change an answer any time — we'll show you exactly what changes before anything moves.`
  },
  "load-data": {
    title: msg`Load Your Data`,
    lead: msg`Bring your lists in without retyping them. Don't clean your files first — that's our job. Open transactions load at switch week, so they're current.`
  },
  pilot: {
    title: msg`Prove It Works`,
    lead: msg`Run one real order through Carbon, start to finish. Every document it creates checks itself off below as it appears.`
  },
  crew: {
    title: msg`Ready Your Team`,
    lead: msg`One champion per area, doing real tasks on your real data — and the first floor station running jobs before you switch.`
  },
  switch: {
    title: msg`Make the Switch`,
    lead: msg`Leave the old system without falling: open orders in, stock counted, the freeze plan signed, and four plain questions before the call.`
  },
  live: {
    title: msg`Live on Carbon`,
    lead: msg`Ten straight business days of real usage and you're activated. The definition is written here in plain words — no hidden judgment.`
  },
  requirements: {
    title: msg`Requirements & Process Map`,
    lead: msg`Walk each area with your champion and toggle anything out of scope. Codes read Module.Area.Number (ACC.GL.01 = Accounting, General Ledger, item 1).`
  },
  value: {
    title: msg`Value Snapshot`,
    lead: msg`What changes when you move to Carbon, and roughly what it's worth. Estimates, not a forecast.`
  },
  plan: {
    title: msg`Project Plan`
    // lead composed in the view (includes the dynamic step count).
  },
  training: {
    title: msg`Training Plan`,
    lead: msg`Who gets trained on what, in what format. Your part: protect the hands-on session time on your champions' calendars early. It's what slips most when companies get busy.`
  },
  team: {
    title: msg`Your Project Team`,
    lead: msg`The people on the Carbon side who will run your implementation, and how to reach them.`
  }
} satisfies Record<string, PageCopy>;

export const UI_TEXT = {
  // Header on the per-customer custom-row sections.
  addedForCustomer: msg`Added for this customer`,
  // Badge shown to Carbon staff on editable / internal-only surfaces.
  carbonOnly: msg`Carbon-only`,
  // Note under a Carbon-owned fill-in field the customer sees but can't edit.
  carbonOnlyLockedField: msg`Carbon-only · the customer sees this text, locked.`,
  // Note under the Value Snapshot's editable metrics.
  carbonOnlyValueNote: msg`Carbon-only · fill in real targets for this customer. They see the values, locked.`
} satisfies Record<string, MessageDescriptor>;
