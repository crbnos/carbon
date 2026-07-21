import { atom } from "nanostores";

// Cross-subtree open-state for the Change Order release dialog. The header
// "Release" button and the rail's Release section live in separate React
// subtrees under the $id route, so neither can pass the other a callback; both
// toggle this atom instead. The dialog itself is rendered once (in the rail).
export const releaseDialogOpenAtom = atom(false);
