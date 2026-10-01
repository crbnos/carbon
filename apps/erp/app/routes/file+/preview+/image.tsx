// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// this route exists so we can apply some styles to the preview iframe
const escapeAttribute = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export let loader = async ({ request }: LoaderFunctionArgs) => {
  await requirePermissions(request, {
    view: "documents"
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const file = decodeURIComponent(searchParams.get("file") ?? "");
  if (!file) throw new Error("file not found");

  const body = `
  <!DOCTYPE html>
    <html>
      <head>
        <style>
          html, body{
            height: 100%;
            width: 100%; 
            display: flex; 
            align-items: center; 
            justify-content: center;
          } 
          img { 
            max-width: 100%; 
            height: auto; 
          }
        </style>
      </head>
      <body>
        <img src="${escapeAttribute(path.to.file.previewFile(file))}" />
      </body>
    </html>`;
  // `file` is attacker-controlled (it comes from the link): escaped above, and
  // this page runs no script at all even if escaping is ever lost.
  const headers = new Headers({
    "Content-Type": "text/html",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff"
  });
  return new Response(body, { status: 200, headers });
};
