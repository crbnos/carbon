export type Configuration = {
  label: string;
  code?: string;
  field: string;
  returnType: ReturnType;
  defaultValue?: string | number | boolean | string[] | null;
};

export type ConfiguratorDataType =
  | "boolean"
  | "list"
  | "numeric"
  | "text"
  | "enum"
  | "date";

export type BatchPropertyDataType = ConfiguratorDataType | "date";

export interface ListTypeConfig {
  options: string[];
}

export interface Parameter {
  config?: ListTypeConfig;
  name: string;
  type: ConfiguratorDataType;
  value: string;
}

export type ParameterInput = {
  dataType: ConfiguratorDataType;
  key: string;
  listOptions: string[] | null;
};

export type ReturnType = {
  helperText?: string;
  listOptions?: string[] | readonly string[];
  type: ConfiguratorDataType;
};

export type TypeMap = {
  [key in ConfiguratorDataType]: string;
};

export const typeMap: TypeMap = {
  boolean: "boolean",
  list: "string[]",
  numeric: "number",
  text: "string",
  enum: "string",
  date: "string",
};
