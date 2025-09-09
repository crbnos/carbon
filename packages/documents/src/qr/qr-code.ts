import bwipjs from "@bwip-js/node";

export async function generateQRCode(
  text: string,
  size: number
): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: "qrcode",
    text,
    scale: 2,
    height: size,
    width: size,
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function generateQRCodeBuffer(
  text: string,
  size: number
): Promise<Buffer> {
  const buffer = await bwipjs.toBuffer({
    bcid: "qrcode",
    text,
    scale: 2,
    height: size,
    width: size,
  });
  return buffer;
}

export function generateQRCodeSync(text: string, size: number): string {
  // bwipjs.toBuffer returns a Promise, but when called without await
  // in a synchronous context, we need to handle it differently
  // For now, keeping the existing async implementation
  throw new Error(
    "Synchronous QR code generation not supported. Use async version or inline implementation."
  );
}
