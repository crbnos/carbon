// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Boolean,
  DatePicker,
  Input,
  Number,
  Select,
  useAdditionalValidatorsContext
} from "@carbon/form";
import { toSafeHref } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { useCustomFieldsSchema } from "~/hooks/useCustomFieldsSchema";
import { DataType } from "~/modules/shared";
import Customer from "./Customer";
import Employee from "./Employee";
import Supplier from "./Supplier";

type CustomFormFieldsProps = {
  table: string;
  tags?: string[];
};

const CustomFormFields = ({ table, tags = [] }: CustomFormFieldsProps) => {
  const { t } = useLingui();
  const customFormSchema = useCustomFieldsSchema();
  const tableFields = customFormSchema?.[table];
  const additionalValidatorCtx = useAdditionalValidatorsContext();
  const tagsKey = tags.join(",");

  const visibleFields = useMemo(() => {
    if (!tableFields) return [];
    return tableFields.filter((field) => {
      if (!field.tags || field.tags.length === 0) return true;
      return field.tags.some((tag) => tagsKey.split(",").includes(tag));
    });
  }, [tableFields, tagsKey]);

  const requiredFieldNames = useMemo(
    () =>
      visibleFields
        .filter(
          (field) => field.required && field.dataTypeId !== DataType.Boolean
        )
        .map((field) => getCustomFieldName(field.id)),
    [visibleFields]
  );

  const linkFieldNames = useMemo(
    () =>
      visibleFields
        .filter((field) => field.dataTypeId === DataType.Link)
        .map((field) => getCustomFieldName(field.id)),
    [visibleFields]
  );

  useEffect(() => {
    if (
      !additionalValidatorCtx ||
      (requiredFieldNames.length === 0 && linkFieldNames.length === 0)
    )
      return;

    const id = `custom-${table}`;
    additionalValidatorCtx.register(id, (formData) => {
      const errors: Record<string, string | undefined> = {};
      for (const name of requiredFieldNames) {
        const value = formData.get(name);
        if (!value || (typeof value === "string" && value.trim() === "")) {
          errors[name] = "Required";
        }
      }
      for (const name of linkFieldNames) {
        const value = formData.get(name);
        if (
          typeof value === "string" &&
          value.trim() !== "" &&
          toSafeHref(value) === null
        ) {
          errors[name] = t`Enter a web address, such as https://example.com`;
        }
      }
      return errors;
    });

    return () => additionalValidatorCtx.unregister(id);
  }, [requiredFieldNames, linkFieldNames, table, additionalValidatorCtx, t]);

  if (!tableFields) return null;

  return (
    <>
      {tableFields
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((field) => {
          if (
            !field.tags ||
            !Array.isArray(field.tags) ||
            field.tags.length === 0
          )
            return true;
          return field.tags.some((tag) => tags.includes(tag));
        })
        .map((field) => {
          const isRequired = field.required ?? false;
          switch (field.dataTypeId) {
            case DataType.Boolean:
              return (
                <Boolean
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                />
              );
            case DataType.Date:
              return (
                <DatePicker
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.List:
              return (
                <Select
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  placeholder={`Select ${field.name}`}
                  isRequired={isRequired}
                  options={
                    field.listOptions?.map((o) => ({
                      label: o,
                      value: o
                    })) ?? []
                  }
                />
              );
            case DataType.Numeric:
              return (
                <Number
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Text:
              return (
                <Input
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Link:
              return (
                <Input
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                  inputMode="url"
                  placeholder="https://"
                />
              );
            case DataType.User:
              return (
                <Employee
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Customer:
              return (
                <Customer
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Supplier:
              return (
                <Supplier
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            default:
              return null;
          }
        })}
    </>
  );
};

export default CustomFormFields;

function getCustomFieldName(id: string) {
  return `custom-${id}`;
}
