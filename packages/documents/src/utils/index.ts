// Client-safe utilities. Deliberately NOT a wildcard barrel: the per-document
// util files each export their own `getLineDescription`, and this entry point is
// imported by browser code, so it must stay free of the react-pdf graph that
// `./pdf` pulls in.
export { getPurchaseOrderDisplayId } from "./purchase-order";
export { getQuoteDisplayId } from "./quote";
export { withRevisionSuffix } from "./revision";
