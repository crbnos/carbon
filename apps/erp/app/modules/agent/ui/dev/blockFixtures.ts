// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Dev-only fixtures for the block viewer — one entry per block variant.
export type BlockFixture = {
  label: string;
  blocks: { toolName: string; input: unknown }[];
};

export const BLOCK_FIXTURES: BlockFixture[] = [
  {
    label: "Link",
    blocks: [
      {
        toolName: "present_link",
        input: {
          label: "Open the Jobs docs",
          url: "https://docs.carbon.ms/docs/reference/jobs"
        }
      }
    ]
  },
  {
    label: "Button",
    blocks: [
      {
        toolName: "present_button",
        input: {
          label: "Show open purchase orders",
          message: "Show me open purchase orders"
        }
      }
    ]
  },
  {
    label: "Choice — single",
    blocks: [
      {
        toolName: "present_choice",
        input: {
          prompt: "Which job did you mean?",
          options: [
            { id: "1", label: "JOB-1042 — Bracket", value: "JOB-1042" },
            { id: "2", label: "JOB-1050 — Housing", value: "JOB-1050" }
          ]
        }
      }
    ]
  },
  {
    label: "Choice — multi-select",
    blocks: [
      {
        toolName: "present_choice",
        input: {
          prompt: "Which modules should I summarize?",
          multiSelect: true,
          options: [
            { id: "a", label: "Sales", value: "sales" },
            { id: "b", label: "Inventory", value: "inventory" },
            { id: "c", label: "Production", value: "production" }
          ]
        }
      }
    ]
  },
  {
    label: "Choice — free text",
    blocks: [
      {
        toolName: "present_choice",
        input: {
          prompt: "How can I help?",
          allowFreeText: true,
          freeTextPlaceholder: "Or describe what you need…",
          options: [
            { id: "1", label: "Find a job", value: "find a job" },
            { id: "2", label: "Check stock", value: "check stock" }
          ]
        }
      }
    ]
  },
  {
    label: "Link + Button",
    blocks: [
      {
        toolName: "present_link",
        input: {
          label: "Docs: Jobs",
          url: "https://docs.carbon.ms/docs/reference/jobs"
        }
      },
      {
        toolName: "present_button",
        input: { label: "Explain jobs", message: "Explain what a job is" }
      }
    ]
  }
];
