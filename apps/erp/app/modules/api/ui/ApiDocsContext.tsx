import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";

type ApiDocsConfig = {
  apiUrl: string;
  apiKey: string;
  setApiUrl: (url: string) => void;
  setApiKey: (key: string) => void;
};

const ApiDocsContext = createContext<ApiDocsConfig | null>(null);

export function ApiDocsProvider({ children }: { children: React.ReactNode }) {
  const [apiUrl, setApiUrlState] = useState("");
  const [apiKey, setApiKeyState] = useState("");

  const setApiUrl = useCallback((url: string) => setApiUrlState(url), []);
  const setApiKey = useCallback((key: string) => setApiKeyState(key), []);

  const value = useMemo(
    () => ({ apiUrl, apiKey, setApiUrl, setApiKey }),
    [apiUrl, apiKey, setApiUrl, setApiKey]
  );

  return (
    <ApiDocsContext.Provider value={value}>{children}</ApiDocsContext.Provider>
  );
}

export function useApiDocsConfig() {
  const ctx = useContext(ApiDocsContext);
  if (!ctx) {
    throw new Error("useApiDocsConfig must be used within an ApiDocsProvider");
  }
  return ctx;
}
