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

// Ours/Yours/Shared split per step (the prototype's roles matrix). Drives the
// Roles & Responsibilities page.
export const ROLES: RolesStep[] = [
  {
    stepKey: "gate:discovery",
    title: msg`Discovery`,
    lines: [
      {
        owner: "carbon",
        label: msg`Map your current process, systems, and data`
      },
      { owner: "you", label: msg`Provide process knowledge and inputs` },
      {
        owner: "you",
        label: msg`Name an internal project owner with decision authority`
      },
      { owner: "you", label: msg`Commit a champion user for each area` },
      { owner: "shared", label: msg`Confirm and sign the scope` }
    ]
  },
  {
    stepKey: "gate:configure",
    title: msg`Configure`,
    lines: [
      {
        owner: "carbon",
        label: msg`Configure sites, work centers, Bill of Process, BOMs, costing, roles`
      },
      {
        owner: "you",
        label: msg`Set up your own data with import tools and LLM help`
      },
      { owner: "carbon", label: msg`Build integrations and customizations` },
      { owner: "carbon", label: msg`Host, secure, and back up the platform` }
    ]
  },
  {
    stepKey: "gate:migrate",
    title: msg`Migrate data`,
    lines: [
      { owner: "carbon", label: msg`Pull, map, and load your data` },
      { owner: "you", label: msg`Clean and approve the migrated data` }
    ]
  },
  {
    stepKey: "gate:train",
    title: msg`Train`,
    lines: [
      {
        owner: "carbon",
        label: msg`Build tailored, role-based training materials`
      },
      {
        owner: "carbon",
        label: msg`Run hands-on sessions with your champions`
      },
      { owner: "you", label: msg`Protect training time and attend` },
      {
        owner: "you",
        label: msg`Train the rest of your team (after train-the-trainer)`
      }
    ]
  },
  {
    stepKey: "gate:acceptance",
    title: msg`Acceptance`,
    lines: [
      { owner: "shared", label: msg`Run acceptance testing` },
      { owner: "shared", label: msg`Make the go / no-go decision` }
    ]
  },
  {
    stepKey: "gate:golive",
    title: msg`Go-Live`,
    lines: [
      { owner: "carbon", label: msg`Cutover support` },
      { owner: "you", label: msg`Protect the go-live date` },
      { owner: "shared", label: msg`Hypercare in the first weeks` },
      { owner: "carbon", label: msg`Product issues during hypercare` }
    ]
  }
];
