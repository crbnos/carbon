import type { ValidationErrorResponseData } from "@carbon/form";
import type { FileObject } from "@supabase/storage-js";
import type { TypedResponse } from "@vercel/remix";
import type { ReactElement } from "react";
import type { IconType } from "react-icons";

export type Action = {
  label: string;
  icon: ReactElement;
  onClick: () => void;
};

export type Authenticated<T = {}> = T & {
  role?: Role;
  permission?: string;
  internal?: boolean;
};

export type AuthenticatedRouteGroup<T = {}> = T & {
  name: string;
  icon?: any;
  routes: Authenticated<Route & T>[];
};

export type FormActionData = Promise<
  TypedResponse<ValidationErrorResponseData> | TypedResponse<Result>
>;

export type ListItem = {
  id: string;
  name: string;
};

export type ModelUpload = {
  modelId: string | null;
  modelName: string | null;
  modelPath: string | null;
  modelSize: number | null;
  thumbnailPath: string | null;
};

export type NavItem = Omit<Route, "icon"> & {
  icon: IconType;
  backgroundColor?: string;
  foregroundColor?: string;
};

export type Result = {
  success: boolean;
  message?: string;
};

export type Role = "employee" | "customer" | "supplier";

export type Route = {
  name: string;
  to: string;
  icon?: any;
  views?: {
    id: string;
    name: string;
    to: string;
    sortOrder: number;
  }[];
  q?: string; // TODO: this is dumb
  table?: string;
};

export type RouteGroup = {
  name: string;
  icon?: any;
  routes: Route[];
};

export interface SelectOption {
  label: string;
  value: string;
  helper?: string;
}

export type StorageItem = FileObject & {
  bucket: string;
};
