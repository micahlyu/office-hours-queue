# Agent log: Office Hours Queue

The log for this build task. Each entry records what was asked, what the agent did, and what the human checked.

Due: Mon Nov 23, 7 PM Pacific. Target: `https://office-hours-queue.app.space` (name to be confirmed at the first deploy).

---

## 2026-11-21: Step 1, design only (no app code)

**Asked:** Build a multi-user Office Hours Queue on DeepSpace. Requirements:
- sign in;
- a TA creates a session and gets a share link;
- students join with a one-line question, with live updates;
- only the session's TA can mark helped, skip or close, enforced on the server;
- students edit or leave only their own entry.

First: read the docs and the agent skill, propose a data model and a permission design, and wait for an OK.

**Did:**
- Read the DeepSpace docs: quickstart, installation, project structure, data model, permissions, realtime, server actions, auth, secrets, deploy, CLI and the schema reference.
- Read the agent skill (`deepdotspace/deepspace-skill`, `skills/deepspace/SKILL.md`).
- Checked the toolchain: Node 26.13.0 is in the supported range (`>=26 <27`), npm is 11.20.0 and git is 2.56.
- Wrote the proposal below. No code yet, nothing scaffolded, nothing deployed.

**Proposal (summary):**
- `sessions`: title, taId (owner), isOpen. Signed-in users read all sessions. The owner closes or renames a session with a direct write.
- `queue_entries`: sessionId, studentId (owner), question, status. Every write that crosses users goes through a server action that checks the TA on the server: joining, editing a question, and changing status. Students delete their own entry under the `'own'` rule.
- Realtime comes from `useQuery`, filtered by sessionId. The share link is `/s/<sessionId>`.

**To verify after scaffolding:**
1. The dynamic route file name (`[id].tsx`) and the params hook.
2. That `ownerField` plus `userBound` enforces the `'own'` rule.
3. What `createdBy` is for records an action creates.
4. Whether schema columns support a max length.

**Human checked:** Approved the design as proposed ("Approved, build it").

---

## 2026-11-21: Step 2, build

**Asked:** "Approved, build it."

**Did:**
- Scaffolded with `npx deepspace@latest app create office-hours-queue`. That gave deepspace 0.44.2 (Vite + React, Hono worker, file-based routes).
  This version doesn't install `.agents/skills/deepspace/`; `AGENTS.md` points to the docs instead.
- Signed in with `npx deepspace auth login` in an interactive terminal (the browser flow).
  Registered the app with `npx deepspace app init`, which made the initial git commit. App id `app_01M7ZC4ZKNP0T9K0N1VK1PACFA`.
- Answers to the step 1 questions, checked against the SDK source and types in `node_modules/deepspace`:
  1. Dynamic routes are `[param].tsx` (generouted), read with `useParams()` from `react-router-dom`.
  2. `userBound: true` makes the record room stamp the caller's id on create and ignore client values after that.
     `ownerField` points the `'own'` rule at that column. Both hold in actions, which pass the caller's id to the room.
  3. Not needed, because the explicit userBound owner columns cover it.
  4. Columns support `maxLength`, enforced before writing. It's used for `title` (80) and `question` (200).
- **One change from the approved design:** editing a question is a direct write, not an `editQuestion` action.
  The `'own'` update rule, `writableFields: ['question']` and `maxLength` already enforce it on the server, so an action would duplicate it.
  The only check lost is the "one line" rule: a client that bypasses the UI could save a newline. That's harmless, and the UI collapses whitespace.
- Joining (`joinQueue`) and status changes (`setStatus`) are server actions.
  Both need facts from another record (is the session open? is the caller *that session's* TA?), which the permission rules can't express.
- Tests:
  - `src/schemas/queue-schema.test.ts` (vitest): the direct-write rules, checked with the SDK's own `canUpdate`, `canDelete` and `checkFieldPermissions`, plus the schema linter.
  - `tests/queue.spec.ts` (Playwright, two real test accounts, "Tina TA" and "Sam Student"):
    - live updates in both directions;
    - a student calling `setStatus` directly on their own entry is refused;
    - duplicate join, over-long question and joining a closed session are refused.
  - The test account passwords were random and stored by the CLI in `~/.deepspace/test-accounts.json`, not in the repo.
- Results: `npx deepspace test run all` gave 13/13 passing. `npx vitest run src/schemas` gave 8/8. `tsc --noEmit` and `eslint .` are clean.

- Deployed with `npx deepspace deploy`. The first attempt failed with the platform error `release_reconciliation_pending`.
  Rerunning it, as the error instructed, succeeded: release `rel_01M7ZCED4VV5G3HC2MY2BRN4BT` at **https://office-hours-queue.app.space**.
  The source is the DeepSpace cloud repo (git remote `space`). No GitHub remote has been added yet.
- Live probes:
  - `/home` → 200; `/api/auth/ok` → `{"ok":true}`;
  - `/api/actions/setStatus` with no token → 401;
  - the served JS contains the new pages.
- Not yet checked live: a real two-person run with Google or GitHub sign-in. The tests ran against the local dev server.

**Human checked:** _(pending: try the live site with two accounts)_

### File map: what to explain in the live round

| File | What it does |
|---|---|
| `src/schemas/queue-schema.ts` | The two collections, their columns and every server-enforced permission rule |
| `src/schemas.ts` | Registers all collections with the app (scaffold file, two lines added) |
| `src/actions/index.ts` | `joinQueue` and `setStatus`: the two rules that need a lookup across records |
| `src/lib/actions.ts` | A small `fetch` wrapper that calls an action with the user's sign-in token |
| `src/pages/(app)/(protected)/home.tsx` | `/home`: start a session; list the sessions you run |
| `src/pages/(app)/(protected)/s/[sessionId].tsx` | `/s/<id>`: the share link. Live queue, TA controls, student join/edit/leave |
| `src/nav.ts` | Nav label changed to "My sessions" |
| `src/schemas/queue-schema.test.ts` | Permission unit tests |
| `tests/queue.spec.ts` | Two-user end-to-end tests |
| Everything else | DeepSpace scaffold, unchanged (auth, worker, providers, UI kit) |

**Where each requirement is enforced:**

| Requirement | Server enforcement |
|---|---|
| Must be signed in | The `'*'` role has `read: false` everywhere. Pages sit under `(protected)/`, which only gates the UI. |
| TA creates a session and gets a link | `create: true`. `taId` is stamped by the server (`userBound`). The link is `/s/<recordId>`. |
| Live updates | `useQuery` subscribes over the record room's WebSocket. No polling. |
| Only the TA marks helped or skipped | Students and the TA both have no direct write to `status`. `setStatus` checks `session.taId === caller`. |
| Only the TA closes the session | `update: 'own'` on `taId`, with `writableFields: ['title', 'isOpen']` |
| Student edits or leaves only their own entry | `update` and `delete` are `'own'` on `studentId`. Only `question` is writable. |

**Known limits (`shortcut:` comments in code):**
- `joinQueue` checks for duplicates and then creates. A double-click at the same instant could add two entries.
- The session page loads all sessions to find one. That's fine at class scale.
- Any signed-in user can read every queue's questions. The design accepted this.
