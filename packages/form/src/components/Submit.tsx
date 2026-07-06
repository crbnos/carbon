import { useFormState } from "@carbon/form";
import type { ButtonProps } from "@carbon/react";
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { forwardRef } from "react";
import { useBlocker, useNavigation } from "react-router";
import { useIsSubmitting } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useFormContext } from "../userFacingFormContext";

type SubmitProps = ButtonProps & {
  formId?: string;
  withBlocker?: boolean;
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

    const blocker = useBlocker(
      ({ currentLocation, nextLocation }) =>
        withBlocker &&
        isTouched &&
        currentLocation.pathname !== nextLocation.pathname
    );

    return (
      <>
        <Button
          ref={ref}
          form={formId}
          type="submit"
          disabled={isDisabled || isSubmitting}
          isLoading={isSubmitting}
          isDisabled={isDisabled || isSubmitting || !isIdle}
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
