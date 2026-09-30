/**
 * Do not barrel-export InspectionDocumentEditor: it depends on react-konva → Konva
 * Node build → `require("canvas")`, which breaks Vite SSR for any route that
 * only imports InspectionDocumentForm / InspectionDocumentTable from this file.
 * Import the editor only via direct path + lazy/ClientOnly (see balloon/$id).
 */
export { default as InspectionDocumentForm } from "./InspectionDocumentForm";
export { default as InspectionDocumentTable } from "./InspectionDocumentTable";
