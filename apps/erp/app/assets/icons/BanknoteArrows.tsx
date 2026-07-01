import { GenIcon } from "react-icons/lib";

// Lucide `banknote-arrow-up` / `banknote-arrow-down` (ISC license). These icons
// exist in Lucide but are not yet shipped in react-icons@5.6.0 — the latest
// published release — so there is no react-icons version to upgrade to that
// exposes them as `LuBanknoteArrowUp` / `LuBanknoteArrowDown`. We render them via
// react-icons' own `GenIcon` so they are drop-in identical to the other `Lu*`
// icons (1em sizing, currentColor stroke, className, IconContext). When a future
// react-icons release adds them, swap these for the `Lu*` imports and delete this
// file. Path data copied verbatim from lucide-react@1.20.0.

const lucideSvgAttr = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24"
};

export const BanknoteArrowUp = GenIcon({
  tag: "svg",
  attr: lucideSvgAttr,
  child: [
    {
      tag: "path",
      attr: { d: "M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" },
      child: []
    },
    { tag: "path", attr: { d: "M18 12h.01" }, child: [] },
    { tag: "path", attr: { d: "M19 22v-6" }, child: [] },
    { tag: "path", attr: { d: "m22 19-3-3-3 3" }, child: [] },
    { tag: "path", attr: { d: "M6 12h.01" }, child: [] },
    { tag: "circle", attr: { cx: "12", cy: "12", r: "2" }, child: [] }
  ]
});

export const BanknoteArrowDown = GenIcon({
  tag: "svg",
  attr: lucideSvgAttr,
  child: [
    {
      tag: "path",
      attr: { d: "M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5" },
      child: []
    },
    { tag: "path", attr: { d: "m16 19 3 3 3-3" }, child: [] },
    { tag: "path", attr: { d: "M18 12h.01" }, child: [] },
    { tag: "path", attr: { d: "M19 16v6" }, child: [] },
    { tag: "path", attr: { d: "M6 12h.01" }, child: [] },
    { tag: "circle", attr: { cx: "12", cy: "12", r: "2" }, child: [] }
  ]
});
