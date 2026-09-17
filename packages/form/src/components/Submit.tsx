import { useFormState } from "@carbon/form";
import type { ButtonProps } from "@carbon/react";
import {
  Button,
  isEditableTarget,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  SHORTCUTS
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import { useBlocker, useNavigation } from "react-router";
import { useIsSubmitting } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import {
  isSubmitShortcutOwner,
  registerSubmitShortcut,
  shouldSubmitOnShortcut,
  submitShortcutCount,
  unregisterSubmitShortcut
} from "../internal/submitShortcutRegistry";
import { useFormContext } from "../userFacingFormContext";

type SubmitProps = Omit<ButtonProps, "shortcut"> & {
  formId?: string;
  withBlocker?: boolean;
  /**
   * Save shortcut — defaults to the shared ⌘/Ctrl+Enter binding, which fires
   * while typing in a field. `false` opts this Submit out entirely.
   */
  shortcut?: ButtonProps["shortcut"] | false;
};

export function DefaultDisabledSubmit({
  children,
  formId,
  isDisabled
}: {
  children: React.ReactNode;
  formId: string;
  isDisabled: boolean;
}) {
  const { touchedFields } = useFormContext(formId);
  const isTouched = Object.keys(touchedFields).length > 0;
  return (
    <Submit formId={formId} isDisabled={!isTouched || isDisabled}>
      {children}
    </Submit>
  );
}

export const Submit = forwardRef<HTMLButtonElement, SubmitProps>(
  (
    {
      formId,
      children,
      isDisabled: isDisabledProp,
      withBlocker = true,
      shortcut = SHORTCUTS.save,
      ...props
    },
    ref
  ) => {
    const formStateCtx = useFormStateContext();
    const isDisabled =
      formStateCtx.isDisabled || formStateCtx.isReadOnly || isDisabledProp;
    const isSubmitting = useIsSubmitting(formId);
    const transition = useNavigation();
    const isIdle = transition.state === "idle";
    const formState = useFormState(formId);
    const isTouched = Object.keys(formState.touchedFields).length > 0;

    const innerRef = useRef<HTMLButtonElement | null>(null);
    const setRefs = useCallback(
      (node: HTMLButtonElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    // The guard's sole-Submit fallback needs to know how many Submits are
    // active on screen; a mounted-but-invisible Submit still counts, which
    // fails safe (count > 1 → no-op).
    const shortcutActive =
      shortcut !== false && !(isDisabled || isSubmitting || !isIdle);
    const shortcutId = useRef<symbol | null>(null);
    if (shortcutId.current === null) {
      shortcutId.current = Symbol("submit-shortcut");
    }
    useEffect(() => {
      if (!shortcutActive) return;
      const id = shortcutId.current;
      if (!id) return;
      registerSubmitShortcut(id, innerRef.current?.form ?? null);
      return () => unregisterSubmitShortcut(id);
    }, [shortcutActive]);

    // Focus-aware guard: submit the form being edited; never steal keys from
    // other editable surfaces (lesson .ai/lessons.md:373); on body-focus fire
    // only when this is the sole active Submit — ambiguity means no-op.
    const shortcutGuard = useCallback((_event: KeyboardEvent) => {
      const el = innerRef.current;
      if (!el) return false;
      const active = document.activeElement;
      const activeForm =
        active instanceof HTMLElement ? active.closest("form") : null;
      return shouldSubmitOnShortcut({
        ownForm: el.form,
        activeForm,
        activeIsEditable: isEditableTarget(active),
        activeSubmitCount: submitShortcutCount(),
        ownsForm: shortcutId.current
          ? isSubmitShortcutOwner(shortcutId.current, el.form)
          : false
      });
    }, []);

    const blocker = useBlocker(
      ({ currentLocation, nextLocation }) =>
        withBlocker &&
        isTouched &&
        // The form's own save is not "leaving with unsaved changes": a form
        // whose action posts to a DIFFERENT route (e.g. the Add Company modal
        // on /x posting to /x/settings/company/new) submits via a cross-pathname
        // navigation, which this blocker would otherwise intercept — blocking
        // the save itself behind the Unsaved-changes dialog.
        !isSubmitting &&
        currentLocation.pathname !== nextLocation.pathname
    );

    return (
      <>
        <Button
          ref={setRefs}
          form={formId}
          type="submit"
          disabled={isDisabled || isSubmitting}
          isLoading={isSubmitting}
          isDisabled={isDisabled || isSubmitting || !isIdle}
          shortcut={shortcut === false ? undefined : shortcut}
          shortcutGuard={shortcutGuard}
          {...props}
        >
          {children}
        </Button>
        {blocker.state === "blocked" && (
          <Modal open onOpenChange={(open) => !open && blocker.reset()}>
            <ModalContent>
              <ModalHeader>
                <ModalTitle>
                  <Trans>Unsaved changes</Trans>
                </ModalTitle>
                <ModalDescription>
                  <Trans>Are you sure you want to leave this page?</Trans>
                </ModalDescription>
              </ModalHeader>
              <ModalFooter>
                <Button variant="secondary" onClick={() => blocker.reset()}>
                  <Trans>Stay on this page</Trans>
                </Button>
                <Button onClick={() => blocker.proceed()}>
                  <Trans>Leave this page</Trans>
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </>
    );
  }
);
Submit.displayName = "Submit";
export default Submit;
