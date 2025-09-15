import * as OV from "online-3d-viewer";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "react-aria-components";
import * as THREE from "three";
import { useMount } from "./hooks";
import { IconButton } from "./IconButton";
import { Spinner } from "./Spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { cn } from "./utils/cn";

type UnitSystem = "metric" | "imperial";

const darkColor = "#9797a5";
const lightColor = "#8c8a8a";

export function ModelViewer({
  file,
  url,
  mode = "dark",
  color,
  className,
  withProperties = true,
  onDataUrl,
  resetZoomButton = true,
}: {
  file: File | null;
  url: string | null;
  mode?: "dark" | "light";
  color?: `#${string}`;
  withProperties?: boolean;
  onDataUrl?: (dataUrl: string) => void;
  resetZoomButton?: boolean;
  className?: string;
}) {
  const parentDiv = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OV.EmbeddedViewer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");
  const [modelInfo, setModelInfo] = useState<{
    surfaceArea: number;
    volume: number;
    dimensions: { x: number; y: number; z: number };
  } | null>(null);

  useMount(() => {
    if (file || url) {
      setIsLoading(true);

      if (viewerRef.current === null) {
        let viewer = new OV.EmbeddedViewer(parentDiv.current, {
          camera: new OV.Camera(
            new OV.Coord3D(100, 100, 100),
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
              updateColor(color ?? (isDarkMode ? darkColor : lightColor));

              viewer3D.Resize(
                parentDiv.current?.clientWidth,
                parentDiv.current?.clientHeight
              );

              const boundingSphere = viewer3D.GetBoundingSphere(() => true);
              if (boundingSphere) {
                const scene = viewer3D.scene;
                const center = boundingSphere.center;
                const radius = boundingSphere.radius;
                const camera = viewer3D.GetCamera();
                const direction = new OV.Coord3D(1, 1, 1);
                const eye = new OV.Coord3D(
                  center.x + direction.x * radius * 1.5,
                  center.y + direction.y * radius * 1.5,
                  center.z + direction.z * radius * 1.5
                );
                camera.center = center;
                camera.eye = eye;
                camera.up = new OV.Coord3D(0, 1, 0);
                viewer3D.SetCamera(camera);

                // Add ambient light for overall illumination
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
                scene.add(ambientLight);

                // Add directional lights for isometric highlights
                const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight1.position.set(1, 1, 1);
                scene.add(dirLight1);

                const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
                dirLight2.position.set(-1, 0.5, -1);
                scene.add(dirLight2);

                // Add subtle point light for depth
                const pointLight = new THREE.PointLight(0xffffff, 0.3);
                pointLight.position.set(0, radius * 2, 0);
                scene.add(pointLight);

                viewer3D.Render();
              }

              let model;
              if (withProperties) {
                model = viewer.GetModel();
              }

              if (model) {
                // Calculate model dimensions and properties
                const boundingBox = OV.GetBoundingBox(model);
                const surfaceArea = OV.CalculateSurfaceArea(model);
                const volume = OV.CalculateVolume(model);
                const dimensions = {
                  x: boundingBox.max.x - boundingBox.min.x,
                  y: boundingBox.max.y - boundingBox.min.y,
                  z: boundingBox.max.z - boundingBox.min.z,
                };

                setModelInfo({
                  surfaceArea,
                  volume,
                  dimensions,
                });
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

  function resetZoom() {
    if (!viewerRef.current) return;

    const viewer3D = viewerRef.current.GetViewer();
    viewer3D.Resize(
      parentDiv.current?.clientWidth,
      parentDiv.current?.clientHeight
    );

    const boundingSphere = viewer3D.GetBoundingSphere((meshUserData) => true);
    if (boundingSphere) {
      const center = boundingSphere.center;
      const radius = boundingSphere.radius;
      const camera = viewer3D.GetCamera();
      const direction = new OV.Coord3D(1, 1, 1);
      const eye = new OV.Coord3D(
        center.x + direction.x * radius * 1.5,
        center.y + direction.y * radius * 1.5,
        center.z + direction.z * radius * 1.5
      );
      camera.center = center;
      camera.eye = eye;
      camera.up = new OV.Coord3D(0, 1, 0);
      viewer3D.SetCamera(camera);
    }
  }

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

  function updateColor(color: string) {
    if (!viewerRef.current) return;

    const viewer3D = viewerRef.current.GetViewer();
    viewer3D.mainModel.EnumerateMeshes((mesh) => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => {
          if (material) {
            (material as THREE.MeshStandardMaterial).color.set(color);
          }
        });
      }
    });
  }

  useEffect(() => {
    if (color) {
      updateColor(color);
    }
  }, [color]);

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
          ? new OV.RGBAColor(21, 22, 25, 255)
          : new OV.RGBAColor(255, 255, 255, 255)
      );

      if (!color) {
        updateColor(isDarkMode ? darkColor : lightColor);
      }
    }
  }, [isDarkMode, color]);

  const { locale } = useLocale();

  // Conversion functions
  const mmToInches = (mm: number) => mm / 25.4;
  const mm2ToInches2 = (mm2: number) => mm2 / (25.4 * 25.4);
  const mm3ToInches3 = (mm3: number) => mm3 / (25.4 * 25.4 * 25.4);

  const formatter = useMemo(() => {
    const decimals = unitSystem === "imperial" ? 6 : 2;
    return new Intl.NumberFormat(locale, {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  }, [locale, unitSystem]);

  // Helper functions to get converted values
  const getDisplayValue = (
    value: number,
    type: "linear" | "area" | "volume"
  ) => {
    if (unitSystem === "imperial") {
      switch (type) {
        case "linear":
          return mmToInches(value);
        case "area":
          return mm2ToInches2(value);
        case "volume":
          return mm3ToInches3(value);
      }
    }
    return value;
  };

  const getUnit = (type: "linear" | "area" | "volume") => {
    if (unitSystem === "imperial") {
      switch (type) {
        case "linear":
          return "in";
        case "area":
          return "in²";
        case "volume":
          return "in³";
      }
    }
    switch (type) {
      case "linear":
        return "mm";
      case "area":
        return "mm²";
      case "volume":
        return "mm³";
    }
  };

  return (
    <>
      <div
        ref={parentDiv}
        role={"img"}
        aria-label="Canvas showing the model in the 3D Viewer"
        className={cn(
          "h-full w-full items-center justify-center rounded-lg border border-border bg-gradient-to-bl from-card from-50% via-card to-background min-h-[400px] shadow-md dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] relative",

          className
        )}
      >
        {isLoading ? (
          <div className="absolute inset-0 bg-card h-full w-full flex items-center justify-center">
            <Spinner className="w-10 h-10" />
          </div>
        ) : (
          <>
            <pre id="model-viewer-canvas" aria-hidden className="sr-only" />
            {resetZoomButton && (
              <IconButton
                aria-label="Reset zoom"
                className="absolute top-2 right-2"
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                    <rect width="10" height="8" x="7" y="8" rx="1" />
                  </svg>
                }
                variant="ghost"
                onClick={resetZoom}
              />
            )}
            {modelInfo && withProperties && (
              <>
                <div className="absolute top-2 left-2 text-xs z-10 text-foreground">
                  <Tabs defaultValue="dimensions" className="w-full gap-0">
                    <TabsList className="grid w-full grid-cols-2 mb-1">
                      <TabsTrigger className="text-xs" value="dimensions">
                        Dimensions
                      </TabsTrigger>
                      <TabsTrigger className="text-xs" value="properties">
                        Properties
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="properties">
                      <div className="flex flex-col gap-1 pt-1 p-2 items-start justify-start font-mono">
                        <div>
                          Surface Area:{" "}
                          {formatter.format(
                            getDisplayValue(modelInfo.surfaceArea, "area")
                          )}{" "}
                          {getUnit("area")}
                        </div>
                        <div>
                          Volume:{" "}
                          {formatter.format(
                            getDisplayValue(modelInfo.volume, "volume")
                          )}{" "}
                          {getUnit("volume")}
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="dimensions">
                      <div className="flex flex-col gap-1 pt-1 p-2 items-start justify-start font-mono">
                        <div className="flex items-center gap-1.5">
                          <div className="size-2 bg-green-500 rounded-full" />
                          W:{" "}
                          {formatter.format(
                            getDisplayValue(modelInfo.dimensions.x, "linear")
                          )}{" "}
                          {getUnit("linear")}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="size-2 bg-blue-500 rounded-full" />
                          H:{" "}
                          {formatter.format(
                            getDisplayValue(modelInfo.dimensions.y, "linear")
                          )}{" "}
                          {getUnit("linear")}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="size-2 bg-red-500 rounded-full" />
                          L:{" "}
                          {formatter.format(
                            getDisplayValue(modelInfo.dimensions.z, "linear")
                          )}{" "}
                          {getUnit("linear")}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
                <div className="absolute top-2 right-2 text-xs z-10 text-foreground">
                  <Tabs
                    value={unitSystem}
                    onValueChange={(value) =>
                      setUnitSystem(value as UnitSystem)
                    }
                    className="w-full gap-0"
                  >
                    <TabsList className="grid w-full grid-cols-2 mb-1">
                      <TabsTrigger className="text-xs" value="metric">
                        mm
                      </TabsTrigger>
                      <TabsTrigger className="text-xs" value="imperial">
                        in
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
