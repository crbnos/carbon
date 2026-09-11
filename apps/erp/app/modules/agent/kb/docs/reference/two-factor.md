# Two-factor authentication

> Add authenticator-app codes to sign-in, require them company-wide, and reset a lost device.

Two-factor authentication adds a second proof to sign-in: a six-digit code from an authenticator app on your phone, changing every thirty seconds. You can turn it on for yourself, and an admin can require it for everyone in a company. The two are related but not the same: **the requirement belongs to a company; the authenticator belongs to you.**

## Turn it on for yourself

Open **Account → Security** and press **"Add Authenticator App"**.

Scan the QR code with any TOTP app (Google Authenticator, 1Password, Authy), or tap the secret beneath it to copy and enter it by hand.

Type the current code into the six-box field and press **"Verify"**. Nothing is active until the code checks out — abandoning the dialog halfway leaves nothing behind.

Carbon emails you a receipt the moment it's on; if one arrives that you didn't cause, remove the factor and tell an admin. To remove it yourself, press the trash icon next to the factor and enter a current code.

Once verified, every sign-in asks for a code — magic link, Google, Outlook, and passkey alike. `docs/reference/single-sign-on` is the one exception: an SSO session arrives with your identity provider's MFA already enforced, so Carbon skips its own code screen.

## Require it for everyone

Open **Settings → System → Security** and turn on **Two-Factor Authentication Enforcement**. It takes effect on each person's next page load, and every active employee is emailed the announcement. Anyone without an authenticator then sees a full-screen **"Set up authenticator app"** prompt — they complete the same QR-and-code flow right there, or sign out; there is no way past it.

Once enforcement is on, **People → Employee accounts** shows a **Two-Factor** column reading **"Enabled"** or **"Not set up"** per person. The column only renders while the company requires two-factor.

If you belong to two companies and only one requires two-factor, you're prompted to enroll only while in that company — but once enrolled, you're asked for a code at **every** sign-in, to either company. In controlled (ITAR/CMMC) deployments two-factor is mandatory and the switch is locked on; SSO sessions stay exempt even there.

## When someone loses their phone

There are no printed backup codes — recovery is an admin action, which keeps it auditable. An admin with permission to update users opens **People → Employee accounts** and chooses **"Reset Two-Factor Auth"** from the person's row menu. Their next sign-in is an ordinary magic link, and they enroll a fresh device.

The authenticator is attached to the account, not the membership, so removing it removes it everywhere. Keep user-management permission on at least two people — if your only admin loses their phone, there is no self-service way back in.

## What it doesn't cover

Machine access is never challenged: `docs/building/api-keys` and integrations keep working, and shop-floor PIN operators are never prompted — they pin in at a shared terminal, so two-factor applies to whoever signed the terminal in. To restrict what an authenticated person can *reach*, that's `docs/reference/permissions`.

## Troubleshooting

Behavior details: a code is valid for its thirty-second window plus one window either side; repeated attempts are rate-limited on the sign-in budget. Sessions are re-checked on each request, so pre-existing sessions on other machines get the code screen on next use. The authenticator-app entry is labelled `Carbon (Company Name)` over the user's email — the company name is baked in at enrollment and doesn't update on rename. The enforcement announcement email goes out on each off → on transition only.

### "That code isn't right" on a code the user just read
Almost always clock drift on the phone — set the device to network time. Failing that, confirm they're reading the entry for the right company; two Carbon entries are distinguished by the company name in the label.

### Someone is stuck on the setup screen and can't get in
That's a company with enforcement on and a person without an authenticator. They complete setup on that screen and continue. If they can't (no phone to hand), the only other option is signing out.

### The Two-Factor column isn't in the employee list
The column only renders while the company requires two-factor. Turn the setting on in **Settings → System → Security** and it appears.

### Turning enforcement on didn't prompt anyone
It applies on each person's next page load, not retroactively to idle sessions. The announcement email is what reaches them in the meantime.

### Nobody got the announcement email
It's sent only when the setting transitions from off to on, and only to active employees. If it was already on (someone else flipped it, or the deployment is a controlled environment where it's locked on), there's no transition to announce.

### An admin can't turn enforcement off
The deployment is a controlled (ITAR) environment, where two-factor is mandatory and the switch is locked on.

### Passkey users are asked for a code — is that a bug?
No. A passkey resolves into an ordinary session like any other sign-in method, so exempting it would leave a way around the requirement. Only SSO sessions skip the challenge (the identity provider owns their MFA), in every environment including controlled ones.
