// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { authEmailSettings, pushAuthEmails } from "./auth-emails";

const template = (file: string) =>
  `<html>${file} <a href="{{ .SiteURL }}/x?token={{ .TokenHash }}">{{ .Token }}</a></html>`;

function fakeFetch(answers: (url: string) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answers(url);
  }) as typeof fetch;
  return { impl, calls };
}

test("sends every template the ERP serves, with its subject, in one PATCH", async () => {
  const { impl, calls } = fakeFetch((url) =>
    url.startsWith("https://api.supabase.com")
      ? new Response("{}")
      : new Response(template(url.split("/").pop()!))
  );
  await pushAuthEmails("https://app.example.com/", "ref123", "tok", impl);

  const patch = calls.at(-1)!;
  assert.equal(patch.url, "https://api.supabase.com/v1/projects/ref123/config/auth");
  assert.equal(patch.init?.method, "PATCH");
  assert.equal((patch.init?.headers as Record<string, string>).Authorization, "Bearer tok");
  const body = JSON.parse(patch.init!.body as string);
  assert.equal(body.mailer_subjects_magic_link, "Your Carbon sign-in code");
  assert.match(body.mailer_templates_magic_link_content, /magic-link\.html/);
  assert.match(body.mailer_templates_email_change_content, /email-change\.html/);
  assert.equal(Object.keys(body).length, 10);
  assert.equal(calls[0]!.url, "https://app.example.com/templates/magic-link.html");
});

test("never stores a page that is not a template", async () => {
  const { impl, calls } = fakeFetch(() => new Response("<html>Sign in</html>"));
  await assert.rejects(authEmailSettings("https://app.example.com", impl, 0), /not an Auth template/);
  assert.ok(calls.every((c) => !c.url.startsWith("https://api.supabase.com")));
});

test("waits out a release that is not serving yet, then gives up", async () => {
  let n = 0;
  const { impl } = fakeFetch((url) =>
    ++n <= 2 ? new Response("", { status: 404 }) : new Response(template(url))
  );
  const settings = await authEmailSettings("https://app.example.com", impl, 0);
  assert.equal(Object.keys(settings).length, 10);

  const down = fakeFetch(() => new Response("", { status: 502 }));
  await assert.rejects(authEmailSettings("https://app.example.com", down.impl, 0), /answered 502/);
});
