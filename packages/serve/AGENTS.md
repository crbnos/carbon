# @carbon/serve

The HTTP server a self-hosted ERP or MES runs on (`apps/*/server/node.ts`,
which is what `pnpm start` runs in the image). Fastify in front, React Router
behind. Vercel does not use it; it calls `apps/*/server/app.ts`.

It replaces `react-router-serve`, which loads the build itself and takes no
options, so nothing could be put between a request and React Router.

## Always

- **TypeScript that `node` can run as it is.** The image has no TypeScript
  toolchain; Node 22 strips the types. So only erasable syntax (no enums,
  no parameter properties), `import type` for types, and file extensions on
  relative imports. It must stay outside `node_modules`: Node refuses to
  strip types there, and `packages/` is copied into the image as it is.
- **The app's own URL is the allowed origin.** `serve({ siteUrl })` adds that
  host to React Router's `allowedActionOrigins` at runtime. React Router
  refuses a form submit whose `Origin` is not the origin of `request.url`, and
  behind a proxy that ends TLS the app is called over http while the browser
  says https — without this every submit is a 400. ERP passes `ERP_URL`, MES
  `MES_URL`. Unset, nothing is added.
- **Static files are sent as the build left them.** A build (see
  `precompressedAssets` in `@carbon/dev/vite`; every production build but
  Vercel's) writes a `.br` beside each asset and keeps the original. The
  `.br` goes as it is to anything that accepts Brotli; the original to a
  caller that does not. Both answers carry `Vary: Accept-Encoding`.
- **Files are read once, at start** (`src/assets.ts`). Every Brotli copy,
  and every uncompressed file up to 1 MB that has none, is held in memory
  with its headers already made; serving one is a lookup and a write.
  Read per request, each cost a stat, an open and a stream on libuv's four
  threads — the same four that compress rendered pages. Larger files, and
  the original of a compressed one for a caller that refuses Brotli, are
  sent from disk by `reply.sendFile`, which answers ranges. Nothing here
  may read a file while handling a request.
- **`/assets/*` and `/_vercel/*` are routes of their own.** A file or a
  plain 404, never a rendered page.
- **React Router is a route, not the not-found handler.** `@fastify/compress`
  attaches to routes only; from the not-found handler pages went out
  uncompressed.
- **Bodies are left unread.** The content-type parsers are removed so the
  request stream reaches React Router whole.
- **The request URL is joined as text**, never resolved against a base: a
  path of `//other.host/x` would name another host, and React Router checks
  a form's `Origin` against that URL. `@mjackson/node-fetch-server`
  resolves, which is why `src/request.ts` is ours.
- **Fastify's defaults are not all kept.** `keepAliveTimeout` is above any
  proxy's idle timeout, and `requestTimeout` is Node's 300s (Fastify sets
  none). `bodyLimit` does not apply: no body is parsed here. A request whose `Content-Type` is not a
  media type at all is a 415 from Fastify before React Router sees it.
- **What a library already answers is left to it.** `negotiator` reads
  `Accept-Encoding` (a `br;q=0` is a refusal), `@fastify/send` names a
  file's content type — the same code that sends the original, so both
  copies of an asset are called one thing — and `close-with-grace` shuts
  the server down: requests in flight finish, bounded at twenty seconds.
- Routes that should not go through React Router at all belong here, in front
  of the catch-all — not as a path check inside a route.

## Never

- Compress a client asset per request. That is what the build step replaced.
- Trust `X-Forwarded-*` to decide the origin. The deployment's configured URL
  is the answer; a header is whatever the last hop sent.
- Send the caller an error's message. It is logged; the answer is the status.

## Validation

```bash
pnpm --filter @carbon/serve test
pnpm --filter @carbon/serve typecheck
```
