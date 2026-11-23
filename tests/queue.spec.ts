/**
 * End-to-end check of the Office Hours Queue with two real signed-in users
 * (a TA and a student) in separate browsers.
 *
 * Needs these two test accounts on this machine:
 *   npx deepspace test accounts create --email ohq-ta@deepspace.test --name "Tina TA" --password-stdin
 *   npx deepspace test accounts create --email ohq-student@deepspace.test --name "Sam Student" --password-stdin
 * Local:  npx deepspace test run e2e
 * Live:   $env:E2E_BASE_URL='https://office-hours-queue.app.space'; npx playwright test -c tests/playwright.config.ts queue
 */
import { test, expect, type Page } from 'deepspace/testing'

type Result = { status: number; body: Record<string, unknown> }

/** Fetch an API route as the user signed in on `page`, skipping the UI the way a hand-crafted request would. */
function rawFetch(page: Page, path: string, body?: unknown): Promise<Result> {
  return page.evaluate(
    async ({ path, body }) => {
      const tokenRes = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      const { token } = await tokenRes.json()
      const res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    { path, body },
  )
}

const rawAction = async (page: Page, name: string, params: Record<string, unknown>) =>
  (await rawFetch(page, `/api/actions/${name}`, params)).body

/**
 * A direct record write as the caller, through the app's tool endpoint (the same
 * record room permission checks the realtime socket uses). Used to prove the
 * schema rules hold without the UI.
 */
async function rawRecordUpdate(page: Page, collection: string, recordId: string, data: Record<string, unknown>) {
  const list = await rawFetch(page, '/_deepspace/agent/browser/tools')
  const tools = (list.body.tools ?? []) as { name: string }[]
  const name = tools.find((t) => /^records.?update$/.test(t.name))?.name
  expect(name, `records.update tool not exposed: ${JSON.stringify(list)}`).toBeTruthy()
  return rawFetch(page, `/_deepspace/agent/browser/tools/${name}`, { input: { collection, recordId, data } })
}

async function startSession(page: Page): Promise<string> {
  await page.goto('/home')
  await page.getByLabel('Session title').fill(`E2E ${Date.now()}`)
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL(/\/s\/[^/]+$/, { timeout: 15_000 })
  return new URL(page.url()).pathname
}

async function join(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question)
  await page.getByRole('button', { name: 'Join queue' }).click()
  await expect(page.getByText('You’re #1 in line.')).toBeVisible({ timeout: 15_000 })
}

test('signed-out visitors are gated', async ({ page, request }) => {
  for (const path of ['/home', '/s/anything']) {
    await page.goto(path)
    await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Session title')).toHaveCount(0)
  }
  const res = await request.post('/api/actions/setStatus', { data: { entryId: 'x', status: 'done' } })
  expect(res.status()).toBe(401)
})

