// Client-safe: imported by browser code, so it must stay free of the react-pdf
// graph `./pdf` pulls in. Not a wildcard barrel — the per-document util files
// each export their own `getLineDescription`.
export { getPurchaseOrderDisplayId } from "./purchase-order";
export { getQuoteDisplayId } from "./quote";
export { withRevisionSuffix } from "./revision";
