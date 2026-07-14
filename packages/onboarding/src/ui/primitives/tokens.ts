// Canonical visual tokens for owners and statuses. Single source so a colour or
// label change lands everywhere at once (previously these maps were re-declared
// in RolesView, BoardTable, etc.). Adding an owner/status = one entry here.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Owner, TaskValue } from "../../types";

export interface OwnerToken {
  label: MessageDescriptor;
  // pill background + text
  cls: string;
  // accompanying dot
  dot: string;
}

export const OWNER_TOKENS: Record<Owner, OwnerToken> = {
  carbon: {
    label: msg`Carbon`,
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500"
  },
  you: {
    label: msg`You`,
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500"
  },
  shared: {
    label: msg`Shared`,
    cls: "border text-muted-foreground",
    dot: "bg-muted-foreground"
  }
};

export interface StatusToken {
  label: MessageDescriptor;
  cls: string;
  dot: string;
}

export const TASK_STATUS_TOKENS: Record<TaskValue, StatusToken> = {
  todo: {
    label: msg`Not started`,
    dot: "bg-muted-foreground/50",
    cls: "border text-muted-foreground"
  },
  prog: {
    label: msg`In progress`,
    dot: "bg-blue-500",
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  },
  blocked: {
    label: msg`Blocked`,
    dot: "bg-red-500",
    cls: "bg-red-500/10 text-red-600 dark:text-red-400"
  },
  done: {
    label: msg`Done`,
    dot: "bg-emerald-500",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  }
};
