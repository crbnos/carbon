import { toast } from "@carbon/react";
import type { Violation } from "@carbon/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import ItemRuleViolationModal from "~/components/ItemRuleViolationModal";

/**
 * Shape every item-rule-aware server action must return when it wants the
 * client to surface violations. Mirrors the payload produced by
 * `evaluateForItem` + the per-action wrapper that resolves rule names.
 */
export type ItemRuleViolationPayload = {
  error?: { message?: string } | null;
  data?: unknown;
  violations?: Violation[];
  ruleNames?: Record<string, string>;
};

type UseItemRuleViolationsOptions = {
  /** Server action endpoint that the form is posted to. */
  action: string;
  /**
   * Optional callback fired once a submission resolves with no violations
   * and no error — i.e. the operation actually succeeded.
   */
  onSuccess?: () => void;
};

type UseItemRuleViolationsResult<T> = {
  // `useFetcher<T>` actually returns `FetcherWithComponents<SerializeFrom<T>>`;
  // mirror that here so callers see the serialised payload type without us
  // having to import the React Router internal `SerializeFrom` helper.
  fetcher: ReturnType<typeof useFetcher<T>>;
  /** Submit a form. Captures the FormData so acknowledge can re-post it. */
  submit: (formData: FormData) => void;
  /**
   * Render this somewhere in your component to surface violations. Returns
   * `null` when there's nothing to show.
   */
  ViolationModal: () => JSX.Element | null;
};

/**
 * Centralised handler for item rule violations + action errors.
 *
 * Wraps a `useFetcher` and:
 * - toasts any `error.message` returned by the action
 * - opens `<ItemRuleViolationModal>` when the action returns `violations`
 * - re-posts the last form data with `acknowledged=true` when the user
 *   clicks "Acknowledge & continue"
 * - resets the dismissed/ack flags on every fresh submission
 *
 * Call sites only have to swap `fetcher.submit(...)` for `rules.submit(...)`
 * and render `<rules.ViolationModal />`. Everything else is wired internally.
 */
export function useItemRuleViolations<T = unknown>({
  action,
  onSuccess
}: UseItemRuleViolationsOptions): UseItemRuleViolationsResult<T> {
  const fetcher = useFetcher<T>();
  const lastSubmissionRef = useRef<FormData | null>(null);
  // Tracks whether a submission was issued but onSuccess hasn't fired yet.
  // Server actions that respond with `throw redirect(...)` leave
  // `fetcher.data` undefined after the request settles, so we can't rely on
  // `data` alone to detect "operation succeeded".
  const pendingSuccessRef = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  // Staged payload for the *current* submission. We can't read `fetcher.data`
  // directly: on a redirect-throw, RR7 keeps the previous action's payload
  // attached to the fetcher, so the violation modal would stay mounted
  // forever (page reload was the only way out). Instead, we clear `staged`
  // when a new submission starts and only re-stage if `fetcher.data` is a
  // *different* reference than what we last consumed.
  const [staged, setStaged] = useState<ItemRuleViolationPayload | undefined>(
    undefined
  );
  const lastSeenDataRef = useRef<unknown>(undefined);
  // Track idle→submitting transitions so the hook resets correctly even when
  // the form submits via `fetcher={...}` prop directly (bypassing `submit()`).
  const prevIdleRef = useRef(true);

  const data = fetcher.data as ItemRuleViolationPayload | undefined;
  const idle = fetcher.state === "idle";
  const violations = staged?.violations ?? [];
  const ruleNames = staged?.ruleNames;
  const hasViolations = violations.length > 0 && !dismissed;

  // Detect idle→submitting. Clear the staged payload from the previous
  // submission and reset per-submission flags. Works whether the form drives
  // the fetcher via `fetcher={...}` prop or via `submit()`.
  useEffect(() => {
    if (!idle && prevIdleRef.current) {
      setDismissed(false);
      setStaged(undefined);
      pendingSuccessRef.current = true;
      if (fetcher.formData) {
        lastSubmissionRef.current = fetcher.formData;
      }
    }
    prevIdleRef.current = idle;
  }, [idle, fetcher.formData]);

  // On settle: stage the payload (if changed) and decide success/error/block
  // in one pass. Consolidated into a single effect so the success check reads
  // the fresh `data` directly — splitting it caused the success effect to see
  // a stale `staged` from the same render, firing `onSuccess` before the
  // staging effect's setState had propagated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onSuccess identity is intentionally not tracked
  useEffect(() => {
    if (!idle) return;
    const dataChanged = data !== lastSeenDataRef.current;
    lastSeenDataRef.current = data;

    if (dataChanged) {
      setStaged(data);
      if (data?.error?.message) {
        toast.error(data.error.message);
        pendingSuccessRef.current = false;
        return;
      }
      if ((data?.violations ?? []).length > 0) {
        // Violations — keep modal open, don't fire success.
        return;
      }
      if (!pendingSuccessRef.current) return;
      pendingSuccessRef.current = false;
      onSuccess?.();
      return;
    }

    // Data ref unchanged across the submission → redirect-throw success.
    // `staged` was cleared at submit-start; nothing to render.
    if (!pendingSuccessRef.current) return;
    pendingSuccessRef.current = false;
    onSuccess?.();
  }, [idle, data]);

  const submit = useCallback(
    (formData: FormData) => {
      lastSubmissionRef.current = formData;
      // Reset the dismiss flag synchronously so the next response opens the
      // modal even if the previous one was dismissed without new violations.
      setDismissed(false);
      pendingSuccessRef.current = true;
      fetcher.submit(formData, { method: "post", action });
    },
    [fetcher, action]
  );

  const acknowledge = useCallback(() => {
    if (!lastSubmissionRef.current) return;
    const formData = new FormData();
    for (const [k, v] of lastSubmissionRef.current.entries()) {
      formData.append(k, v as string);
    }
    formData.set("acknowledged", "true");
    setDismissed(false);
    pendingSuccessRef.current = true;
    fetcher.submit(formData, { method: "post", action });
  }, [fetcher, action]);

  const cancel = useCallback(() => setDismissed(true), []);

  const ViolationModal = useCallback(() => {
    if (!hasViolations) return null;
    return (
      <ItemRuleViolationModal
        violations={violations}
        ruleNames={ruleNames}
        isSubmitting={!idle}
        onCancel={cancel}
        onAcknowledge={acknowledge}
      />
    );
  }, [hasViolations, violations, ruleNames, idle, cancel, acknowledge]);

  return { fetcher, submit, ViolationModal };
}
