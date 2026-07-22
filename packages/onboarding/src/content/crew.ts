import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod } from "../types";

// Ready Your Team — Your Crew (one champion per in-scope area) and the floor
// rollout, where MES adoption is decided. In a ten-person factory one person
// wears three hats; the same name can hold several areas.

export interface CrewArea {
  key: string;
  label: MessageDescriptor;
  // Areas vanish with their module (quality out of scope → no quality champion).
  moduleTags?: Mod[];
  // The five real tasks — on their real data — that end in the sign-off.
  tasks: MessageDescriptor[];
}

export const CREW_AREAS: CrewArea[] = [
  {
    key: "sales",
    label: msg`Sales & Quoting`,
    moduleTags: ["sal"],
    tasks: [
      msg`Quote a real part`,
      msg`Turn the quote into a sales order`,
      msg`Check an order's promise date`,
      msg`Find a customer's open orders`,
      msg`Preview an invoice`
    ]
  },
  {
    key: "purchasing",
    label: msg`Purchasing`,
    moduleTags: ["pur"],
    tasks: [
      msg`Cut a real purchase order`,
      msg`Receive material against it`,
      msg`Check what's on order from a supplier`,
      msg`Chase a late PO`,
      msg`Add a new supplier`
    ]
  },
  {
    key: "inventory",
    label: msg`Inventory & Shipping`,
    moduleTags: ["inv"],
    tasks: [
      msg`Look up what's on hand for a part`,
      msg`Issue material to a job`,
      msg`Ship a real order`,
      msg`Adjust a count that's wrong`,
      msg`Print a label`
    ]
  },
  {
    key: "production",
    label: msg`Production & Floor`,
    moduleTags: ["prd"],
    tasks: [
      msg`Release a job to the floor`,
      msg`Clock into an operation on the shop-floor app`,
      msg`Record produced quantity and scrap`,
      msg`Finish an operation and see the job move`,
      msg`Print a traveler from Carbon`
    ]
  },
  {
    key: "quality",
    label: msg`Quality`,
    moduleTags: ["qms"],
    tasks: [
      msg`Record an inspection result`,
      msg`Open a non-conformance on a real part`,
      msg`Disposition it`,
      msg`Find a part's inspection history`,
      msg`Review the quality dashboard`
    ]
  },
  {
    key: "accounting",
    label: msg`Accounting`,
    moduleTags: ["acc"],
    tasks: [
      msg`Post a sales invoice`,
      msg`Post a purchase invoice`,
      msg`Check a job's cost`,
      msg`Review the aging report`,
      msg`Close a day without surprises`
    ]
  }
];

export type CrewStatus = "invited" | "in-progress" | "signed-off";

export const CREW_STATUS_ORDER: CrewStatus[] = [
  "invited",
  "in-progress",
  "signed-off"
];

export const CREW_STATUS_LABEL: Record<CrewStatus, MessageDescriptor> = {
  invited: msg`Invited`,
  "in-progress": msg`In progress`,
  "signed-off": msg`Signed off`
};

// The floor rollout — hardware first (software people forget the physical
// world), operator access, one pilot station, then waves.
export const FLOOR_CHECKS: {
  key: string; // check:crew.floor.<key>
  label: MessageDescriptor;
  detail: MessageDescriptor;
}[] = [
  {
    key: "hardware",
    label: msg`Hardware at the pilot station`,
    detail: msg`A tablet or kiosk at the pilot work center; label printer if you label; scanner if you barcode.`
  },
  {
    key: "wifi",
    label: msg`Wifi reach test`,
    detail: msg`Walk the far corner of the floor with the tablet. Dead spots kill adoption quietly.`
  },
  {
    key: "operator-access",
    label: msg`Operator access — thirty seconds to clocked in`,
    detail: msg`Floor logins set up so any operator is clocked into a job within thirty seconds of picking up the tablet. Miss that bar and the floor votes no with its feet.`
  },
  {
    key: "pilot-station",
    label: msg`Three jobs through the pilot station`,
    detail: msg`One work center, one shift, champion standing there. Paper travelers keep printing — from Carbon — so paper becomes a printout of the same truth.`
  }
];

export const FLOOR_WAVES_NOTE = msg`Then spread station by station: a six-station floor is two waves; a thirty-station floor is four to six, mostly after go-live. Full floor coverage is deliberately not a go-live blocker — the pilot station is.`;
