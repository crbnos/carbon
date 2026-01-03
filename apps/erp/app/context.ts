import { createContext } from "react-router";
import type { UserContext } from "~/types";

export const userContext = createContext<UserContext | null>(null);
