import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMount } from "./hooks";
import { cn } from "./utils/cn";

export type AutodeskToken = {
  token: string;
  expiresAt: number;
};

interface AutodeskContextType {
  token: string | null;
  getToken: () => Promise<string>;
}

const AutodeskContext = createContext<AutodeskContextType | null>(null);

interface AutodeskProviderProps {
  children: React.ReactNode;
  tokenEndpoint: string;
}

function AutodeskProvider({ children, tokenEndpoint }: AutodeskProviderProps) {
  const [token, setToken] = useState<string | null>(null);

  useMount(() => {
    getToken().then(setToken);
  });

  const getToken = useCallback(async () => {
    try {
      const newToken = await getAccessToken(tokenEndpoint);
      setToken(newToken);
      return newToken;
    } catch (error) {
      console.error("Failed to refresh Autodesk token:", error);
      return null;
    }
  }, [tokenEndpoint]);

  return (
    <AutodeskContext.Provider value={{ token, getToken }}>
      {children}
    </AutodeskContext.Provider>
  );
}

function useAutodesk() {
  const context = useContext(AutodeskContext);
  if (!context) {
    throw new Error("useAutodesk must be used within an AutodeskProvider");
  }
  return context;
}

interface AutodeskViewerProps {
  className?: string;
  urn: string;
  registerExtensionsCallback?: (viewer: Autodesk.Viewing.GuiViewer3D) => void;
  loadAutodeskExtensions?: string[];
  loadCustomExtensions?: string[];
  customExtensionsCallbacks?: ((
    viewer: Autodesk.Viewing.GuiViewer3D
  ) => void)[];
  theme?: string;
  showDefaultToolbar?: boolean;
}

const AutodeskViewer: React.FC<AutodeskViewerProps> = ({
  urn,
  registerExtensionsCallback,
  loadAutodeskExtensions,
  loadCustomExtensions,
  theme,
  showDefaultToolbar,
  className,
}) => {
  const [viewer, setViewer] = useState<Autodesk.Viewing.GuiViewer3D | null>(
    null
  );
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const { token, getToken } = useAutodesk();

  useEffect(() => {
    if (
      !urn ||
      !token ||
      !viewerRef.current ||
      typeof Autodesk === "undefined"
    ) {
      return;
    }

    const options = {
      env: "AutodeskProduction",
      getAccessToken: (callback: (token: string, expires: number) => void) => {
        getToken().then((token) => {
          callback(token, 3600);
        });
      },
    };

    Autodesk.Viewing.Initializer(options, () => {
      const viewerOptions = {
        extensions: loadAutodeskExtensions || [
          "Autodesk.DocumentBrowser",
          "Autodesk.VisualClusters",
        ],
      };

      const viewer = new Autodesk.Viewing.GuiViewer3D(
        viewerRef.current!,
        viewerOptions
      );
      viewer.start();
      viewer.setTheme(theme || "light-theme");
      viewer.resize();

      const onDocumentLoadSuccess = async (doc: Autodesk.Viewing.Document) => {
        await viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry());

        const extensionPromises = (loadCustomExtensions || []).map(
          (extension) => viewer.loadExtension(extension)
        );
        await Promise.all(extensionPromises);

        viewer.toolbar.setVisible(showDefaultToolbar === true);
      };

      const onDocumentLoadFailure = (
        errorCode: number,
        errorMessage: string,
        errorDetails: any
      ) => {
        console.error({
          code: errorCode,
          message: errorMessage,
          errors: errorDetails,
        });
      };

      viewer.setLightPreset(0);

      if (registerExtensionsCallback) {
        registerExtensionsCallback(viewer);
      }

      setViewer(viewer);
      Autodesk.Viewing.Document.load(
        "urn:" + urn,
        onDocumentLoadSuccess,
        onDocumentLoadFailure
      );
    });

    return () => {
      if (viewer) {
        viewer.finish();
        setViewer(null);
        Autodesk.Viewing.shutdown();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    token,
    urn,
    // showDefaultToolbar,
    // theme,
    // getToken,
    // loadAutodeskExtensions,
    // registerExtensionsCallback,
    // loadCustomExtensions,
    // viewer,
  ]);

  return typeof Autodesk === "undefined" ? (
    <div>Please include viewer3D.min.js to the index.html </div>
  ) : (
    <div ref={viewerRef} className={cn("forge-viewer", className)}></div>
  );
};

export async function getAccessToken(endpoint: string): Promise<string> {
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error("Error getting Autodesk access token:", error);
    throw error;
  }
}

export { AutodeskProvider, AutodeskViewer, useAutodesk };
