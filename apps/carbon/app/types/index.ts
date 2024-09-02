import type { ValidationErrorResponseData } from "@carbon/form";
import type { TypedResponse } from "@remix-run/node";
import type { ReactElement } from "react";
import type { IconType } from "react-icons";

export type Action = {
  label: string;
  icon: ReactElement;
  onClick: () => void;
};

export type Authenticated<T> = T & {
  role?: Role;
  permission?: string;
};

export type AuthenticatedRouteGroup = {
  name: string;
  icon?: any;
  routes: Authenticated<Route>[];
};

export type FormActionData = Promise<
  TypedResponse<ValidationErrorResponseData> | TypedResponse<Result>
>;

export type ListItem = {
  id: string;
  name: string;
};

export type NavItem = Omit<Route, "icon"> & {
  icon: IconType;
  color?: string;
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
  q?: string; // TODO: this is dumb
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
