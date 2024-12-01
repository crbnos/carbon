import type { QueryClient } from "@tanstack/react-query";

declare global {
  interface Window {
    clientCache: QueryClient;
  }
}

export {};
