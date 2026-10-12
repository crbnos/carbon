// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isRouteErrorResponse } from "react-router";

export type RouteErrorCopy = {
  status?: number;
  title: string;
  message: string;
  /** Trying again can help: the failure was on our side, not in the request. */
  canRetry: boolean;
};

// Bodies that only repeat the status and say nothing about what failed.
const GENERIC_BODIES = new Set(["", "not found", "bad request", "forbidden"]);

const TITLES: Record<number, string> = {
  401: "You are signed out",
  403: "You do not have access to this",
  404: "Not found"
};

const MESSAGES: Record<number, string> = {
  401: "Sign in again to continue.",
  403: "Ask an administrator of this company for the permission.",
  404: "This page may have been moved or deleted, or it belongs to another company."
};

/**
 * What the route error screen says for a thrown value.
 *
 * A 4xx is about the request, so the server's own message is shown: a save
 * that named a deleted record must not read as a missing page. A 5xx or a
 * thrown `Error` keeps the generic copy, since its text is internal detail.
 */
export function routeErrorCopy(error: unknown): RouteErrorCopy {
  if (
    !isRouteErrorResponse(error) ||
    error.status < 400 ||
    error.status >= 500
  ) {
    return {
      status: isRouteErrorResponse(error) ? error.status : undefined,
      title: "Something went wrong",
      message:
        "Something went wrong on our side. Trying again usually fixes it.",
      canRetry: true
    };
  }

  // React Router's own 4xx (no route, no action) carries developer text.
  const detail = isInternal(error) ? undefined : responseMessage(error.data);
  return {
    status: error.status,
    title: TITLES[error.status] ?? "This request could not be completed",
    message:
      detail ??
      MESSAGES[error.status] ??
      "The request was refused. Go back and try again.",
    canRetry: false
  };
}

function isInternal(error: object): boolean {
  return "internal" in error && error.internal === true;
}

function responseMessage(data: unknown): string | undefined {
  const text =
    typeof data === "string"
      ? data
      : data && typeof data === "object" && "message" in data
        ? data.message
        : undefined;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  return GENERIC_BODIES.has(trimmed.toLowerCase()) ? undefined : trimmed;
}
