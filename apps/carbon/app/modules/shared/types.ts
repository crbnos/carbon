import type { methodItemType, methodType } from "./shared.models";
import type { getNotes } from "./shared.service";

export type BillOfMaterialNodeType =
  | "parent"
  | "line"
  | "assemblies"
  | "operations"
  | "materials"
  | "assembly"
  | "operation"
  | "material";

export type BillOfMaterialNode = {
  id: string;
  parentId?: string;
  label: string;
  type: BillOfMaterialNodeType;
  meta?: any;
  children?: BillOfMaterialNode[];
};

export enum DataType {
  Boolean = 1,
  Date = 2,
  List = 3,
  Numeric = 4,
  Text = 5,
  User = 6,
}

export type MethodItemType = (typeof methodItemType)[number];
export type MethodType = (typeof methodType)[number];

export type Note = NonNullable<
  Awaited<ReturnType<typeof getNotes>>["data"]
>[number];

export const standardFactorType = [
  "Hours/Piece",
  "Hours/100 Pieces",
  "Hours/1000 Pieces",
  "Minutes/Piece",
  "Minutes/100 Pieces",
  "Minutes/1000 Pieces",
  "Pieces/Hour",
  "Pieces/Minute",
  "Seconds/Piece",
  "Total Hours",
  "Total Minutes",
] as const;

export type StandardFactor = (typeof standardFactorType)[number];

export type QuantityEffect = (quantity: number) => number;
