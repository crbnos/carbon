import type { Owner } from "../types";

export interface RoleLine {
  label: string;
  owner: Owner;
}

export interface RolesStep {
  stepKey: string;
  title: string;
  lines: RoleLine[];
}

// Ours/Yours/Shared split per step (the prototype's roles matrix). Drives the
// Roles & Responsibilities page.
export const ROLES: RolesStep[] = [
  {
    stepKey: "gate:discovery",
    title: "Discovery",
    lines: [
      { owner: "carbon", label: "Map your current process, systems, and data" },
      { owner: "you", label: "Provide process knowledge and inputs" },
      {
        owner: "you",
        label: "Name an internal project owner with decision authority"
      },
      { owner: "you", label: "Commit a champion user for each area" },
      { owner: "shared", label: "Confirm and sign the scope" }
    ]
  },
  {
    stepKey: "gate:configure",
    title: "Configure",
    lines: [
      {
        owner: "carbon",
        label:
          "Configure sites, work centers, Bill of Process, BOMs, costing, roles"
      },
      {
        owner: "you",
        label: "Set up your own data with import tools and LLM help"
      },
      { owner: "carbon", label: "Build integrations and customizations" },
      { owner: "carbon", label: "Host, secure, and back up the platform" }
    ]
  },
  {
    stepKey: "gate:migrate",
    title: "Migrate data",
    lines: [
      { owner: "carbon", label: "Pull, map, and load your data" },
      { owner: "you", label: "Clean and approve the migrated data" }
    ]
  },
  {
    stepKey: "gate:train",
    title: "Train",
    lines: [
      {
        owner: "carbon",
        label: "Build tailored, role-based training materials"
      },
      { owner: "carbon", label: "Run hands-on sessions with your champions" },
      { owner: "you", label: "Protect training time and attend" },
      {
        owner: "you",
        label: "Train the rest of your team (after train-the-trainer)"
      }
    ]
  },
  {
    stepKey: "gate:acceptance",
    title: "Acceptance",
    lines: [
      { owner: "shared", label: "Run acceptance testing" },
      { owner: "shared", label: "Make the go / no-go decision" }
    ]
  },
  {
    stepKey: "gate:golive",
    title: "Go-Live",
    lines: [
      { owner: "carbon", label: "Cutover support" },
      { owner: "you", label: "Protect the go-live date" },
      { owner: "shared", label: "Hypercare in the first weeks" },
      { owner: "carbon", label: "Product issues during hypercare" }
    ]
  }
];
