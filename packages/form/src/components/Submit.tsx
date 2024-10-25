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

type SubmitProps = ButtonProps & { formId?: string; text?: string };

export const Submit = forwardRef<HTMLButtonElement, SubmitProps>(
  ({ formId, children, isDisabled, ...props }, ref) => {
    const isSubmitting = useIsSubmitting(formId);
    const transition = useNavigation();
    const isIdle = transition.state === "idle";
    const formState = useFormState(formId);
    const isTouched = Object.keys(formState.touchedFields).length > 0;

    const blocker = useBlocker(
      ({ currentLocation, nextLocation }) =>
        isTouched && currentLocation.pathname !== nextLocation.pathname
    );

    return (
      <>
        <Button
          ref={ref}
          form={formId}
          type="submit"
          disabled={isDisabled || isSubmitting}
          isLoading={isSubmitting}
          isDisabled={isDisabled || isSubmitting || !isIdle || !isTouched}
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
