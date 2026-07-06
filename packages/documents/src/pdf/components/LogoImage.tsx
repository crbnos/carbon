import { Image, View } from "@react-pdf/renderer";
import type { LogoCrop } from "../../template";

/**
 * Renders a logo at a fixed height, optionally cropped. With a crop, it draws a
 * clip box sized to the crop's stored pixel aspect and blows the image up so the
 * cropped region fills it — `overflow: hidden` clips the rest. No intrinsic
 * image dimensions are needed at render time. Shared by the document header and
 * the tracking-label logo block so both crop identically.
 */
export function LogoImage({
  src,
  height,
  crop,
  marginRight
}: {
  src: string;
  height: number;
  crop?: LogoCrop;
  marginRight?: number;
}) {
  if (!crop) {
    return (
      <Image
        src={src}
        style={{ height, width: "auto", objectFit: "contain", marginRight }}
      />
    );
  }
  const boxH = height;
  const boxW = height * crop.aspect;
  return (
    <View
      style={{
        width: boxW,
        height: boxH,
        overflow: "hidden",
        position: "relative",
        marginRight
      }}
    >
      <Image
        src={src}
        style={{
          position: "absolute",
          width: boxW / crop.width,
          height: boxH / crop.height,
          left: -(crop.x / crop.width) * boxW,
          top: -(crop.y / crop.height) * boxH
        }}
      />
    </View>
  );
}
