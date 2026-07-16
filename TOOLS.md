# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## GitHub Webhook Relay

- **Flow:** GitHub → smee.io/BpvsE6x3kERztB6 → smee-client → smee-relay (:3141) → Gateway /hooks/wake
- **Services:** `smee-webhook.service` (SSE client), `smee-relay.service` (auth relay)
- **Relay code:** `~/.openclaw/smee-relay.mjs`
- **Hooks token:** in smee-relay.service `Environment=OPENCLAW_HOOKS_TOKEN=...`
- **Reliability:** RuntimeMaxSec=900 forces reconnection every 15 min; heartbeat polls `gh api` as fallback
- **Events:** push, pull_request, pull_request_review, issue_comment, issues
- **Restart:** `systemctl --user restart smee-webhook smee-relay`
- **Logs:** `journalctl --user -u smee-relay --lines 20` (shows event types + HTTP status)

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
