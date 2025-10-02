# PDF Generation and QR Code Patterns

## Overview

The Carbon codebase uses React PDF for generating PDFs with asynchronous patterns for QR code generation and image preprocessing.

## PDF Components

### Core Components

- **PackingSlipPDF** (`carbon/packages/documents/src/pdf/PackingSlipPDF.tsx`)
- **ProductLabelPDF** (`carbon/packages/documents/src/pdf/ProductLabelPDF.tsx`)
- **JobTravelerPDF** (`carbon/packages/documents/src/pdf/JobTravelerPDF.tsx`)

## Async Patterns

### QR Code Generation

All QR code generation is asynchronous using the `bwip-js/node` library:

#### QR Code Utility (`carbon/packages/documents/src/qr/qr-code.ts`)

```typescript
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
```

#### In-Component QR/Barcode Generation

- **JobTravelerPDF**: Has its own `generateQRCode` function that creates QR codes for operation tracking URLs
- **PackingSlipPDF**: Has `generateBarcode` function for Code128 barcodes and uses imported `generateQRCode` for tracked entities
- **ProductLabelPDF**: Uses `await generateQRCode(item.trackedEntityId, qrCodeSize / 72)` directly in JSX

### Image Preprocessing

#### Thumbnail Processing

All PDF routes use async preprocessing for thumbnails via `getBase64ImageFromSupabase`:

```typescript
// From shared.service.ts
export async function getBase64ImageFromSupabase(
  client: SupabaseClient<Database>,
  path: string
) {
  const { data, error } = await client.storage.from("private").download(path);
  if (error) return null;

  const arrayBuffer = await data.arrayBuffer();
  const base64String = arrayBufferToBase64(arrayBuffer);

  const fileExtension = path.split(".").pop()?.toLowerCase();
  const mimeType =
    fileExtension === "jpg" || fileExtension === "jpeg"
      ? "image/jpeg"
      : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}
```

#### Thumbnail Batch Processing Pattern

Routes use `Promise.all` to process multiple thumbnails:

```typescript
const thumbnails: Record<string, string | null> =
  (thumbnailPaths
    ? await Promise.all(
        Object.entries(thumbnailPaths).map(([id, path]) => {
          if (!path) return null;
          return getBase64ImageFromSupabase(client, path).then((data) => ({
            id,
            data,
          }));
        })
      )
    : []
  )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
    if (thumbnail) acc[thumbnail.id] = thumbnail.data;
    return acc;
  }, {}) ?? {};
```

## Route-Level Async Patterns

### Data Fetching with Promise.all

All PDF routes use `Promise.all` for parallel data fetching:

```typescript
const [company, shipment, shipmentLines, terms] = await Promise.all([
  getCompany(client, companyId),
  getShipment(client, id),
  getShipmentLinesWithDetails(client, id),
  getSalesTerms(client, companyId),
]);
```

### PDF Streaming Pattern

All routes use the same streaming pattern:

```typescript
const stream = await renderToStream(<PDFComponent {...props} />);

const body: Buffer = await new Promise((resolve, reject) => {
  const buffers: Uint8Array[] = [];
  stream.on("data", (data) => buffers.push(data));
  stream.on("end", () => resolve(Buffer.concat(buffers)));
  stream.on("error", reject);
});

return new Response(body, {
  status: 200,
  headers: new Headers({ "Content-Type": "application/pdf" }),
});
```

## Key Insights

### Pre-processing Strategy

1. **Database queries**: All data fetched before PDF generation using `Promise.all`
2. **Images**: Converted to base64 data URLs before passing to PDF components
3. **QR codes**: Generated synchronously within PDF components during render
4. **Barcodes**: Generated asynchronously in helper functions

### Performance Optimizations

- Parallel data fetching with `Promise.all`
- Batch thumbnail processing
- Base64 image encoding done once per image
- QR codes generated on-demand during PDF render

### Error Handling

- Individual error checking for each Promise.all result
- Null checks for optional images/thumbnails
- Graceful degradation when images fail to load

The system efficiently pre-processes all external data (database queries, images) while generating codes (QR/barcodes) during the PDF render phase for optimal performance.
