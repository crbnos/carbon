import {
  CONTROLLED_ENVIRONMENT,
  POSTHOG_API_HOST,
  POSTHOG_PROJECT_PUBLIC_KEY
} from "@carbon/env";
import { getLogger } from "@carbon/logger";
import {
  WORK_EVENT_MODULE,
  WORK_EVENT_RECORD_KEY,
  type WorkEventName,
  type WorkEvents
} from "./events";
import { workEventId } from "./idempotency";

const log = getLogger("lib", "telemetry");

/**
 * Server-side work-event capture.
 *
 * ## Why there is no SDK here
 *
 * `posthog-node` is not a dependency and does not need to be. Capture is a JSON
 * POST with an api_key, and the two things the SDK adds on top — batching and
 * retry — are the wrong shape for this: a work event is low-frequency, and a
 * retry without a stable id is how you double-count a released job. This mirrors
 * the decision already made for Inngest in
 * `packages/database/supabase/functions/lib/inngest.ts`, and the shape of
 * `packages/stripe/src/gtm-events.server.ts`, which POSTs product events to the
 * GTM endpoint the same way.
 *
 * ## Exactly-once
 *
 * Each event carries a `uuid` derived from (companyId, event, recordId,
 * discriminator) — see `./idempotency.ts`. PostHog's own de-duplication on that
 * field is eventual and documented as not guaranteed, so this id is what the
 * warehouse de-duplicates on downstream. Emitting the same occurrence twice is
 * therefore safe by construction, which is what lets every call site here be
 * fire-and-forget.
 *
 * ## When nothing is sent
 *
 * Both conditions mirror the browser SDK's own gate exactly — see
 * `apps/erp/app/entry.client.tsx:31`, `if (POSTHOG_PROJECT_PUBLIC_KEY &&
 * !CONTROLLED_ENVIRONMENT)`. Server capture must not be reachable anywhere the
 * browser's is not, or a deployment that believes it has analytics switched off
 * would start emitting business records.
 *
 * - No `POSTHOG_PROJECT_PUBLIC_KEY`. Self-hosted deployments set no PostHog
 *   variables at all, so they stay silent.
 * - `CONTROLLED_ENVIRONMENT` is on. An ITAR deployment ships nothing about a
 *   U.S.-Persons-only environment to a third-party vendor.
 */

/** PostHog's documented single-event capture path. */
const CAPTURE_PATH = "/i/v0/e/";

/** Abandon a capture rather than hold a request open behind it. */
const TIMEOUT_MS = 3_000;

export type CaptureResult =
  | { sent: true; eventId: string }
  | { sent: false; reason: "disabled" | "controlled_environment" | "failed" };

function isEnabled(): CaptureResult | null {
  if (!POSTHOG_PROJECT_PUBLIC_KEY) return { sent: false, reason: "disabled" };
  if (CONTROLLED_ENVIRONMENT)
    return { sent: false, reason: "controlled_environment" };
  return null;
}

/**
 * Record that a piece of work happened.
 *
 * Never throws and never rejects: a failed capture must not fail the action that
 * produced it. Callers may leave the promise unawaited.
 *
 * @param event   the work that happened
 * @param payload its properties — ids, enums, counts and quantities only
 * @param options `discriminator` distinguishes repeat work on one record, so a
 *                second production quantity against the same operation is not
 *                mistaken for a retry of the first
 */
export async function captureWorkEvent<E extends WorkEventName>(
  event: E,
  payload: WorkEvents[E],
  options?: { discriminator?: string | number | null }
): Promise<CaptureResult> {
  try {
    const disabled = isEnabled();
    if (disabled) return disabled;

    const { companyId, userId, ...properties } = payload;

    const recordId = String(
      (payload as Record<string, unknown>)[
        WORK_EVENT_RECORD_KEY[event] as string
      ] ?? ""
    );

    const eventId = workEventId({
      event,
      companyId,
      recordId,
      discriminator: options?.discriminator
    });

    // PostHog warns against a shared "backend" distinct_id: it rate-limits the
    // stream and bills every event as identified. A company-scoped id with
    // person processing off is their recommended shape for actorless events.
    // https://posthog.com/docs/product-analytics/identity-resolution
    const anonymous = !userId;

    const body = {
      api_key: POSTHOG_PROJECT_PUBLIC_KEY,
      event,
      // The browser calls posthog.identify(userId), so a server event keyed on
      // the same id lands on the same person with no merge.
      distinct_id: userId ?? `company:${companyId}`,
      uuid: eventId,
      timestamp: new Date().toISOString(),
      properties: {
        ...properties,
        companyId,
        module: WORK_EVENT_MODULE[event],
        /** Marks the row as a business fact rather than browser telemetry. */
        work_event: true,
        /** Attribution to the company group; does not create the group. */
        $groups: { company: companyId },
        ...(anonymous ? { $process_person_profile: false } : {})
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(
        new URL(CAPTURE_PATH, POSTHOG_API_HOST).toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log.error("work event rejected", {
          event,
          status: res.status,
          body: text.slice(0, 500)
        });
        return { sent: false, reason: "failed" };
      }

      return { sent: true, eventId };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Includes the abort. A lost measurement beats a failed action.
    log.error("work event failed", { event, err });
    return { sent: false, reason: "failed" };
  }
}

/**
 * Fire-and-forget form, for call sites that should not await telemetry.
 *
 * Prefer this everywhere in a request path. The returned promise is already
 * handled; ignoring it will not produce an unhandled rejection.
 */
export function trackWorkEvent<E extends WorkEventName>(
  event: E,
  payload: WorkEvents[E],
  options?: { discriminator?: string | number | null }
): void {
  void captureWorkEvent(event, payload, options);
}

export type {
  JobSource,
  WorkEventName,
  WorkEvents,
  WorkModule,
  WorkSource
} from "./events";
export { WORK_EVENT_MODULE, WORK_EVENT_NAMES } from "./events";
export { workEventId } from "./idempotency";
