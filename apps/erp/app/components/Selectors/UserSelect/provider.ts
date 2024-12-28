import { createContext, useContext } from "react";
import type useUserSelect from "./useUserSelect";

type ContextType = ReturnType<typeof useUserSelect>;

export const UserSelectContext = createContext<ContextType>({} as ContextType);

export default function useUserSelectContext() {
  const context = useContext(UserSelectContext);
  if (context === undefined) {
    throw new Error(
      "useUserSelectContext must be used within a UserSelectContext.Provider"
    );
  }
  return context;
}
