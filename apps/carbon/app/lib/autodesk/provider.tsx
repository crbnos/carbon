import { useMount } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { PropsWithChildren } from "react";
import { createContext, useCallback, useContext, useState } from "react";
import service, { AutodeskKeysEnum } from "./autodesk";
import type { AutodeskToken } from "./types";

const AutodeskContext = createContext<{ autodeskToken: string | null }>({
  autodeskToken: null,
});

export const AutodeskProvider = ({
  children,
  token,
}: PropsWithChildren<{
  token: AutodeskToken | null;
}>) => {
  const [autodeskToken, setAutodeskToken] = useState<string | null>(
    token?.token ?? null
  );

  const updateToken = useCallback((event: StorageEvent) => {
    const { key, newValue } = event;
    if (key === AutodeskKeysEnum.AUTODESK_TOKEN) {
      const newToken = JSON.parse(newValue ?? "null");
      if ("token" in newToken) {
        setAutodeskToken(newToken.token);
      } else {
        setAutodeskToken(null);
      }
    }
  }, []);

  useMount(() => {
    if (token)
      service.setAutodeskToken({
        token: token.token,
        expiresAt: token.expiresAt,
      });

    service.ensureToken();
    service.subscribe(updateToken);

    return () => {
      service.unsubscribe(updateToken);
    };
  });

  return (
    <AutodeskContext.Provider value={{ autodeskToken }}>
      {children}
    </AutodeskContext.Provider>
  );
};

export const useAutodeskToken = () => {
  const context = useContext(AutodeskContext);

  if (!isBrowser && context === undefined) {
    throw new Error("useAutodeskToken must be used within an AutodeskProvder.");
  }

  return context;
};
