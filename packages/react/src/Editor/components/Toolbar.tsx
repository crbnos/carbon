"use client";

import { lazy, Suspense, useState } from "react";
import { Separator } from "../../Separator";
import { cn } from "../../utils/cn";
import { ColorSelector } from "./ColorSelector";
import { LinkSelector } from "./LinkSelector";

const NodeSelector = lazy(() =>
  import("./NodeSelector").then((m) => ({ default: m.NodeSelector }))
);
const TextButtons = lazy(() =>
  import("./TextButton").then((m) => ({ default: m.TextButtons }))
);

/**
 * A persistent formatting toolbar for the full-screen `Editor` (procedures,
 * training, quality documents, …). It renders the SAME options exposed by the
 * floating bubble menu — the block/node selector, color, inline text styles,
 * and link — so it introduces no new capabilities, only a fixed surface for
 * them. Card-contained editors (notes) keep the bubble menu and omit this bar.
 */
export const Toolbar = ({ className }: { className?: string }) => {
  const [openNode, setOpenNode] = useState(false);
  const [openColor, setOpenColor] = useState(false);
  const [openLink, setOpenLink] = useState(false);

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex w-full flex-wrap items-center gap-1 border-b border-border bg-card p-2",
        className
      )}
    >
      <Suspense fallback={null}>
        <NodeSelector open={openNode} onOpenChange={setOpenNode} />
      </Suspense>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <ColorSelector open={openColor} onOpenChange={setOpenColor} />
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Suspense fallback={null}>
        <TextButtons />
      </Suspense>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <LinkSelector open={openLink} onOpenChange={setOpenLink} />
    </div>
  );
};
