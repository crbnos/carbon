export type Configuration = {
  label: string;
  code?: string;
  returnType: ReturnType;
};

export type ConfiguratorDataType = "boolean" | "list" | "numeric" | "text";

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
  listOptions?: string[];
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
};
