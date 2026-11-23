# Accept an invite while signed in as another user

Last tested: 2026-11-19
Route: /invite/:code (public)

## Prerequisites
- Signed in as `test@carbon.ms` (/auth)
- An invite for a different address. Plus-aliases of the bypass email work
  (`test+invitee@carbon.ms`) because the dev bypass accepts them.

## Steps
### 1. Create the invite — /x/users/employees/new
- "Email": `test+invitee@carbon.ms`, "First Name": `Invited`, "Last Name": `User`
- "Employee Type" combobox: click, pick "Admin" (only option on a fresh seed)
- requestSubmit the form whose submit button reads "Invite"
- Verify: redirects to /x/person/<id>/job with heading "Invited User"

### 2. Read the invite code
```bash
docker exec carbon-postgres psql -U postgres -d wt_<slug> -Atc \
  "select code from invite where email ilike 'test+invitee@carbon.ms' order by \"createdAt\" desc limit 1"
```
(shared mode; the database name is `wt_` + the worktree slug with `_` for `-`)

### 3. Join while still signed in as test@carbon.ms
- Open /invite/<code>, requestSubmit the form whose button contains "Join"
- Verify: server log shows `POST 302 /invite/<code>` then `GET 200 /invite/<code>`
  (no 500); opening /x now redirects to /login (session cleared)

### 4. Join again, signed out
- requestSubmit "Join" again
- Verify: lands on /x with "Welcome back, Invited."; `invite.acceptedAt` is set

## Selector Notes
- The Join button text is "Join <company name>" — match with `includes('Join')`

## Common Failures
- Console warning "two children with the same key" from AnimatePresence on the
  invite page — pre-existing, unrelated
