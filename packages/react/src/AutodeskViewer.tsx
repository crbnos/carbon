import React, { useEffect, useRef, useState } from "react";
import { cn } from "./utils/cn";

// Define Autodesk namespace and types
declare namespace Autodesk {
  namespace Viewing {
    class GuiViewer3D {
      constructor(container: HTMLElement, config?: object);
      start(): void;
      setTheme(theme: string): void;
      resize(): void;
      loadDocumentNode(doc: Document, node: any): Promise<void>;
      loadExtension(extension: string): Promise<void>;
      toolbar: { setVisible(visible: boolean): void };
      setLightPreset(preset: number): void;
      finish(): void;
    }
    class Document {
      static load(
        urn: string,
        onSuccess: (doc: Document) => void,
        onFailure: (errorCode: number, errorMsg: string, errors: any) => void
      ): void;
      getRoot(): { getDefaultGeometry(): any };
    }
    function Initializer(options: any, callback: () => void): void;
    function shutdown(): void;
  }
}

interface ForgeViewerProps {
  className?: string;
  urn: string;
  accessToken: string;
  registerExtensionsCallback?: (viewer: Autodesk.Viewing.GuiViewer3D) => void;
  loadAutodeskExtensions?: string[];
  loadCustomExtensions?: string[];
  customExtensionsCallbacks?: ((
    viewer: Autodesk.Viewing.GuiViewer3D
  ) => void)[];
  theme?: string;
  showDefaultToolbar?: boolean;
}

const AutodeskViewer: React.FC<ForgeViewerProps> = ({
  urn,
  accessToken,
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

  useEffect(() => {
    if (
      !urn ||
      !accessToken ||
      !viewerRef.current ||
      typeof Autodesk === "undefined"
    ) {
      return;
    }

    const options = {
      env: "AutodeskProduction",
      getAccessToken: (callback: (token: string, expires: number) => void) => {
        callback(accessToken, 3600);
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
  }, [urn, accessToken]);

  return typeof Autodesk === "undefined" ? (
    <div>Please include viewer3D.min.js to the index.html </div>
  ) : (
    <div ref={viewerRef} className={cn("forgeViewer", className)}></div>
  );
};

export { AutodeskViewer };
