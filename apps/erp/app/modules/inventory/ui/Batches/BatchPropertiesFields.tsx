import {
  DatePicker,
  Input,
  Label,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { useEffect, useState } from "react";
import {
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuHash,
  LuList,
  LuText,
  LuToggleRight,
} from "react-icons/lu";
import type { BatchProperty } from "~/modules/inventory/types";

interface FormData {
  [key: string]: string | number | boolean;
}

interface PropertyFieldProps {
  property: BatchProperty;
  value: string | number | boolean;
  isReadOnly: boolean;
  onChange: (value: string | number | boolean) => void;
}

function PropertyField({
  property,
  value,
  isReadOnly,
  onChange,
}: PropertyFieldProps) {
  const [localTextValue, setLocalTextValue] = useState((value as string) || "");

  useEffect(() => {
    setLocalTextValue(value as string);
  }, [value]);

  switch (property.dataType) {
    case "numeric":
      return (
        <div className="space-y-2">
          <Label
            className="flex items-center gap-2 font-normal text-xs text-muted-foreground"
            htmlFor={property.id}
          >
            <LuHash />
            {property.label}
          </Label>
          <NumberField
            isDisabled={isReadOnly}
            onChange={(val) => onChange(Number(val))}
            value={value as number}
          >
            <NumberInputGroup className="relative">
              <NumberInput id={property.id} />
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
        </div>
      );

    case "text":
      return (
        <div className="space-y-2">
          <Label
            className="flex items-center gap-2 font-normal text-xs text-muted-foreground"
            htmlFor={property.id}
          >
            <LuText />
            {property.label}
          </Label>
          <Input
            id={property.id}
            type="text"
            isDisabled={isReadOnly}
            value={localTextValue}
            onChange={(e) => setLocalTextValue(e.target.value)}
            onBlur={() => onChange(localTextValue)}
            className="w-full"
          />
        </div>
      );

    case "list":
      return (
        <div className="space-y-2">
          <Label
            className="flex items-center gap-2 font-normal text-xs text-muted-foreground"
            htmlFor={property.id}
          >
            <LuList />
            {property.label}
          </Label>
          <Select
            disabled={isReadOnly}
            value={value as string}
            onValueChange={(val) => onChange(val)}
          >
            <SelectTrigger id={property.id}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {property.listOptions?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case "boolean":
      return (
        <div className="flex flex-col items-start gap-2">
          <Label
            className="flex items-center gap-2 font-normal text-xs text-muted-foreground"
            htmlFor={property.id}
          >
            <LuToggleRight />
            {property.label}
          </Label>
          <Switch
            id={property.id}
            disabled={isReadOnly}
            checked={(value as boolean) || false}
            onCheckedChange={(val) => onChange(val)}
            className="mt-1"
          />
        </div>
      );

    case "date":
      return (
        <div className="space-y-2">
          <Label
            className="flex items-center gap-2 font-normal text-xs text-muted-foreground"
            htmlFor={property.id}
          >
            <LuCalendar />
            {property.label}
          </Label>
          <DatePicker
            isDisabled={isReadOnly}
            value={value ? parseDate(value as string) : undefined}
            onChange={(val) => onChange(val?.toString() ?? "")}
          />
        </div>
      );

    default:
      return null;
  }
}

interface BatchPropertiesFieldsProps {
  itemId: string;
  properties: BatchProperty[];
  values: FormData;
  isReadOnly?: boolean;
  onChange: (values: FormData) => void;
}

export function BatchPropertiesFields({
  properties,
  values,
  isReadOnly = false,
  onChange,
}: BatchPropertiesFieldsProps) {
  return properties.map((property) => (
    <PropertyField
      key={property.id}
      property={property}
      value={values[property.id] ?? getDefaultValue(property.dataType)}
      isReadOnly={isReadOnly}
      onChange={(value) => {
        onChange({
          ...values,
          [property.id]: value,
        });
      }}
    />
  ));
}

function getDefaultValue(dataType: string) {
  switch (dataType) {
    case "boolean":
      return false;
    case "numeric":
      return 0;
    default:
      return "";
  }
}
