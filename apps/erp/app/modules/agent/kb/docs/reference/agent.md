# In-app assistant

> A read-only chat assistant inside the ERP that answers questions about how Carbon works from the product documentation and points you to the right page.

The in-app assistant is a chat panel inside the ERP that answers "how do I / what is / where is" questions about Carbon. Open it from the **Question** button in the top bar, or press <kbd>⌘L</kbd>. Ask something like "how do I convert a sales order line to a job?" and it searches the product documentation, reads the relevant pages, and replies in plain language with a link to the source.

It is deliberately narrow. This first version is **read-only and documentation-only**: it explains features and workflows and can take you to a page, but it cannot read your live data and cannot change anything. Ask "how many open sales orders do I have?" and it will tell you it can't read your data yet, then open the sales orders page so you can see for yourself.

The assistant answers from the docs and can navigate you around the app. It does not create, edit, or delete anything, and it cannot see your customers, orders, parts, quantities, or statuses. If you ask it to make a change, it explains what you would do in the UI instead. Don't expect it to act on your behalf. The tooling for live-data lookups exists in the code but is gated off in this version.

This is distinct from the `docs/integrations/assistant`, which is a separate integration that surfaces Carbon in Slack. The in-app assistant lives only inside the ERP.

## What it can do

The assistant has a small, fixed set of abilities:

- **Answer from the docs.** It searches the same content that powers this documentation site and reads whole pages to answer your question, citing the page it used as a link.
- **Take you to a page.** Ask for "the jobs page" or "settings" and it can navigate you straight there. For a record page it needs a specific id, which it can only use if it found one in the docs. It never invents ids.
- **Offer links, buttons, and choices.** It can show a clickable link, a one-click suggested follow-up, or a short set of options to pick from when your question is ambiguous.

That is the whole surface. There is no "run this report", "update this field", or "post this document" — those are not abilities it has in this version.

## Where it appears

The assistant is available across the ERP. The **Question** button sits in the top bar and toggles a floating chat panel on the right; <kbd>⌘L</kbd> does the same from anywhere. When it is open, it knows which page or record you are currently viewing, so "how do I edit this?" resolves against the screen you are on and it can send you somewhere sensible.

The button and the panel only appear when your plan includes the assistant. On a plan without it, there is no trigger and no panel, so you never reach a dead end.

## Threads and messages

Each conversation is a **thread**, private to you within your company. Your threads are not visible to your teammates. Open the history from the panel to switch between past threads or start a new one, and delete any thread you no longer want.

Inside a thread, every exchange is stored as messages, and each message is broken into ordered parts: the text you see, plus a record of any documentation the assistant looked up along the way. A thread gets an automatic short title once it has a clear topic, so your history stays scannable. You can give a thumbs up or thumbs down on the assistant's latest answer, with an optional note, which helps improve it over time.

A long conversation is trimmed to its most recent messages before each reply, so the assistant answers from the recent context, not the entire history. Start a new thread when you switch topics for the cleanest results.

## Limits and availability

The assistant is a paid feature.

- **Plan.** It is available on the Business plan on Carbon Cloud. See `docs/platform/licensing` for how plans and editions work. Self-hosted deployments follow the licensing boundary rather than a runtime plan gate.
- **Beta.** The panel is labelled **Beta**: it is improving constantly, and an answer can be incomplete or wrong. Treat it as a fast way to find the right doc and the right page, not as the final word — the linked documentation is the source of truth.

## Troubleshooting

Exact strings from the assistant's request path and rate limiter.

### "Rate limit exceeded. Please wait a moment."
You sent more than 30 messages within 5 minutes (counted per person, per company). Wait a short while and send again. This is a throttle, not a plan limit, and it resets on its own.

### "Upgrade required"
The chat request returned a 402: your company's plan does not include the assistant (the `AI_AGENT` feature, granted on the Business plan on Carbon Cloud). Upgrade the plan to enable it. Normally the **Question** trigger and the panel are hidden on an ineligible plan, so you would not reach a send in the first place — seeing this means a send was attempted anyway.

### "Failed to create thread"
The assistant could not start a new conversation (a 500 while inserting the thread). Retry; if it persists, it is a server-side issue, not something you can fix from the UI.

### "I couldn't find that in the docs"
Not an error — the assistant searched the documentation and found nothing relevant to your question. Rephrase in different terms, or ask a broader "how do I / what is" version of the question. If it is a question about your own data (counts, statuses, a specific record), the assistant can't answer it in this version; open the relevant page to see the data directly.

### Why can't I see the assistant?
The **Question** button and the ⌘L panel only appear when your plan includes the assistant (the `AI_AGENT` feature). On a plan without it, both are hidden by design. Check your plan on Carbon Cloud, or see `docs/platform/licensing`.

### The assistant says it can't read my data
Expected. This version is read-only and documentation-only: it explains how Carbon works and navigates you to pages, but it has no access to your live customers, orders, parts, quantities, or statuses. For a data question, let it take you to the page where that data lives.
