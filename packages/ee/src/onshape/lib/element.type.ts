import type { OnshapeDocument } from "./document.type";

export interface OnshapeElement extends OnshapeDocument {
  elementId: string;
  linkDocumentId?: string;
  configuration?: string;
  partId?: string;
}

export enum OnshapeElementType {
  ASSEMBLY = "ASSEMBLY",
  PART_STUDIO = "PARTSTUDIO"
}
