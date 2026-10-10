# Account Settings Modal (ERP + MES)

Last tested: 2026-10-09
Route: any `/x` page (ERP and MES); deep link `?account=<profile|notifications|security>`

## Prerequisites
- Logged in via `/auth` (test@carbon.ms). The MES shares the cookie — open `MES_URL/x`, no second login.

## Steps
### 1. Open
- ERP: click the top-bar avatar button (accessible name = the user's full name, e.g. "Test Barbin") → menuitem "Account Settings".
- MES: the rail user button (same accessible name) → menuitem "Account Settings".
- Expected: `[role=dialog]` with heading "Account settings" (sr-only), nav "Account settings" with buttons Profile / Notifications / Security, and the Profile pane (email disabled, First/Last Name filled). The URL does not change.
### 2. Save profile
- Fill the About textarea (`textarea[name=about]`), then requestSubmit the dialog form whose submit button text starts with "Save" (NOT a click).
- Expected: toast "Updated profile" — poll the snapshot within ~1s, it disappears after a few seconds.
- Verify: `fetch('/api/account/profile')` (ERP) or `fetch('/x/proxy/api/account/profile')` (MES) → `user.about`.
### 3. Notifications
- Click the nav button "Notifications" inside the dialog. Topics table with switches named "<Topic> email".
- ERP shows a "Browser notifications" section; the MES must NOT.
- Click a switch; verify via `fetch('<api>/account/notifications')` → `preferences`. Toggle back afterwards.
### 4. Security
- Nav button "Security" → "Two-factor authentication" section ("Passkeys" only when the passkey provider is enabled).
- "Add Authenticator App" → nested modal "Set up two-factor authentication" with a QR image. Click Cancel — do not verify on the shared test user.
### 5. Deep links
- `ERP_URL/x/account/security` → redirects to `/x`, modal open on Security.
- `ERP_URL/x?account=notifications` → modal open on Notifications, param stripped from the URL.

## Selector Notes
- Switch panes with `[...document.querySelectorAll('[role=dialog] nav button')].find(b=>b.textContent.trim()==='Security').click()`.
- Escape closes the modal.

## Common Failures
- No toast seen after save: the snapshot was taken too late (toast auto-dismisses); confirm via the API fetch instead.
