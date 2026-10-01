// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { FormState } from "./createFormStore";
import { useRootFormStore } from "./createFormStore";
import type { InternalFormId } from "./types";

export const useFormStore = <T>(
  formId: InternalFormId,
  selector: (state: FormState) => T
) => {
  return useRootFormStore((state) => selector(state.form(formId)));
};
