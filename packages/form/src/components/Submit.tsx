import { useFormState } from "@carbon/form";
import type { ButtonProps } from "@carbon/react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@carbon/react";
import { useBlocker, useNavigation } from "@remix-run/react";
import { forwardRef } from "react";
import { useIsSubmitting } from "../hooks";
import { useFormContext } from "../userFacingFormContext";

type SubmitProps = ButtonProps & {
  formId?: string;
  withBlocker?: boolean;
};

export function DefaultDisabledSubmit({
  children,
  formId,
  isDisabled,
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
  ({ formId, children, isDisabled, withBlocker = true, ...props }, ref) => {
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
                <ModalTitle>Unsaved changes</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <p>Are you sure you want to leave this page?</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={() => blocker.reset()}>
                  Stay on this page
                </Button>
                <Button onClick={() => blocker.proceed()}>
                  Leave this page
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
