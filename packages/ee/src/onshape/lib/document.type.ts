export enum OnshapeWVMType {
  WORKSPACE = "w",
  VERSION = "v",
  MICROVERSION = "m"
}

export interface OnshapeDocument {
  documentId: string;
  wvm: OnshapeWVMType;
  wvmId: string;
}
