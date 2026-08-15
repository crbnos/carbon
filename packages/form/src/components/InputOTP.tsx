import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  InputOTP as InputOTPBase,
  InputOTPGroup,
  InputOTPSlot
} from "@carbon/react";
import type { ReactNode } from "react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import type { ValidationBehaviorOptions } from "../internal/getInputProps";

type FormInputOTPProps = {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  maxLength?: number;
  validationBehavior?: ValidationBehaviorOptions;
  onConfigure?: () => void;
};

const InputOTP = forwardRef<HTMLInputElement, FormInputOTPProps>(
  (
    {
      name,
      label,
      isConfigured,
      isOptional,
      isRequired,
      helperText,
      maxLength = 6,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const { error, isOptional: fieldIsOptional } = useField(name);
    const [value, setValue] = useControlField<string>(name);
    const formState = useFormStateContext();
    const isDisabled = formState.isDisabled || formState.isReadOnly;
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    useEffect(() => {
      if (value?.length !== maxLength) return;

      const form = document
        .querySelector(`input[name="${name}"]`)
        ?.closest("form");
      if (!form) return;

      // Prefer requestSubmit() over submit(): submit() bypasses the submit
      // event entirely, so React Router never intercepts it and a surrounding
      // ValidatedForm's fetcher never receives the result — any error the form
      // renders from `fetcher.data` would be unreachable.
      //
      // It must be passed a submitter, though. ValidatedForm's handleSubmit
      // early-returns unless `nativeEvent.submitter.form === the form`, so a
      // bare requestSubmit() (submitter === null) silently does nothing at all.
      const submitter = form.querySelector<HTMLElement>(
        'button[type="submit"], input[type="submit"]'
      );

      if (submitter) {
        form.requestSubmit(submitter as HTMLButtonElement);
      } else {
        // No submit button to act as submitter: fall back to the native POST.
        // Forms that auto-submit without one have always worked this way.
        form.submit();
      }
    }, [value, maxLength, name]);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label ? (
          <FormLabel
            htmlFor={name}
            isOptional={resolvedIsOptional}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            {label}
          </FormLabel>
        ) : null}

        <InputOTPBase
          name={name}
          maxLength={6}
          value={value}
          onChange={setValue}
          ref={ref}
          disabled={isDisabled}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTPBase>

        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

InputOTP.displayName = "InputOTP";

export default InputOTP;
