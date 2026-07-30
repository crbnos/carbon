declare module "occt-import-js" {
  type OcctMesh = {
    name?: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  };
  type OcctResult = {
    success: boolean;
    root?: unknown;
    meshes: OcctMesh[];
  };
  type OcctModule = {
    ReadStepFile: (content: Uint8Array, params: unknown) => OcctResult;
    ReadIgesFile: (content: Uint8Array, params: unknown) => OcctResult;
    ReadBrepFile: (content: Uint8Array, params: unknown) => OcctResult;
  };
  const factory: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<OcctModule>;
  export default factory;
}
