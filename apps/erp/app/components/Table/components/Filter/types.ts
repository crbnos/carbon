import type { ReactElement, ReactNode } from "react";

export type ColumnFilter = {
  accessorKey: string;
  header: string;
  pluralHeader?: string;
  filter: ColumnFilterData;
  icon?: ReactElement;
};

export type Option = {
  label: string | ReactNode;
  value: string;
  helperText?: string;
};

export type CustomFilterRenderContext = {
  values: string[];
  toggle: (value: string) => void;
  close: () => void;
};

export type ColumnFilterData =
  | {
      type: "static";
      options: Option[];
      isArray?: boolean;
      /** Radio semantics: applying an option replaces the previous one */
      isExclusive?: boolean;
    }
  | {
      type: "fetcher";
      endpoint: string;
      transform?: (result: any) => Option[];
      isArray?: boolean;
    }
  | {
      type: "custom";
      isArray?: boolean;
      render: (ctx: CustomFilterRenderContext) => ReactNode;
      getLabel?: (value: string) => ReactNode;
    };
