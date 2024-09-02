import type { FormState } from "./createFormStore";
import { useRootFormStore } from "./createFormStore";
import type { InternalFormId } from "./types";

export const useFormStore = <T>(
  formId: InternalFormId,
  selector: (state: FormState) => T
) => {
  return useRootFormStore((state) => selector(state.form(formId)));
};
