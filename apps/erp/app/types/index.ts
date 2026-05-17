import type { ValidationErrorResponseData } from "@carbon/form";
import type { FileObject } from "@supabase/storage-js";
import type { ReactElement, ReactNode } from "react";
import type { IconType } from "react-icons";
import type { useSettings } from "~/hooks";

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

export type FormActionData = Promise<ValidationErrorResponseData | Result>;

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

export type UserContext = {
  locationId: string;
  companyId: string;
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

export type Route<T = {}> = T & {
  name: string;
  to: string;
  icon?: any;
  tag?: ReactNode;
  setting?: keyof ReturnType<typeof useSettings>;
  views?: {
    id: string;
    name: string;
    to: string;
    sortOrder: number;
  }[];
  q?: string; // TODO: this is dumb
  table?: string;
};

export type RouteGroup<T = {}> = {
  name: string;
  icon?: any;
  routes: (Route & T)[];
};

export interface SelectOption {
  label: string;
  value: string;
  helper?: string;
}

export type StorageItem = FileObject & {
  // Legacy UI naming: many callers still use `bucket` for a logical folder
  // such as `job` or `parts`, not the physical Supabase bucket name.
  bucket?: string;
  itemId?: string;
};
