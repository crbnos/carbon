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
  LabelWithHelp,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { forwardRef, useId, useRef } from "react";
import { flushSync } from "react-dom";
import { IoMdAdd, IoMdClose } from "react-icons/io";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useFieldArray } from "../internal/state/fieldArray";

type FormArrayNumericProps = InputProps & {
  name: string;
  label?: string;
  termId?: TermId;
  isRequired?: boolean;
  defaults?: number[];
};

const ArrayNumeric = forwardRef<HTMLInputElement, FormArrayNumericProps>(
  (
    {
      name,
      label,
      termId,
      isDisabled: isDisabledProp,
      isReadOnly: isReadOnlyProp,
      isRequired,
      defaults,
      ...rest
    },
    ref
  ) => {
    const { isOptional: fieldIsOptional } = useField(name);
    const formState = useFormStateContext();
    const { t } = useLingui();
    const labelId = useId();
    const itemLabel = label || t`Item`;
    const isDisabled = formState.isDisabled || isDisabledProp;
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const listRef = useRef<HTMLDivElement>(null);
    const [items, { push, remove }, error] = useFieldArray<number>(name);
    const resolvedIsOptional = isRequired ? false : (fieldIsOptional ?? false);

    const onAdd = () => {
      flushSync(() => {
        const next = defaults?.[items.length] ?? 0;
        push(next);
      });
      const lastInput = listRef.current?.querySelectorAll(
        "input[inputmode='numeric']"
      )?.[items.length] as HTMLInputElement | undefined;
      lastInput?.focus();
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel
            id={labelId}
            // The first entry's input; the list itself is named by the label.
            htmlFor={`${name}.0`}
            isOptional={resolvedIsOptional}
          >
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <VStack
          className="mb-4"
          ref={listRef}
          role="group"
          aria-labelledby={label ? labelId : undefined}
        >
          {items.map((item, index) => (
            <ArrayNumericInput
              key={item.key}
              id={`${name}.${index}`}
              name={`${name}.${index}`}
              aria-label={`${itemLabel} ${index + 1}`}
              removeLabel={t`Remove ${itemLabel} ${index + 1}`}
              onRemove={() => {
                flushSync(() => {
                  remove(index);
                });
              }}
              isDisabled={isDisabled}
              isReadOnly={isReadOnly}
              {...rest}
            />
          ))}
          <Button
            isDisabled={isDisabled || isReadOnly}
            variant="secondary"
            leftIcon={<IoMdAdd />}
            onClick={onAdd}
          >
            {label ? t`Add ${label}` : t`Add Option`}
          </Button>
        </VStack>
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

ArrayNumeric.displayName = "ArrayNumeric";

type ArrayNumericInputProps = InputProps & {
  name: string;
  onRemove: () => void;
  /** The remove button's name: "Remove Email 2". */
  removeLabel: string;
};

const ArrayNumericInput = ({
  name,
  onRemove,
  removeLabel,
  isDisabled,
  isReadOnly,
  ...rest
}: ArrayNumericInputProps) => {
  const { getInputProps, error } = useField(name);

  return (
    <FormControl isInvalid={!!error} isRequired>
      <HStack className="w-full content-between">
        <NumberField
          // @ts-expect-error
          {...getInputProps({
            id: name,
            ...rest
          })}
          isDisabled={isDisabled}
        >
          <NumberInputGroup className="relative">
            <NumberInput isReadOnly={isReadOnly} />

            {!isReadOnly && (
              <NumberInputStepper>
                <NumberIncrementStepper>
                  <LuChevronUp size="1em" strokeWidth="3" />
                </NumberIncrementStepper>
                <NumberDecrementStepper>
                  <LuChevronDown size="1em" strokeWidth="3" />
                </NumberDecrementStepper>
              </NumberInputStepper>
            )}
          </NumberInputGroup>
        </NumberField>
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
};

ArrayNumericInput.displayName = "ArrayNumericInput";

export default ArrayNumeric;
