import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Owner } from "../types";

export interface RoleLine {
  label: MessageDescriptor;
  owner: Owner;
}

export interface RolesStep {
  stepKey: string;
  title: MessageDescriptor;
  lines: RoleLine[];
}

// Ours/Yours/Shared split per phase (the prototype's roles matrix). Drives the
// Roles & Responsibilities page — a paid-tier page, so lines describe the
// Carbon-alongside-you version of each phase.
export const ROLES: RolesStep[] = [
  {
    stepKey: "gate:intake",
    title: msg`Tell Us How You Run`,
    lines: [
      {
        owner: "shared",
        label: msg`Complete the intake — on a call, or we fill it in for you`
      },
      {
        owner: "you",
        label: msg`Name an internal project owner with decision authority`
      },
      { owner: "you", label: msg`Pick the go-live date and protect it` },
      { owner: "carbon", label: msg`Tailor the plan from your answers` }
    ]
  },
  {
    stepKey: "gate:basics",
    title: msg`Set Up the Basics`,
    lines: [
      {
        owner: "carbon",
        label: msg`Configure sites, work centers, Bill of Process, costing, roles`
      },
      {
        owner: "you",
        label: msg`Make the five decisions and confirm the defaults`
      },
      { owner: "carbon", label: msg`Build integrations and customizations` },
      { owner: "carbon", label: msg`Host, secure, and back up the platform` }
    ]
  },
  {
    stepKey: "gate:load-data",
    title: msg`Load Your Data`,
    lines: [
      { owner: "you", label: msg`Produce the exports from your old systems` },
      { owner: "carbon", label: msg`Map, clean, and load your data` },
      { owner: "you", label: msg`Spot-check samples and approve them` }
    ]
  },
  {
    stepKey: "gate:pilot",
    title: msg`Prove It Works`,
    lines: [
      { owner: "you", label: msg`Pick the bread-and-butter order` },
      { owner: "shared", label: msg`Run it end to end, together` },
      { owner: "carbon", label: msg`Unstick anything the trace surfaces` }
    ]
  },
  {
    stepKey: "gate:crew",
    title: msg`Ready Your Team`,
    lines: [
      {
        owner: "carbon",
        label: msg`Run live role-by-role sessions on your data`
      },
      { owner: "you", label: msg`Protect training time and attend` },
      { owner: "you", label: msg`Champions sign off their areas` },
      { owner: "shared", label: msg`Stand up the pilot floor station` }
    ]
  },
  {
    stepKey: "gate:switch",
    title: msg`Make the Switch`,
    lines: [
      { owner: "you", label: msg`Count the stock and sign the freeze plan` },
      { owner: "carbon", label: msg`Load open transactions and verify balances` },
      { owner: "shared", label: msg`Make the go / no-go call` },
      { owner: "carbon", label: msg`Stand by on switch day` }
    ]
  },
  {
    stepKey: "gate:live",
    title: msg`Live on Carbon`,
    lines: [
      { owner: "you", label: msg`Run every order in Carbon — ten straight days` },
      { owner: "shared", label: msg`Hypercare in the first weeks` },
      { owner: "carbon", label: msg`Product issues during hypercare` }
    ]
  }
];
