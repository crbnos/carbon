// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  linkDefaults: undefined as Record<string, unknown> | undefined,
  selectPlaceholder: undefined as string | undefined,
  selectChange: undefined as
    | ((option: { value: string } | null) => void)
    | undefined,
  submitDisabled: undefined as boolean | undefined
}));

// Match the server-rendered composer tests while retaining each state slot
// between renders, so the link modal's initial selection can be exercised.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (seed: unknown) => {
      const index = harness.stateIndex++;
      if (!(index in harness.states)) {
        harness.states[index] =
          typeof seed === "function" ? (seed as () => unknown)() : seed;
      }
      return [
        harness.states[index],
        (value: unknown) => {
          harness.states[index] =
            typeof value === "function"
              ? (value as (previous: unknown) => unknown)(harness.states[index])
              : value;
        }
      ];
    }
  };
});

vi.mock("@carbon/auth", () => ({
  useCarbon: () => ({ carbon: null })
}));
vi.mock("@carbon/form", () => ({
  ValidatedForm: (props: {
    children?: ReactNode;
    defaultValues?: Record<string, unknown>;
  }) => {
    harness.linkDefaults = props.defaultValues;
    return createElement("form", null, props.children);
  }
}));
vi.mock("@carbon/react", () => {
  const Box = (props: { children?: ReactNode }) =>
    createElement("div", null, props.children);
  return {
    Badge: Box,
    Button: Box,
    HStack: Box,
    Label: Box,
    Modal: Box,
    ModalBody: Box,
    ModalContent: Box,
    ModalFooter: Box,
    ModalHeader: Box,
    ModalTitle: Box,
    VStack: Box,
    toast: { error: vi.fn() }
  };
});
vi.mock("@carbon/react/Editor", () => ({ Editor: () => null }));
vi.mock("@carbon/utils", () => ({ formatDate: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({
  Trans: (props: { children?: ReactNode }) => props.children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce(
        (text, part, index) => text + part + (values[index] ?? ""),
        ""
      )
  })
}));
vi.mock("@react-aria/i18n", () => ({ useLocale: () => ({ locale: "en-US" }) }));
vi.mock("react-icons/lu", () => ({
  LuLink: () => null,
  LuLink2Off: () => null,
  LuShieldCheck: () => null
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle" })
}));
vi.mock("~/components", () => ({ EmployeeAvatar: () => null }));
vi.mock("~/components/Form", () => ({
  DatePicker: () => null,
  Employee: () => null,
  Hidden: () => null,
  Input: () => null,
  Select: (props: {
    placeholder?: string;
    onChange?: (option: { value: string } | null) => void;
  }) => {
    harness.selectPlaceholder = props.placeholder;
    harness.selectChange = props.onChange;
    return null;
  },
  Submit: (props: { isDisabled?: boolean }) => {
    harness.submitDisabled = props.isDisabled;
    return createElement("button", {
      disabled: !!props.isDisabled,
      type: "submit"
    });
  }
}));
vi.mock("~/hooks", () => ({
  usePermissions: () => ({ can: () => true }),
  useUser: () => ({ company: { id: "company-1" } })
}));
vi.mock("~/utils/path", () => ({
  getPrivateUrl: vi.fn(),
  path: {
    to: {
      changeNoticeImpactTaskCreate: (id: string) =>
        `/x/change-notice/${id}/impact/task`,
      changeNoticeImpactTaskLink: (id: string) =>
        `/x/change-notice/${id}/impact/task/link`
    }
  }
}));
vi.mock("./ChangeNoticeActionTaskItem", () => ({
  ChangeNoticeActionTaskItem: () => null
}));

const { ChangeNoticeImpactTasks, getChangeNoticeImpactTaskControls } =
  await import("./ChangeNoticeImpactTasks");

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "purchaseOrderLine",
    targetId: "pol-1",
    parent: null,
    item: null,
    currentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: "Current operational exposure",
    sourceAvailability: "Present",
    unavailableReason: null,
    decision: null,
    freshness: null,
    taskLinks: [],
    ...overrides
  } as never;
}

const ordinaryTask = {
  id: "task-ordinary",
  name: "Ask supplier",
  status: "Pending",
  taskOrigin: "Manual"
} as never;
const impactTask = {
  id: "task-impact",
  name: "Follow up on impact",
  status: "Pending",
  taskOrigin: "Impact follow-up"
} as never;

function actionRequiredCandidate(taskLinks: unknown[] = []) {
  return makeCandidate({
    decision: {
      id: "decision-1",
      status: "Action required"
    },
    taskLinks
  });
}

function linkFor(task: {
  id: string;
  name: string;
  status: string;
  taskOrigin: string;
}) {
  return {
    decisionId: "decision-1",
    actionTaskId: task.id,
    name: task.name,
    status: task.status,
    assignee: null,
    dueDate: null,
    taskOrigin: task.taskOrigin
  } as never;
}

