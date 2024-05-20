export interface Column {
  id: string;
  title: string;
}

export interface ColumnDragData {
  type: "column";
  column: Column;
}

export type DraggableData = ColumnDragData | ItemDragData;

export interface Item {
  id: string;
  columnId: string;
  content: string;
}

export interface ItemDragData {
  type: "item";
  item: Item;
}
