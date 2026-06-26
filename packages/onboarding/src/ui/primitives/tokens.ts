// Canonical visual tokens for owners and statuses. Single source so a colour or
// label change lands everywhere at once (previously these maps were re-declared
// in RolesView, BoardTable, etc.). Adding an owner/status = one entry here.

import type { Owner, TaskValue } from "../../types";

export interface OwnerToken {
  label: string;
  // pill background + text
  cls: string;
  // accompanying dot
  dot: string;
}

export const OWNER_TOKENS: Record<Owner, OwnerToken> = {
  carbon: {
    label: "Carbon",
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500"
  },
  you: {
    label: "You",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500"
  },
  shared: {
    label: "Shared",
    cls: "border text-muted-foreground",
    dot: "bg-muted-foreground"
  }
};

export interface StatusToken {
  label: string;
  cls: string;
  dot: string;
}

export const TASK_STATUS_TOKENS: Record<TaskValue, StatusToken> = {
  todo: {
    label: "Not started",
    dot: "bg-muted-foreground/50",
    cls: "border text-muted-foreground"
  },
  prog: {
    label: "In progress",
    dot: "bg-blue-500",
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  },
  blocked: {
    label: "Blocked",
    dot: "bg-red-500",
    cls: "bg-red-500/10 text-red-600 dark:text-red-400"
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  }
};