test('TA runs a session and the student sees every change live', async ({ users }) => {
  test.setTimeout(120_000)
  const [ta, student] = await users(['Tina TA', 'Sam Student'])
  const path = await startSession(ta.page)

  // The share link the TA sees is this page's own URL, and it opens the session for the student.
  const link = await ta.page.getByLabel('Share link').inputValue()
  expect(new URL(link).pathname).toBe(path)
  await student.page.goto(link)
  await expect(student.page.getByRole('heading', { level: 1 })).toHaveText(
    await ta.page.getByRole('heading', { level: 1 }).innerText(),
  )
  await expect(student.page.getByRole('button', { name: 'Close session' })).toHaveCount(0)

  // Student joins; the TA's page (never reloaded) shows it.
  await join(student.page, 'Why does my recursion never stop?')
  const row = ta.page.getByTestId('queue-entry')
  await expect(row).toContainText('Why does my recursion never stop?', { timeout: 15_000 })

  // Student edits their question; TA sees it.
  await student.page.getByRole('button', { name: 'Edit' }).click()
  await student.page.getByLabel('Edit your question').fill('Why does my base case never trigger?')
  await student.page.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Why does my base case never trigger?', { timeout: 15_000 })

  // helping -> student sees it; done -> student is out of the queue.
  await row.getByRole('button', { name: 'Help' }).click()
  await expect(student.page.getByText('Your TA is helping you now.')).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Done' }).click()
  await expect(student.page.getByLabel('Your question')).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('Finished')).toBeVisible({ timeout: 15_000 })

  // skipped -> student is out of the queue again.
  await join(student.page, 'Second question')
  await expect(row).toContainText('Second question', { timeout: 15_000 })
  await row.getByRole('button', { name: 'Skip' }).click()
  await expect(student.page.getByLabel('Your question')).toBeVisible({ timeout: 15_000 })
  // Finished list shows display labels, not the raw stored values.
  await expect(ta.page.getByText('Skipped', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('Done', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('skipped', { exact: true })).toHaveCount(0)

  // Close -> student's view switches live.
  await ta.page.getByRole('button', { name: 'Close session' }).click()
  await expect(student.page.getByText('This session is closed')).toBeVisible({ timeout: 15_000 })
})

test('server refuses what a student must not do', async ({ users }) => {
  test.setTimeout(120_000)
  const [ta, student] = await users(['Tina TA', 'Sam Student'])
  const path = await startSession(ta.page)
  const sessionId = path.split('/').pop()!

  await student.page.goto(path)
  await join(student.page, 'Can I skip myself?')
  const mine = await student.page.getByTestId('queue-entry').getAttribute('data-entry-id')
  expect(mine).toBeTruthy()

  // A second person's entry (the TA joining their own queue through the server, as a stand-in for another student).
  expect(await rawAction(ta.page, 'joinQueue', { sessionId, question: 'Someone else’s question' })).toMatchObject({ success: true })
  const theirs = student.page.getByTestId('queue-entry').filter({ hasText: 'Someone else’s question' })
  await expect(theirs).toBeVisible({ timeout: 15_000 })
  const theirsId = (await theirs.getAttribute('data-entry-id'))!

  // setStatus: refused for a student, on their own entry and on another's.
  for (const entryId of [mine, theirsId]) {
    for (const status of ['done', 'skipped', 'helping']) {
      expect(await rawAction(student.page, 'setStatus', { entryId, status })).toMatchObject({
        success: false,
        error: 'Only this session’s TA can do that.',
      })
    }
  }

  // Direct record writes: the student can't edit another entry, can't set status, can't close the session...
  const editOther = await rawRecordUpdate(student.page, 'queue_entries', theirsId, { question: 'hijacked' })
  expect(editOther.body.ok, JSON.stringify(editOther)).not.toBe(true)
  const ownStatus = await rawRecordUpdate(student.page, 'queue_entries', mine!, { status: 'done' })
  expect(ownStatus.body.ok, JSON.stringify(ownStatus)).not.toBe(true)
  const closeIt = await rawRecordUpdate(student.page, 'sessions', sessionId, { isOpen: false })
  expect(closeIt.body.ok, JSON.stringify(closeIt)).not.toBe(true)
  // ...but the same path does let them edit their own question (so the refusals above are real refusals).
  const ownEdit = await rawRecordUpdate(student.page, 'queue_entries', mine!, { question: 'Edited directly' })
  expect(ownEdit.body.ok, JSON.stringify(ownEdit)).toBe(true)
  await expect(ta.page.getByText('Edited directly')).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('hijacked')).toHaveCount(0)
  await expect(ta.page.getByTestId('queue-entry')).toHaveCount(2)

  // Duplicate join and over-long questions are refused.
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'again' })).toMatchObject({
    success: false,
    error: 'You are already in this queue.',
  })
  await student.page.getByRole('button', { name: 'Leave' }).click()
  await expect(ta.page.getByText('Edited directly')).toHaveCount(0, { timeout: 15_000 })
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'x'.repeat(201) })).toMatchObject({ success: false })

  // Closed session refuses joins, even straight to the server.
  await ta.page.getByRole('button', { name: 'Close session' }).click()
  await expect(student.page.getByText('This session is closed')).toBeVisible({ timeout: 15_000 })
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'let me in' })).toMatchObject({
    success: false,
    error: 'This session is closed.',
  })
})

test('works at phone width (375px)', async ({ users }) => {
  test.setTimeout(120_000)
  const [ta, student] = await users(['Tina TA', 'Sam Student'])
  await ta.page.setViewportSize({ width: 375, height: 812 })
  await student.page.setViewportSize({ width: 375, height: 812 })

  const noSideways = async (page: Page) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

  const path = await startSession(ta.page)
  await noSideways(ta.page)
  await student.page.goto(path)
  await join(student.page, 'A fairly long question that should wrap nicely on a narrow phone screen without overflowing')
  await noSideways(student.page)

  const row = ta.page.getByTestId('queue-entry')
  await expect(row).toBeVisible({ timeout: 15_000 })
  await noSideways(ta.page)
  for (const name of ['Help', 'Done', 'Skip']) await expect(row.getByRole('button', { name })).toBeInViewport()
  await expect(ta.page.getByRole('button', { name: 'Copy link' })).toBeInViewport()
  // The share link gets a full row on phones instead of being squeezed beside the buttons.
  expect((await ta.page.getByLabel('Share link').boundingBox())!.width).toBeGreaterThan(300)
  await expect(ta.page.getByRole('button', { name: 'Close session' })).toBeInViewport()
  await expect(student.page.getByRole('button', { name: 'Leave' })).toBeInViewport()

  await ta.page.screenshot({ path: 'test-results/phone-ta.png' })
  await student.page.screenshot({ path: 'test-results/phone-student.png' })
})
