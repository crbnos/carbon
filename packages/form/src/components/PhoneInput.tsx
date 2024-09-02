import type { InputProps } from "@carbon/react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@carbon/react";
import type {
  ElementRef,
  ForwardRefExoticComponent,
  InputHTMLAttributes,
} from "react";
import { forwardRef, useCallback } from "react";
import { RxCaretSort, RxCheck } from "react-icons/rx";
import * as ReactPhoneInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { useControlField, useField } from "../hooks";

const PhoneInputComponent = ReactPhoneInput.default;

type PhoneInputProps = InputProps & {
  name: string;
  label?: string;
  isRequired?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> &
  Omit<ReactPhoneInput.Props<typeof ReactPhoneInput.default>, "onChange"> & {
    onChange?: (value: ReactPhoneInput.Value) => void;
    value?: ReactPhoneInput.Value;
  };

const PhoneInput: ForwardRefExoticComponent<PhoneInputProps> = forwardRef<
  ElementRef<typeof ReactPhoneInput.default>,
  PhoneInputProps
>(({ name, label, isRequired, className, ...props }, ref) => {
  const { getInputProps, error } = useField(name);
  const [value, setValue] = useControlField<string>(name);

  const onChange = (value: string) => {
    setValue(value);
    // @ts-ignore
    props.onChange?.(value);
  };

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <PhoneInputComponent
        ref={ref}
        className={cn("flex", className)}
        flagComponent={FlagComponent}
        countrySelectComponent={CountrySelect}
        inputComponent={InputComponent}
        international
        {...getInputProps({
          id: name,
          ...props,
        })}
        value={value}
        /**
         * Handles the onChange event.
         *
         * react-phone-number-input might trigger the onChange event as undefined
         * when a valid phone number is not entered. To prevent this,
         * the value is coerced to an empty string.
         *
         * @param {E164Number | undefined} value - The entered value
         */
        // @ts-ignore
        onChange={onChange}
        {...props}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
});
PhoneInput.displayName = "PhoneInput";

const InputComponent = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <Input
      className={cn("rounded-s-none rounded-e-lg", className)}
      {...props}
      ref={ref}
    />
  )
);
InputComponent.displayName = "InputComponent";

type CountrySelectOption = { label: string; value: ReactPhoneInput.Country };

type CountrySelectProps = {
  disabled?: boolean;
  value: ReactPhoneInput.Country;
  onChange: (value: ReactPhoneInput.Country) => void;
  options: CountrySelectOption[];
};

const CountrySelect = ({
  disabled,
  value,
  onChange,
  options,
}: CountrySelectProps) => {
  const handleSelect = useCallback(
    (country: ReactPhoneInput.Country) => {
      onChange(country);
    },
    [onChange]
  );

  return (
    <Popover modal={true}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={"ghost"}
          className={cn(
            "py-1 border flex gap-1 h-full rounded-e-none rounded-s-lg pr-1 pl-3"
          )}
          disabled={disabled}
        >
          <FlagComponent country={value} countryName={value} />
          <RxCaretSort
            className={cn(
              "h-4 w-4 opacity-50",
              disabled ? "hidden" : "opacity-100"
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[300px]">
        <Command>
          <CommandList>
            <CommandInput placeholder="Search country..." />
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {options
                .filter((x) => x.value)
                .map((option) => (
                  <CommandItem
                    className="gap-2"
                    key={option.value}
                    onSelect={() => handleSelect(option.value)}
                  >
                    <FlagComponent
                      country={option.value}
                      countryName={option.label}
                    />
                    <span className="text-sm flex-1">{option.label}</span>
                    {option.value && (
                      <span className="text-sm text-foreground/50">
                        {`+${ReactPhoneInput.getCountryCallingCode(
                          option.value
                        )}`}
                      </span>
                    )}
                    <RxCheck
                      className={cn(
                        "ml-auto h-4 w-4",
                        option.value === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const FlagComponent = ({ country, countryName }: ReactPhoneInput.FlagProps) => {
  const Flag = flags[country];

  return (
    <span className="flex h-4 w-6 overflow-hidden rounded-sm bg-foreground/20">
      {Flag && <Flag title={countryName} />}
    </span>
  );
};
FlagComponent.displayName = "FlagComponent";

export default PhoneInput;
