import { Input, useControlField, useField, useFormContext } from "@carbon/form";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInputTextField,
  CommandItem,
  CommandList,
  FormControl,
  FormErrorMessage,
  FormLabel,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGooglePlaces } from "~/hooks/useGooglePlaces";
import Country from "./Country";

type AddressAutocompleteProps = {
  variant?: "vertical" | "grid";
};

const AddressAutocomplete = ({
  variant = "vertical"
}: AddressAutocompleteProps) => {
  const { t } = useLingui();
  const address1Field = "addressLine1";

  const [value, setValue] = useControlField<string>(address1Field);
  const [, setCountryCode] = useControlField<string>("countryCode");
  const { clearError } = useFormContext();
  const { error, isOptional: isAddressLine1Optional } = useField(address1Field);
  const [open, setOpen] = useState(false);
  const [justSelected, setJustSelected] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const addressLine2Ref = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateProvinceRef = useRef<HTMLInputElement>(null);
  const postalCodeRef = useRef<HTMLInputElement>(null);

  const {
    suggestions,
    loading,
    getSuggestions,
    selectPlace,
    clearSuggestions
  } = useGooglePlaces();

  const handleInputChange = useCallback(
    (input: string) => {
      if (input && !justSelected && userInteracted) {
        getSuggestions(input);
        setOpen(true);
      } else {
        clearSuggestions();
        setOpen(false);
      }
    },
    [getSuggestions, clearSuggestions, justSelected, userInteracted]
  );

  const debouncedGetSuggestions = useDebounce(handleInputChange, 300);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (userInteracted) {
      debouncedGetSuggestions(value || "");
    }
  }, [value, userInteracted]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const handleSelect = useCallback(
    async (placeId: string) => {
      setOpen(false);
      clearSuggestions();
      setJustSelected(true);

      const address = await selectPlace(placeId);
      if (!address) return;

      setValue(address.addressLine1);

      // Populate remaining address fields via refs
      if (addressLine2Ref.current)
        addressLine2Ref.current.value = address.addressLine2;
      if (cityRef.current) cityRef.current.value = address.city;
      if (stateProvinceRef.current)
        stateProvinceRef.current.value = address.stateProvince;
      if (postalCodeRef.current)
        postalCodeRef.current.value = address.postalCode;
      setCountryCode(address.countryCode);

      clearError(
        address1Field,
        "addressLine2",
        "city",
        "stateProvince",
        "postalCode",
        "countryCode"
      );
    },
    [
      clearSuggestions,
      selectPlace,
      setValue,
      setCountryCode,
      clearError,
      address1Field
    ]
  );

  const handleInputFocus = useCallback(() => {
    setUserInteracted(true);
    if ((value || "").length >= 3 && !justSelected) {
      setOpen(true);
    }
  }, [value, justSelected]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      setUserInteracted(true);
      setJustSelected(false);
      setValue(newValue);
    },
    [setValue]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Tab") {
        setOpen(false);
      }
    },
    []
  );

  const addressAutocompleteField = (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor={address1Field} isOptional={isAddressLine1Optional}>
        <Trans>Address Line 1</Trans>
      </FormLabel>
      <div className="relative w-full" ref={containerRef}>
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInputTextField
            id={address1Field}
            name={address1Field}
            value={value || ""}
            onValueChange={handleValueChange}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            placeholder={t`e.g. 1 Industrial Way`}
            className="bg-transparent"
          />
          {open && suggestions.length > 0 && (
            <CommandList className="absolute w-full top-10 z-[9999] rounded-md border bg-popover text-popover-foreground shadow-md p-0">
              <CommandEmpty>
                {loading ? t`Loading...` : t`No addresses found`}
              </CommandEmpty>
              <CommandGroup>
                {suggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion.placeId}
                    value={suggestion.placeId}
                    className="cursor-pointer"
                    onSelect={() => handleSelect(suggestion.placeId)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(suggestion.placeId);
                    }}
                  >
                    {suggestion.text}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
      </div>
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );

  const addressLine2Field = (
    <Input
      ref={addressLine2Ref}
      name="addressLine2"
      label={t`Address Line 2`}
      placeholder={t`e.g. Suite 200`}
    />
  );

  const cityField = (
    <Input
      ref={cityRef}
      name="city"
      label={t`City`}
      placeholder={t`e.g. Detroit`}
    />
  );

  const stateProvinceField = (
    <Input
      ref={stateProvinceRef}
      name="stateProvince"
      label={t`State / Province`}
      placeholder={t`e.g. MI`}
    />
  );

  const postalCodeField = (
    <Input
      ref={postalCodeRef}
      name="postalCode"
      label={t`Postal Code`}
      placeholder={t`e.g. 48201`}
    />
  );

  const countryField = <Country name="countryCode" label={t`Country`} />;

  if (variant === "grid") {
    return (
      <>
        {addressAutocompleteField}
        {addressLine2Field}
        {cityField}
        {stateProvinceField}
        {postalCodeField}
        {countryField}
      </>
    );
  }

  // Default vertical layout
  return (
    <VStack spacing={4}>
      {addressAutocompleteField}
      {addressLine2Field}
      {cityField}
      {stateProvinceField}
      {postalCodeField}
      {countryField}
    </VStack>
  );
};

export default AddressAutocomplete;
