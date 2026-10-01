// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Minimal type stubs for the Autodesk Forge Viewer global API. */
declare namespace Autodesk {
  namespace Viewing {
    class GuiViewer3D {
      constructor(container: HTMLElement, options?: Record<string, unknown>);
      start(): void;
      finish(): void;
      resize(): void;
      setTheme(theme: string): void;
      setLightPreset(preset: number): void;
      loadDocumentNode(doc: Document, node: unknown): Promise<void>;
      loadExtension(extensionId: string): Promise<unknown>;
      toolbar: { setVisible(visible: boolean): void };
      SetCamera(camera: unknown): void;
      GetCamera(): unknown;
      GetViewer(): unknown;
      SetBackgroundColor(color: unknown): void;
      Render(): void;
      GetBoundingSphere(
        filter: (meshUserData: unknown) => boolean
      ): { center: { x: number; y: number; z: number }; radius: number } | null;
      scene: unknown;
      mainModel: {
        EnumerateMeshes(callback: (mesh: unknown) => void): void;
      };
    }

    class Document {
      static load(
        urn: string,
        onSuccess: (doc: Document) => void,
        onFailure: (
          errorCode: number,
          errorMessage: string,
          errorDetails: unknown
        ) => void
      ): void;
      getRoot(): { getDefaultGeometry(): unknown };
    }

    function Initializer(
      options: Record<string, unknown>,
      callback: () => void
    ): void;

    function shutdown(): void;
  }
}
