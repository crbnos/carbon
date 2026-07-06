import { View } from "@react-pdf/renderer";
import type { SpacerBlock as SpacerBlockType } from "../../template";

/**
 * Structural spacing block. Uses explicit style objects (not Tailwind arbitrary
 * values like `h-[1px]`, which react-pdf-tailwind can silently drop) so every
 * variant renders deterministically.
 */
export function SpacerBlock({ block }: { block: SpacerBlockType }) {
  switch (block.variant) {
    case "divider":
      return (
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: "#e5e7eb",
            borderBottomStyle: "solid",
            marginVertical: 12
          }}
        />
      );
    case "pageBreak":
      return <View break />;
    default:
      return <View style={{ height: block.size ?? 16 }} />;
  }
}
