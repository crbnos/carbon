declare module "draco3dgltf" {
  const draco3dgltf: {
    createDecoderModule(): Promise<object>;
    createEncoderModule(): Promise<object>;
  };
  export default draco3dgltf;
}
