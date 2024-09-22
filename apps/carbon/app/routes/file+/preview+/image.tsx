import { type LoaderFunctionArgs } from "@vercel/remix";
import { requirePermissions } from "~/services/auth/auth.server";
import { path } from "~/utils/path";

// this route exists so we can apply some styles to the preview iframe
export let loader = async ({ request }: LoaderFunctionArgs) => {
  await requirePermissions(request, {
    view: "documents",
  });
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const file = searchParams.get("file");
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
        <img src=${path.to.file.previewFile(file)} />
      </body>
    </html>`;
  const headers = new Headers({ "Content-Type": "text/html" });
  return new Response(body, { status: 200, headers });
};
