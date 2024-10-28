import * as OV from "online-3d-viewer";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { useMount } from "./hooks";

export const supportedModelTypes = [
  "3dm",
  "3ds",
  "3mf",
  "amf",
  "bim",
  "brep",
  "dae",
  "fbx",
  "fcstd",
  "gltf",
  "ifc",
  "iges",
  "obj",
  "off",
  "ply",
  "step",
  "stl",
  "stp",
];

export function ModelViewer({
  file,
  url,
  mode = "dark",
}: {
  file: File | null;
  url: string | null;
  mode?: "dark" | "light";
}) {
  const parentDiv = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OV.EmbeddedViewer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useMount(() => {
    if (file || url) {
      setIsLoading(true);
      OV.Init3DViewerElements(console.log);
      if (viewerRef.current === null) {
        let viewer = new OV.EmbeddedViewer(parentDiv.current, {
          camera: new OV.Camera(
            new OV.Coord3D(0, 0, 100),
            new OV.Coord3D(0, 0, 0),
            new OV.Coord3D(0, 1, 0),
            45.0
          ),
          backgroundColor: isDarkMode
            ? new OV.RGBAColor(20, 22, 25, 0)
            : new OV.RGBAColor(255, 255, 255, 0),
          defaultColor: new OV.RGBColor(0, 125, 125),
          onModelLoaded: () => {
            if (viewerRef.current) {
              const viewer3D = viewerRef.current.GetViewer();
              viewer3D.Resize(
                parentDiv.current?.clientWidth,
                parentDiv.current?.clientHeight
              );

              const boundingSphere = viewer3D.GetBoundingSphere(
                (meshUserData) => true
              );
              if (boundingSphere) {
                const center = boundingSphere.center;
                const radius = boundingSphere.radius;
                const camera = viewer3D.GetCamera();
                const direction = new OV.Coord3D(0, 0, 1);
                const eye = new OV.Coord3D(
                  center.x + direction.x * radius * 2.5,
                  center.y + direction.y * radius * 2.5,
                  center.z + direction.z * radius * 2.5
                );
                camera.center = center;
                camera.eye = eye;
                camera.up = new OV.Coord3D(0, 1, 0);
                viewer3D.SetCamera(camera);
              }
            }

            setIsLoading(false);
          },
        });

        viewerRef.current = viewer;

        if (file) {
          loadFile(file);
        }
        if (url) {
          loadUrl(url);
        }
      }
    }

    return () => {
      if (viewerRef.current !== null && parentDiv.current !== null) {
        delete viewerRef.current.model;
        viewerRef.current.viewer.renderer.resetState();
        viewerRef.current.viewer.Clear();
        delete viewerRef.current.viewer;
        const gl = viewerRef.current.canvas.getContext("webgl2");
        gl.getExtension("WEBGL_lose_context").loseContext();
        const tempClone = viewerRef.current.canvas.cloneNode(true);
        viewerRef.current.canvas.parentNode.replaceChild(
          tempClone,
          viewerRef.current.canvas
        );
        parentDiv.current.removeChild(parentDiv.current?.children[0]!);
        viewerRef.current = null;
      }
    };
  });

  function loadFile(file: File) {
    if (!file) return;
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.LoadModelFromFileList([file]);
  }

  function loadUrl(url: string) {
    if (!url) return;
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.LoadModelFromUrlList([url]);
  }

  useEffect(() => {
    if (!file || !viewerRef.current) return;
    setIsLoading(true);
    loadFile(file);
  }, [file]);

  useEffect(() => {
    if (!url || file || !viewerRef.current) return;
    setIsLoading(true);
    loadUrl(url);
  }, [url, file]);

  const isDarkMode = mode === "dark";
  useEffect(() => {
    if (viewerRef.current) {
      const viewer3D = viewerRef.current.GetViewer();
      viewer3D.SetBackgroundColor(
        isDarkMode
          ? new OV.RGBAColor(20, 22, 25, 255)
          : new OV.RGBAColor(255, 255, 255, 255)
      );
    }
  }, [isDarkMode]);

  return (
    <>
      <div
        ref={parentDiv}
        role={"img"}
        aria-label="Canvas showing the model in the 3D Viewer"
        className="h-full w-full items-center justify-center rounded-lg relative border border-border dark:border-0 dark:shadow-[0px_1px_0px_0px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_rgba(0,0,0,.1),0px_2px_2px_0px_rgba(0,0,0,.1),0px_4px_4px_0px_rgba(0,0,0,.1),0px_8px_8px_0px_rgba(0,0,0,.1)] bg-red-500 min-h-[400px] shadow-md"
      >
        {isLoading ? (
          <div className="absolute inset-0 bg-card h-full w-full flex items-center justify-center">
            <Spinner className="w-10 h-10" />
          </div>
        ) : (
          <span
            id="model-viewer-canvas"
            className="w-[1px] h-[1px] bg-transparent"
          />
        )}
      </div>
    </>
  );
}
