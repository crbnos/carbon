// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext } from "react";
import type { FetcherWithComponents } from "react-router";
import type { z } from "zod";

export type InternalFormContextValue = {
  formId: string | symbol;
  action?: string;
  subaction?: string;
  defaultValuesProp?: { [fieldName: string]: any };
  fetcher?: FetcherWithComponents<unknown>;
  validatorSchema?: z.ZodTypeAny;
  /**
   * False until this form instance has registered its own state. A form with a
   * fixed `id` shares its store key with the instance it replaces (a keyed
   * remount for another record), and that one's state is still there on the
   * new instance's first render. Absent for a context built outside a form.
   */
  ownsState?: boolean;
};

export const InternalFormContext =
  createContext<InternalFormContextValue | null>(null);
