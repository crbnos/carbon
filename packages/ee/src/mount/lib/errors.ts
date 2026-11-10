// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import axios from "axios";
import { MountApiError } from "./types";

const MAX_ERROR_DETAIL_LENGTH = 300;

/**
 * Turn an axios failure into a `MountApiError` whose message names what Mount
 * said. Anything that is not an axios error passes through untouched.
 */
export function toMountApiError(error: unknown): unknown {
  if (!axios.isAxiosError(error)) return error;

  const status = error.response?.status ?? null;
  if (status === null) {
    return new MountApiError(
      `Could not reach Mount (${error.code ?? error.message})`,
      null
    );
  }

  const detail = describeMountErrorBody(error.response?.data);
  return new MountApiError(
    detail ? `Mount answered ${status}: ${detail}` : `Mount answered ${status}`,
    status
  );
}

/**
 * Mount's spec documents no error responses, so the body is read defensively:
 * the usual summary fields (problem details, OAuth errors, plain messages),
 * then any per-field validation errors. An HTML page from a proxy says
 * nothing useful and is dropped.
 */
export function describeMountErrorBody(body: unknown): string | null {
  if (typeof body === "string") {
    const text = body.trim();
    return text && !text.startsWith("<") ? truncate(text) : null;
  }
  if (!body || typeof body !== "object") return null;

  const record = body as Record<string, unknown>;
  const summary = ["detail", "message", "error_description", "title", "error"]
    .map((key) => record[key])
    .find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    );
  const fieldErrors = describeFieldErrors(record.errors);

  const text = [summary?.trim(), fieldErrors].filter(Boolean).join(" ");
  return text ? truncate(text) : null;
}

function describeFieldErrors(errors: unknown): string | null {
  if (Array.isArray(errors)) {
    const messages = errors
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? ((entry as Record<string, unknown>).message ??
              (entry as Record<string, unknown>).description)
            : null
      )
      .filter((message): message is string => typeof message === "string");
    return messages.length > 0 ? messages.join("; ") : null;
  }
  if (errors && typeof errors === "object") {
    const messages = Object.entries(errors).map(
      ([field, value]) =>
        `${field}: ${Array.isArray(value) ? value.join(", ") : String(value)}`
    );
    return messages.length > 0 ? messages.join("; ") : null;
  }
  return null;
}

function truncate(text: string) {
  return text.length > MAX_ERROR_DETAIL_LENGTH
    ? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
    : text;
}

/** The part of the health check that failed. */
export type MountHealthcheckStep = "settings" | "token" | "read";

/**
 * Why the health check failed, in a sentence the person fixing it can act
 * on: what Mount said, then where the fix is. Mount's 403s carry no body, so
 * the status alone has to point at the client's member.
 */
export function describeHealthcheckFailure(
  step: MountHealthcheckStep,
  error: unknown
): string {
  const said = (error instanceof Error ? error.message : String(error)).replace(
    /\.$/,
    ""
  );
  if (!(error instanceof MountApiError)) return `${said}.`;
  if (error.status === null) return `${said}. Check the API URL.`;

  if (step === "token") {
    return error.status === 400 || error.status === 401
      ? `${said}. Check the client ID, client secret and tenant, and that the secret has not expired in Mount.`
      : `${said} when asked for an access token. Check the API URL and tenant.`;
  }
  if (error.status === 403) {
    return `${said}. Mount accepted the client but refused the request: set a Member ID on the API client in Mount, and check that member can view and edit companies and objects.`;
  }
  return `${said}.`;
}
