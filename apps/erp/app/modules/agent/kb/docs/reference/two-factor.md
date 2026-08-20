# Two-factor authentication

> How authenticator-app codes work in Carbon, from setting one up to requiring them company-wide, and what happens when someone loses their phone.

A password isn't the thing standing between an attacker and your production data — Carbon doesn't use one. You sign in with a magic link, an OAuth provider, or a passkey, and each of those comes down to something in your inbox or on your device. Two-factor authentication adds a second, independent proof: a six-digit code from an authenticator app on your phone, changing every thirty seconds.

You can turn it on for yourself from your own account. An admin can also require it for everyone in a company, which is the setting most organizations actually want. The two are related but not the same thing, and the difference matters: **the requirement belongs to a company, but the authenticator belongs to you**.

## Turning it on for yourself

Open **Account → Security**. It sits alongside your passkeys, because both answer the same question — how you prove it's you.

Press **"Add Authenticator App"**. Carbon shows a QR code and, beneath it, the same secret in text. Scan the QR with Google Authenticator, 1Password, Authy, or any TOTP app; if a camera isn't practical, tap the secret to copy it and enter it by hand. Your app immediately starts producing codes. Type the current one into the six-box field and press **"Verify"**.

Nothing is active until that code checks out. Until then the factor is `unverified` and Carbon ignores it entirely, which is why abandoning the dialog halfway leaves nothing behind.

The entry is labelled with the company you were in when you enrolled, over your email — `Carbon (Acme Manufacturing)` above `you@acme.com`. That's deliberate. If you use Carbon at more than one organization, two entries both reading "Carbon" would be indistinguishable at the moment you need to tell them apart.

The label is written into the QR when you enrol. Renaming the company later doesn't rewrite anyone's existing entry.

To remove it, press the trash icon next to the factor and enter a current code. Carbon asks for the code rather than just a confirmation click because removing your second factor is exactly the action an attacker who has your session would want to perform.

## Signing in with a code

Once you have a verified authenticator, every sign-in asks for a code — magic link, Google, Outlook, and passkey alike. You'll land on a screen titled **"Two-factor authentication"** with a six-digit field; entering the last digit submits it.

Passkeys are challenged too, which surprises people. A passkey is strong, but in Carbon it resolves into an ordinary session like any other sign-in method, so exempting it would leave a way around the requirement. If you'd rather not be asked twice, that's an argument for using a passkey *instead of* two-factor, not alongside it.

A code is valid for its thirty-second window plus one window either side, to absorb small drift. If codes are consistently rejected on a phone whose time is set manually, switch it to network time. It's the single most common cause of "the code is right but Carbon says no".

Repeated attempts are rate-limited on the same budget as sign-in itself, so guessing your way through isn't practical — and neither is retrying twenty times because you mistyped.

Sessions that already existed before you enrolled don't get a free pass. Carbon re-checks on each request, so a browser you left signed in on another machine is sent to the code screen the next time it's used rather than quietly staying trusted for the rest of the week.

## Requiring it for everyone

Open **Settings → System → Security** and find the **Two-Factor Authentication Enforcement** card. Turning the switch on means anyone opening that company has to have an authenticator set up. There's no grace period; it takes effect on their next page load.

Someone without one sees a full-screen prompt instead of the app, with a **"Set up authenticator app"** button that runs the same QR-and-code flow as the account page. They can complete it right there. The only other thing on that screen is **"Sign out"** — there is no way past it.

This is the part worth reading twice. If you belong to two companies and only one requires two-factor, you're prompted to set one up **only while you're in that company**. Switch to the other and the prompt is gone.

But once you've set one up, you're asked for a code at **every** sign-in, to either company. There's no such thing as being half-enrolled — the authenticator is attached to your account, not to a membership. Turning the requirement on in one company therefore does change how its people sign in everywhere else, which is worth saying out loud before you flip it.

Controlled environments are the exception to all of the above. When Carbon is deployed for ITAR or CMMC work, two-factor is mandatory and the switch is locked on, because NIST 800-171 requires it for network access to non-privileged accounts. Admins can see the setting but not turn it off, and the enrollment screen offers no way around it.

## Seeing who has set it up

Once enforcement is on, **People → Employee accounts** grows a **Two-Factor** column showing **"Enabled"** or **"Not set up"** for each person. It's blank for shop-floor PIN operators, who don't sign in at all.

The column only appears while the company requires two-factor. With the setting off it would be a wall of "Not set up" describing a policy nobody opted into.

## When someone loses their phone

There are no printed backup codes. Recovery is an admin action, which keeps it auditable and avoids a fallback secret that is itself worth stealing.

An admin with permission to update users opens **People → Employee accounts**, finds the person, and chooses **"Reset Two-Factor Auth"** from the row menu. That removes their authenticator; their next sign-in is an ordinary magic link, and they can enrol a fresh device.

Because the authenticator is attached to the account rather than to a membership, removing it removes it everywhere. An admin at one company can therefore clear two-factor for a user who also works at another. That's unavoidable given how the factor is stored, but worth knowing before you treat the reset as a purely local action.

It also means at least two people should hold user-management permission. If your only admin loses their phone and nobody else can reset it, there is no self-service way back in.

## What two-factor doesn't cover

Machine access is never challenged, and that's by design — there's nobody present to read a code off a phone.

  - **API keys**: Keep working exactly as before. They carry their own scopes and rate limits; see `docs/reference/api-keys`.
  - **Integrations**: Anything authenticating as the company rather than as a person is unaffected.
  - **Shop-floor PIN operators**: Never prompted. Operators pin in at a shared terminal rather than signing in, so there's no personal session to protect and no phone to scan with. The person who signed the terminal in is the one two-factor applies to.

If you need to restrict what an authenticated person can reach, that's a different mechanism entirely — see `docs/reference/permissions`.

## Where each piece lives

  - **Account → Security**: Set up or remove your own authenticator, alongside your passkeys. See `docs/reference/account`.
  - **Settings → System → Security**: The **Two-Factor Authentication Enforcement** switch for the whole company. See `docs/reference/company-settings`.
  - **People → Employee accounts**: The **Two-Factor** status column and the **"Reset Two-Factor Auth"** row action. See `docs/reference/people`.

## Troubleshooting

### "That code isn't right" on a code you just read

Almost always clock drift on the phone. Set the device to network time and try again. Failing that, confirm you're reading the entry for the right company — two Carbon entries are easy to mix up, which is why the label carries the company name.

### Someone is stuck on the setup screen and can't get in

That's a company with enforcement on and a person without an authenticator. They complete setup on that screen and continue. If they can't (no phone to hand), the only other option on the screen is signing out.

### The Two-Factor column isn't in the employee list

The column only renders while the company requires two-factor. Turn the setting on in **Settings → System → Security** and it appears.

### Turning enforcement on didn't prompt anyone

It applies on each person's next page load, not retroactively to sessions sitting idle. Anyone already looking at a stale tab sees it when they next navigate.

### An admin can't turn enforcement off

The deployment is a controlled (ITAR) environment, where two-factor is mandatory and the switch is locked on.
