// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, HStack, IconButton } from "@carbon/react";
import { round } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { Dispatch, SetStateAction } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuMaximize,
  LuMinus,
  LuPlus,
  LuRectangleHorizontal,
  LuScan
} from "react-icons/lu";

type DrawingToolbarProps = {
  canUpdate: boolean;
  /** The drawing has rendered and can take a selector or zoom box. */
  isOverlayReady: boolean;
  placing: boolean;
  onTogglePlacing: () => void;
  zoomBoxMode: boolean;
  onToggleZoomBox: () => void;
  pdfViewPage: number;
  setPdfViewPage: Dispatch<SetStateAction<number>>;
  documentPageCount: number;
  zoomScale: number;
  setZoomScale: Dispatch<SetStateAction<number>>;
  onResetView: () => void;
};

/** Add Selector, the page pager and the zoom controls above the drawing. */
export default function DrawingToolbar({
  canUpdate,
  isOverlayReady,
  placing,
  onTogglePlacing,
  zoomBoxMode,
  onToggleZoomBox,
  pdfViewPage,
  setPdfViewPage,
  documentPageCount,
  zoomScale,
  setZoomScale,
  onResetView
}: DrawingToolbarProps) {
  const { t } = useLingui();
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-card px-2 py-1.5">
      <div className="flex items-center">
        {canUpdate && (
          <Button
            size="sm"
            variant={placing ? "primary" : "secondary"}
            leftIcon={<LuRectangleHorizontal />}
            onClick={onTogglePlacing}
            isDisabled={!isOverlayReady}
          >
            {placing ? t`Drag to place on drawing` : t`Add Selector`}
          </Button>
        )}
      </div>
      {documentPageCount > 1 ? (
        <nav aria-label={t`PDF pages`} className="flex items-center gap-2">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t`Previous page`}
            icon={<LuChevronLeft className="h-4 w-4" />}
            isDisabled={pdfViewPage <= 1}
            onClick={() => setPdfViewPage((p) => Math.max(1, p - 1))}
          />
          <span className="min-w-[8.5rem] select-none text-center text-sm font-medium tabular-nums text-foreground">
            {t`Page ${pdfViewPage} of ${documentPageCount}`}
          </span>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t`Next page`}
            icon={<LuChevronRight className="h-4 w-4" />}
            isDisabled={pdfViewPage >= documentPageCount}
            onClick={() =>
              setPdfViewPage((p) => Math.min(documentPageCount, p + 1))
            }
          />
        </nav>
      ) : (
        <span />
      )}
      <div className="flex items-center justify-end">
        <HStack
          spacing={0}
          className="rounded-md border bg-background px-0.5 py-0.5"
        >
          <IconButton
            type="button"
            variant={zoomBoxMode ? "active" : "ghost"}
            size="sm"
            aria-label={zoomBoxMode ? t`Drag to zoom` : t`Zoom Box`}
            icon={<LuScan />}
            isDisabled={!isOverlayReady}
            onClick={onToggleZoomBox}
          />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t`Zoom out`}
            icon={<LuMinus />}
            onClick={() =>
              setZoomScale((z) => Math.max(0.5, round(z - 0.1, 2)))
            }
          />
          <span className="min-w-14 select-none text-center text-sm font-medium tabular-nums">
            {round(zoomScale * 100, 0)}%
          </span>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t`Zoom in`}
            icon={<LuPlus />}
            onClick={() => setZoomScale((z) => Math.min(3, round(z + 0.1, 2)))}
          />
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t`Reset view`}
            icon={<LuMaximize />}
            onClick={onResetView}
          />
        </HStack>
      </div>
    </div>
  );
}
