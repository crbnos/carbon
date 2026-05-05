import { createContext, useContext } from "react";

export type AdditionalValidateFunction = (
  data: FormData
) => Record<string, string | undefined>;

type ContextValue = {
  register: (id: string, fn: AdditionalValidateFunction) => void;
  unregister: (id: string) => void;
};

export const AdditionalValidatorsContext = createContext<ContextValue | null>(
  null
);

export function useAdditionalValidatorsContext() {
  return useContext(AdditionalValidatorsContext);
}
