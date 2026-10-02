// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import type { DocumentTemplate } from "../template";
import { resolveTemplate } from "../template";

export interface ResolvedLabelLogo {
  /** Color logo URL for the PDF. */
  color?: string | null;
  /** Monochrome PNG data URL (PDF B&W). */
  mono?: string | null;
  /** ZPL `^GFA` graphic field. */
  gfa?: string | null;
  /** Rendered logo width in dots (for ZPL placement). */
  widthDots?: number;
}

/**
 * If the tracking-label template has a visible logo block, resolve the company
 * logo into a color URL (PDF), a monochrome PNG (PDF B&W) and a ZPL `^GFA`
 * graphic — the last two via the shared image pipeline (`renderLabelLogo`).
 * Returns null when there's no logo block or no company logo.
 */
export async function resolveLabelLogo(
  company: { logoLight?: string | null; logoLightIcon?: string | null } | null,
  template: DocumentTemplate | null,
  labelSize: LabelSize
): Promise<ResolvedLabelLogo | null> {
  const resolved = resolveTemplate("trackingLabel", template);
  const logoBlock = resolved.blocks.find(
    (b) => b.type === "labelLogo" && b.visible
  );
  if (!logoBlock || logoBlock.type !== "labelLogo") return null;
  const { variant, crop } = logoBlock;
  const color =
    variant === "icon"
      ? (company?.logoLightIcon ?? company?.logoLight)
      : (company?.logoLight ?? company?.logoLightIcon);
  if (!color) return null;

  // Logo width ≈ 30% of the label, in printer dots.
  const dpi = labelSize.zpl?.dpi ?? 203;
  const labelInches = labelSize.zpl?.width ?? labelSize.width;
  const widthDots = Math.round(labelInches * dpi * 0.3);

  try {
    const imgRes = await fetch(color);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const { renderLabelLogo } = await import("@carbon/files/media/node");
    // ZPL/mono can't clip at render — crop before the threshold.
    // The company logo may be a JPEG or WebP, not only a PNG.
    const extension =
      imgRes.headers.get("content-type")?.split("/")[1]?.split(";")[0] ?? "png";
    const logo = await renderLabelLogo(bytes, extension, { widthDots, crop });
    return {
      color,
      mono: logo.monoPng,
      gfa: logo.gfa,
      widthDots: logo.widthDots
    };
  } catch {
    // Logo unreadable — color logo still works in the PDF.
    return { color };
  }
}
