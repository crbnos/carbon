import { docs, guide } from "collections/server";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export const guideSource = loader({
  baseUrl: "/guides",
  source: guide.toFumadocsSource(),
});
