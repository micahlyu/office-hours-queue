# Office Hours Queue

A live, multi-user office-hours queue built on [DeepSpace](https://deep.space).
A TA opens a session and shares its link, students join with a one-line question, and every screen updates in real time.

**Live:** https://office-hours-queue.app.space

## What it does

- **Sign in** with DeepSpace's built-in auth (Google or GitHub). Signed-out visitors see only the landing page.
- **TA creates a session** on `/home` and gets a shareable link: `/s/<sessionId>`.
- **Students join** from that link with a one-line question (200 characters max). They can edit their question or leave.
- **Live updates:** the queue, positions and statuses update on every open screen without reloading.
- **TA controls:** mark *helping*, *done* or *skipped*, put someone back in the queue, and close or reopen the session.
  Only the TA of *that* session can do these.
- **AI grouping (TA only):** one click groups the waiting questions by topic, so the TA can answer similar ones together.
- **Email when it's your turn:** students can tick "Email me when it's my turn" and get an email when the TA starts helping them, so they don't have to watch the tab.

## DeepSpace features and integrations used

| What | DeepSpace piece | Why |
|---|---|---|
| Sign-in | Built-in auth (Google/GitHub) | No password handling of our own |
| Live queue | Realtime records (`useQuery` / `useMutations`) | Every screen updates without polling |
| Who can do what | Schema permissions (`'own'`, `userBound`, `writableFields`, `maxLength`) | Enforced on the server for every direct write |
| Cross-record rules | Server actions | Checks a permission rule can't express |
| Question grouping | `anthropic/chat-completion` integration (`claude-haiku-5-5`) | A TA facing 15 questions can spot the 4 that are the same |
| Turn notifications | `email/send` integration | Students can leave the tab instead of watching it |

Both integrations are billed to the app owner, so they are called **only from server actions**:
- `groupQuestions` checks the caller is the session's TA.
- Emails go only to a student who opted in, only when that session's TA marks them helping.

The starter template's browser proxy (`/api/integrations/<name>/<endpoint>`) let any signed-in user call any paid integration on the owner's bill. It is closed (`src/server/http-routes.ts`), and a test proves it returns 404.

Not used, on purpose:
- Video (LiveKit) would suit remote office hours, but needs a new client dependency and media handling that couldn't be properly tested in the time.
- Calendar and Slack need per-user account connections that don't help the core flow.

## How permissions are enforced (server side)

DeepSpace's record room checks every read and write against each collection's `permissions` before data leaves the server.
The browser's buttons are only UI.

| Rule | Where it's enforced |
|---|---|
| Must be signed in to read anything | `'*'` role has `read: false` on both collections (`src/schemas/queue-schema.ts`) |
| Session's TA is whoever created it | `taId` is `userBound`, so the server stamps the creator's id and ignores client values |
| Only the TA can rename, close or reopen a session | `update: 'own'` on `taId`, `writableFields: ['title', 'isOpen']` |
| Students edit or leave only their own entry | `update` and `delete` are `'own'` on `studentId`, with `writableFields: ['question']` |
| Students can never set `status` | `status` isn't in any role's `writableFields` |
| Join only an open session, once | `joinQueue` server action (`src/actions/index.ts`) |
| Only *this session's* TA changes an entry's status | `setStatus` server action checks `session.taId === caller` |
| Only *this session's* TA can run (and pay for) AI grouping | `groupQuestions` server action, same check |
| Nobody can opt someone else in to email | `notify` is set only by `joinQueue` for the caller's own entry, and isn't in any `writableFields` |
| No calling paid integrations from the browser | Template proxy route closed (`src/server/http-routes.ts`) |

The two server actions exist because a permission rule can't look up a *different* record (the entry's session).
Actions take the caller's id from the verified sign-in token, never from the request body.

## Project layout

| Path | Purpose |
|---|---|
| `src/schemas/queue-schema.ts` | `sessions` and `queue_entries` collections, columns and permission rules |
| `src/actions/index.ts` | `joinQueue`, `setStatus` (plus the email) and `groupQuestions` server actions |
| `src/actions/group-questions.ts` | The AI prompt, and a parser that never trusts the model's reply |
| `src/server/http-routes.ts` | Template platform proxies, with the paid-integrations proxy closed |
| `src/lib/actions.ts` | Browser helper that calls an action with the user's token |
| `src/pages/index.tsx` | Static landing page |
| `src/pages/(app)/(protected)/home.tsx` | Start a session; list your sessions |
| `src/pages/(app)/(protected)/s/[sessionId].tsx` | The shareable session room: live queue, TA and student controls |
| `src/schemas/queue-schema.test.ts` | Unit tests for the permission rules |
| `src/actions/group-questions.test.ts` | Unit tests for parsing the AI reply (invented ids, duplicates, garbage) |
| `tests/queue.spec.ts` | Two-account end-to-end tests (TA and student) |
| `NOTES.md` | Build log: what was asked, built and checked at each step |

Everything else (worker, auth wiring, UI kit, routing) is the DeepSpace starter template.

## Run it

Needs Node 22.15+, 24 or 26, and npm 11.6+. On Windows PowerShell, use `npx.cmd` if script execution is blocked.

```sh
npm install
npx deepspace auth login      # sign in to DeepSpace (opens a browser)
npx deepspace dev start       # http://localhost:5173
npx deepspace deploy          # https://office-hours-queue.app.space
```

No secrets are needed. If you ever add one, use `npx deepspace secrets set KEY=value`, never a file in the repo.

## Test it

```sh
npx vitest run                # permission-rule unit tests
npx deepspace test run all    # smoke + end-to-end against a local server
```

The end-to-end tests sign in as two DeepSpace test accounts.
Create them once per machine; passwords are stored in `~/.deepspace`, outside the repo:

```sh
npx deepspace test accounts create --email ohq-ta@deepspace.test --name "Tina TA" --password-stdin
npx deepspace test accounts create --email ohq-student@deepspace.test --name "Sam Student" --password-stdin
```

To run the same suite against the deployed site instead of localhost (PowerShell):

```powershell
$env:E2E_BASE_URL='https://office-hours-queue.app.space'; npx playwright test -c tests/playwright.config.ts
```

## Known limits

- Two joins from the same student at the exact same instant could both get in. `joinQueue` checks and then creates, without a lock.
- Any signed-in user can read every session's queue. There's no per-field read privacy.
- The session page loads all sessions to find one. That's fine at class scale.
- AI groups are suggestions. A wrong grouping only affects the TA's view, never the queue order.
  The reply is checked so every waiting question appears exactly once, and question text is passed to the model as data, not instructions.
- Email is best effort. If sending fails, the TA's click still succeeds and the failure is logged.
  It's sent only on "helping", not when a student reaches the front of the line.
