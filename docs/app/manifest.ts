// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Carbon Docs",
    short_name: "Carbon",
    description:
      "Technical documentation for Carbon — a manufacturing system for the office (ERP) and the floor (MES).",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F5F5",
    theme_color: "#F5F5F5",
    icons: [
      { src: "/carbon-mark-light.svg", sizes: "any", type: "image/svg+xml" }
    ]
  };
}
