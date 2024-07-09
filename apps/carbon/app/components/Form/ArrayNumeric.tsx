import type { InputProps } from "@carbon/react";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  VStack,
} from "@carbon/react";
import { useField, useFieldArray } from "@carbon/remix-validated-form";
import { forwardRef, useRef } from "react";
import { IoMdAdd, IoMdClose } from "react-icons/io";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

type FormArrayNumericProps = InputProps & {
  name: string;
  label?: string;
  isRequired?: boolean;
};

const ArrayNumeric = forwardRef<HTMLInputElement, FormArrayNumericProps>(
  ({ name, label, isRequired, ...rest }, ref) => {
    const listRef = useRef<HTMLDivElement>(null);
    const [items, { push, remove }, error] = useFieldArray<number>(name);
    const onAdd = () => {
      push(0);
      const lastInput =
        listRef.current?.lastElementChild?.querySelector("input");
      lastInput?.focus();
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={`${name}`}>{label}</FormLabel>}
        <VStack className="mb-4" ref={listRef}>
          {items.map((item, index) => (
            <ArrayNumericInput
              key={`${item}-${index}`}
              id={`${name}[${index}]`}
              name={`${name}[${index}]`}
              onRemove={() => remove(index)}
              {...rest}
            />
          ))}
          <Button variant="secondary" leftIcon={<IoMdAdd />} onClick={onAdd}>
            Add {label ?? "Option"}
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
};

const ArrayNumericInput = ({
  name,
  onRemove,
  ...rest
}: ArrayNumericInputProps) => {
  const { getInputProps, error } = useField(name);

  return (
    <FormControl isInvalid={!!error} isRequired>
      <HStack className="w-full content-between">
        <NumberField
          // @ts-ignore
          {...getInputProps({
            id: name,
            ...rest,
          })}
        >
          <NumberInputGroup className="relative">
            <NumberInput />

            <NumberInputStepper>
              <NumberIncrementStepper>
                <LuChevronUp size="1em" strokeWidth="3" />
              </NumberIncrementStepper>
              <NumberDecrementStepper>
                <LuChevronDown size="1em" strokeWidth="3" />
              </NumberDecrementStepper>
            </NumberInputStepper>
          </NumberInputGroup>
        </NumberField>
        <IconButton
          variant="ghost"
          aria-label="Remove item"
          icon={<IoMdClose />}
          onClick={onRemove}
        />
      </HStack>

      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

ArrayNumericInput.displayName = "ArrayNumericInput";

export default ArrayNumeric;
