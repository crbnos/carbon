import type { FetcherWithComponents } from "@remix-run/react";
import { createContext } from "react";

export type InternalFormContextValue = {
  formId: string | symbol;
  action?: string;
  subaction?: string;
  defaultValuesProp?: { [fieldName: string]: any };
  fetcher?: FetcherWithComponents<unknown>;
};

export const InternalFormContext =
  createContext<InternalFormContextValue | null>(null);
