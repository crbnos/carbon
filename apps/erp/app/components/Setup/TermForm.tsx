// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import type { ReactNode } from "react";
import { z } from "zod";

/** One field in its own form, so it validates and saves on its own. Keyed by
 *  its stored value: when a save changes it (or clears it, as a new bill-to
 *  clears the contact), the field shows what was stored. */
const TermForm = ({
  name,
  value,
  children
}: {
  name: string;
  value: unknown;
  children: ReactNode;
}) => (
  <ValidatedForm
    key={`${name}:${String(value ?? "")}`}
    defaultValues={{ [name]: value ?? "" }}
    validator={z.object({ [name]: z.any() })}
    className="w-full"
  >
    {children}
  </ValidatedForm>
);

export default TermForm;
