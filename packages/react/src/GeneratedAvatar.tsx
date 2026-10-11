// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { parseGeneratedAvatar } from "@carbon/utils";
import type { VariantProps } from "class-variance-authority";
import type { LoaderFunctionArgs } from "react-router";
import { avatarVariants } from "./Avatar";
import { cn } from "./utils/cn";
import {
  renderGeneratedAvatarSvg,
  useGeneratedAvatar
} from "./utils/generatedAvatar";
import { generatedAvatarClassName } from "./utils/generatedAvatarImage";

const log = getLogger("react", "generated-avatar-route");

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  // The same value always draws the same picture, and the URL carries
  // GENERATED_AVATAR_RENDER_VERSION, so a response never goes stale.
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  // Opened directly, an SVG is a document; it may draw, nothing else.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"
};

/**
 * The loader of each app's `/file/avatar/:value` route: renders a generated
 * avatar as an SVG on the server. Public by design: it reads no data, and a
 * value is only a style, a seed and a color. Each app's route file re-exports
 * it (`export { generatedAvatarLoader as loader } from "@carbon/react/GeneratedAvatar"`).
 */
export async function generatedAvatarLoader({ params }: LoaderFunctionArgs) {
  const value = params.value ?? "";
  if (!parseGeneratedAvatar(value)) {
    return new Response("Not a generated avatar", { status: 404 });
  }

  const svg = await renderGeneratedAvatarSvg(value);
  if (!svg) {
    log.error("Failed to render a generated avatar", { value });
    return new Response("The avatar could not be drawn", { status: 500 });
  }
  return new Response(svg, { headers: SVG_HEADERS });
}

type GeneratedAvatarPreviewProps = VariantProps<typeof avatarVariants> & {
  value: string;
  className?: string;
};

/**
 * A generated avatar drawn in the browser, for previews whose value changes
 * faster than it is worth fetching — the avatar picker, where a color drag or
 * a shuffle makes a new value per step. Everywhere else, `Avatar` loads the
 * server-drawn SVG instead.
 */
export function GeneratedAvatarPreview({
  value,
  size,
  className
}: GeneratedAvatarPreviewProps) {
  const parsed = parseGeneratedAvatar(value);
  const state = useGeneratedAvatar(parsed ? value : undefined);
  const classes = cn(
    avatarVariants({ size }),
    "border",
    parsed ? generatedAvatarClassName(parsed.style) : "bg-muted",
    className
  );

  if (state.status !== "ready") {
    return <span className={cn(classes, "bg-muted")} aria-hidden />;
  }
  return <img className={cn(classes, "object-cover")} alt="" src={state.src} />;
}
