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
 * graphic — the last two via the `logo-resizer` edge function (ImageMagick).
 * Returns null when there's no logo block or no company logo. `supabaseUrl` is
 * passed in so this stays free of app-specific auth imports.
 */
export async function resolveLabelLogo(
  company: { logoLight?: string | null; logoLightIcon?: string | null } | null,
  template: DocumentTemplate | null,
  labelSize: LabelSize,
  { supabaseUrl }: { supabaseUrl: string }
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
    const blob = await imgRes.blob();
    const formData = new FormData();
    formData.append("file", blob, "logo.png");
    formData.append("widthDots", String(widthDots));
    if (crop) {
      // ZPL/mono can't clip at render — crop server-side before threshold.
      formData.append("cropX", String(crop.x));
      formData.append("cropY", String(crop.y));
      formData.append("cropW", String(crop.width));
      formData.append("cropH", String(crop.height));
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/logo-resizer`, {
      method: "POST",
      body: formData
    });
    const json = (await res.json()) as {
      monoPng?: string;
      gfa?: string;
      widthDots?: number;
    };
    return {
      color,
      mono: json.monoPng,
      gfa: json.gfa,
      widthDots: json.widthDots
    };
  } catch {
    // Edge function unavailable — color logo still works in the PDF.
    return { color };
  }
}
