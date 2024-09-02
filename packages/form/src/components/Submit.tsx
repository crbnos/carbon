import type { ButtonProps } from "@carbon/react";
import { Button } from "@carbon/react";
import { useNavigation } from "@remix-run/react";
import { forwardRef } from "react";
import { useIsSubmitting } from "../hooks";

type SubmitProps = ButtonProps & { formId?: string; text?: string };

export const Submit = forwardRef<HTMLButtonElement, SubmitProps>(
  ({ formId, children, isDisabled, ...props }, ref) => {
    const isSubmitting = useIsSubmitting(formId);
    const transition = useNavigation();
    const isIdle = transition.state === "idle";
    return (
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
    );
  }
);
Submit.displayName = "Submit";
export default Submit;