describe("Change Notice Impact task controls", () => {
  it.each([
    ["Implementation", true],
    ["Done", true],
    ["Cancelled", true]
  ] as const)("gates task creation for an Action required decision in %s", (changeNoticeStatus, canCreate) => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: actionRequiredCandidate(),
      actions: [],
      changeNoticeStatus,
      canUpdate: true
    });

    expect(controls.canCreate).toBe(canCreate);
  });

  it("allows existing-decision task operations after Done without converting ordinary tasks", () => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: actionRequiredCandidate(),
      actions: [ordinaryTask, impactTask],
      changeNoticeStatus: "Done",
      canUpdate: true
    });

    expect(controls.canCreate).toBe(true);
    expect(controls.canLink).toBe(true);
    expect(controls.linkableTasks.map((task) => task.id)).toEqual([
      "task-ordinary",
      "task-impact"
    ]);
    expect(controls.canDesignate(linkFor(ordinaryTask))).toBe(false);
    expect(controls.canUnlink(linkFor(ordinaryTask))).toBe(true);
  });

  it("limits Cancelled cleanup to Impact follow-up tasks", () => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: actionRequiredCandidate(),
      actions: [ordinaryTask, impactTask],
      changeNoticeStatus: "Cancelled",
      canUpdate: true
    });

    expect(controls.canCreate).toBe(true);
    expect(controls.linkableTasks.map((task) => task.id)).toEqual([
      "task-impact"
    ]);
    expect(controls.canUnlink(linkFor(ordinaryTask))).toBe(false);
    expect(controls.canUnlink(linkFor(impactTask))).toBe(true);
    expect(controls.canDesignate(linkFor(ordinaryTask))).toBe(false);
  });

  it.each([
    "No action required",
    "Resolved"
  ] as const)("allows link and unlink after a decision becomes %s", (decisionStatus) => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: makeCandidate({
        decision: {
          id: "decision-1",
          status: decisionStatus
        },
        taskLinks: [linkFor(ordinaryTask)]
      }),
      actions: [ordinaryTask, impactTask],
      changeNoticeStatus: "Implementation",
      canUpdate: true
    });

    expect(controls.canLink).toBe(true);
    expect(controls.linkableTasks.map((task) => task.id)).toEqual([
      "task-impact"
    ]);
    expect(controls.canUnlink(linkFor(ordinaryTask))).toBe(true);
  });

  it.each([
    "No action required",
    "Resolved"
  ] as const)("does not expose cancelled cleanup after a decision becomes %s", (decisionStatus) => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: makeCandidate({
        decision: {
          id: "decision-1",
          status: decisionStatus
        },
        taskLinks: [linkFor(impactTask)]
      }),
      actions: [impactTask],
      changeNoticeStatus: "Cancelled",
      canUpdate: true
    });

    expect(controls.canCreate).toBe(false);
    expect(controls.canLink).toBe(false);
    expect(controls.canUnlink(linkFor(impactTask))).toBe(false);
  });

  it("does not expose task creation for an Unassessed target", () => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: makeCandidate(),
      actions: [],
      changeNoticeStatus: "Implementation",
      canUpdate: true
    });

    expect(controls.canCreate).toBe(false);
  });

  it("only exposes designation for ordinary linked tasks before Done", () => {
    const controls = getChangeNoticeImpactTaskControls({
      candidate: actionRequiredCandidate([linkFor(ordinaryTask)]),
      actions: [ordinaryTask],
      changeNoticeStatus: "Implementation",
      canUpdate: true
    });

    expect(controls.canDesignate(linkFor(ordinaryTask))).toBe(true);
    expect(controls.canUnlink(linkFor(ordinaryTask))).toBe(true);
  });

  it("does not expose controls for restricted sources or users without update permission", () => {
    const restricted = getChangeNoticeImpactTaskControls({
      candidate: makeCandidate({
        sourceAvailability: "Restricted",
        decision: {
          id: "decision-1",
          status: "Action required"
        }
      }),
      actions: [ordinaryTask],
      changeNoticeStatus: "Implementation",
      canUpdate: true
    });
    const readOnly = getChangeNoticeImpactTaskControls({
      candidate: actionRequiredCandidate(),
      actions: [ordinaryTask],
      changeNoticeStatus: "Implementation",
      canUpdate: false
    });

    expect(restricted.canCreate).toBe(false);
    expect(restricted.canLink).toBe(false);
    expect(restricted.canUnlink(linkFor(ordinaryTask))).toBe(false);
    expect(restricted.canDesignate(linkFor(ordinaryTask))).toBe(false);
    expect(readOnly.canCreate).toBe(false);
    expect(readOnly.canLink).toBe(false);
  });
});

function renderTasks() {
  harness.stateIndex = 0;
  return renderToStaticMarkup(
    createElement(ChangeNoticeImpactTasks, {
      changeNoticeId: "cn-1",
      changeNoticeStatus: "Implementation",
      candidate: actionRequiredCandidate(),
      actions: [ordinaryTask],
      canUpdate: true,
      taskCoverageStatus: "complete",
      onRefresh: () => undefined
    })
  );
}

describe("Change Notice Impact link task picker", () => {
  beforeEach(() => {
    harness.states = [];
    harness.stateIndex = 0;
    harness.linkDefaults = undefined;
    harness.selectPlaceholder = undefined;
    harness.selectChange = undefined;
    harness.submitDisabled = undefined;
  });

  it("opens without an implicit task selection", () => {
    // Seed the workspace's createOpen/linkOpen state so the link modal mounts.
    harness.states = [false, true];
    renderTasks();

    expect(harness.linkDefaults?.actionTaskId).toBeUndefined();
    expect(harness.selectPlaceholder).toBe("Select Task");
    expect(harness.submitDisabled).toBe(true);
  });

  it("enables Link Task only after a task is chosen", () => {
    harness.states = [false, true];
    renderTasks();

    harness.selectChange?.({ value: "task-ordinary" });
    renderTasks();

    expect(harness.submitDisabled).toBe(false);
  });
});
