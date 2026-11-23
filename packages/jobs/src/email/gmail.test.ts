// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { gmailSendProps } from "./gmail-props";

// The prop names are the piece's contract (`@activepieces/piece-gmail`
// `gmail_send_email`); a renamed one is silently ignored by the piece.
describe("gmailSendProps", () => {
  it("maps a document email onto the piece's send props", () => {
    expect(
      gmailSendProps(
        {
          to: "buyer@customer.test",
          cc: ["ap@customer.test"],
          replyTo: "rep@acme.test, sales@acme.test",
          subject: "Quote Q-0001",
          html: "<p>Your quote</p>",
          text: "Your quote"
        },
        "Acme",
        [{ filename: "Q-0001.pdf", base64: "JVBERi0=" }]
      )
    ).toEqual({
      receiver: ["buyer@customer.test"],
      cc: ["ap@customer.test"],
      subject: "Quote Q-0001",
      body_type: "html",
      body: "<p>Your quote</p>",
      reply_to: ["rep@acme.test", "sales@acme.test"],
      sender_name: "Acme",
      attachments: [
        {
          file: { filename: "Q-0001.pdf", base64: "JVBERi0=", extension: "pdf" }
        }
      ],
      draft: false
    });
  });

  it("sends plain text when there is no html, and leaves unset fields out", () => {
    expect(
      gmailSendProps(
        { to: ["a@b.test"], subject: "Hi", text: "Hello" },
        "Acme",
        []
      )
    ).toEqual({
      receiver: ["a@b.test"],
      subject: "Hi",
      body_type: "plain_text",
      body: "Hello",
      sender_name: "Acme",
      attachments: [],
      draft: false
    });
  });
});
