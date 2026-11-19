// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  LabelWithHelp,
  useFormControl,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useRef } from "react";
import { flushSync } from "react-dom";
import { IoMdAdd, IoMdClose } from "react-icons/io";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useFieldArray } from "../internal/state/fieldArray";

type FormArrayProps = InputProps & {
  name: string;
  label?: string;
  termId?: TermId;
  isRequired?: boolean;
};

const Array = forwardRef<HTMLInputElement, FormArrayProps>(
  (
    {
      name,
      label,
      termId,
      isRequired,
      isDisabled: isDisabledProp,
      isReadOnly: isReadOnlyProp,
      ...rest
    },
    ref
  ) => {
    const { isOptional: fieldIsOptional } = useField(name);
    const listRef = useRef<HTMLDivElement>(null);
    const [items, { push, remove }, error] = useFieldArray<string>(name);
    const formState = useFormStateContext();
    const { t } = useLingui();
    const labelId = useId();
    const itemLabel = label || t`Item`;
    const isDisabled = formState.isDisabled || isDisabledProp;
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const resolvedIsOptional = isRequired ? false : (fieldIsOptional ?? false);
    const onAdd = () => {
      flushSync(() => {
        push("");
      });
      const lastInput = listRef.current?.querySelectorAll("input")?.[
        items.length
      ] as HTMLInputElement | undefined;
      lastInput?.focus();
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel
            id={labelId}
            // The first entry's input; the list itself is named by the label.
            htmlFor={`${name}[0]`}
            isOptional={resolvedIsOptional}
          >
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <EntryGroup
          className="mb-4"
          ref={listRef}
          aria-labelledby={label ? labelId : undefined}
        >
          {items.map((item, index) => (
            <ArrayInput
              key={`${item}-${index}`}
              id={`${name}[${index}]`}
              name={`${name}[${index}]`}
              ref={index === 0 ? ref : undefined}
              aria-label={`${itemLabel} ${index + 1}`}
              removeLabel={t`Remove ${itemLabel} ${index + 1}`}
              onRemove={() => remove(index)}
              isDisabled={isDisabled}
              isReadOnly={isReadOnly}
              {...rest}
            />
          ))}
          <Button
            variant="secondary"
            leftIcon={<IoMdAdd />}
            onClick={onAdd}
            isDisabled={isDisabled || isReadOnly}
          >
            {items.length > 0 ? t`Add another option` : t`Add option`}
          </Button>
        </EntryGroup>
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Array.displayName = "Array";

/**
 * The entries, as one group the label names. The label's glossary definition
 * and the field's error describe the group, not one of its inputs, so it reads
 * them from the FormControl it sits in.
 */
const EntryGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof VStack>
>((props, ref) => {
  const { ariaProps } = useFormControl(props);
  return (
    <VStack
      ref={ref}
      role="group"
      {...props}
      aria-describedby={ariaProps["aria-describedby"]}
    />
  );
});
EntryGroup.displayName = "EntryGroup";

type ArrayInputProps = InputProps & {
  name: string;
  onRemove: () => void;
  /** The remove button's name: "Remove Email 2". */
  removeLabel: string;
};

const ArrayInput = forwardRef<HTMLInputElement, ArrayInputProps>(
  ({ name, onRemove, removeLabel, isDisabled, isReadOnly, ...rest }, ref) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error} isRequired>
        <HStack className="w-full content-between">
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest
            })}
            isDisabled={isDisabled}
            isReadOnly={isReadOnly}
          />
          <IconButton
            variant="ghost"
            aria-label={removeLabel}
            icon={<IoMdClose />}
            onClick={onRemove}
            isDisabled={isDisabled || isReadOnly}
          />
        </HStack>

        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

ArrayInput.displayName = "ArrayInput";

export default Array;
