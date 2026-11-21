/**
 * End-to-end check of the Office Hours Queue with two real signed-in users
 * (a TA and a student) in separate browsers.
 *
 * Needs these two test accounts on this machine:
 *   npx deepspace test accounts create --email ohq-ta@deepspace.test --name "Tina TA" --password-stdin
 *   npx deepspace test accounts create --email ohq-student@deepspace.test --name "Sam Student" --password-stdin
 * Run: npx deepspace test run e2e
 */
import { test, expect, type Page } from 'deepspace/testing'

/** Call a server action as the user signed in on `page`, skipping the UI, the way a hand-crafted request would. */
function rawAction(page: Page, name: string, params: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, params }) => {
      const { token } = await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })).json()
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return res.json() as Promise<{ success: boolean; error?: string }>
    },
    { name, params },
  )
}

async function startSession(page: Page): Promise<string> {
  await page.goto('/home')
  await page.getByLabel('Session title').fill(`E2E ${Date.now()}`)
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page).toHaveURL(/\/s\/[^/]+$/, { timeout: 15_000 })
  return new URL(page.url()).pathname
}

async function join(page: Page, path: string, question: string) {
  await page.goto(path)
  await page.getByLabel('Your question').fill(question)
  await page.getByRole('button', { name: 'Join queue' }).click()
  await expect(page.getByText('You’re #1 in line.')).toBeVisible({ timeout: 15_000 })
}

test('TA runs a session and the student sees every change live', async ({ users }) => {
  test.setTimeout(90_000)
  const [ta, student] = await users(['Tina TA', 'Sam Student'])
  const path = await startSession(ta.page)

  await join(student.page, path, 'Why does my recursion never stop?')
  // Student gets no TA controls.
  await expect(student.page.getByRole('button', { name: 'Close session' })).toHaveCount(0)
  // TA's queue updates without a reload.
  const row = ta.page.getByTestId('queue-entry')
  await expect(row).toContainText('Why does my recursion never stop?', { timeout: 15_000 })

  // Student edits their question; TA sees it.
  await student.page.getByRole('button', { name: 'Edit' }).click()
  await student.page.getByLabel('Edit your question').fill('Why does my base case never trigger?')
  await student.page.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Why does my base case never trigger?', { timeout: 15_000 })

  // TA helps, then finishes; student sees both.
  await row.getByRole('button', { name: 'Help' }).click()
  await expect(student.page.getByText('Your TA is helping you now.')).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Done' }).click()
  await expect(student.page.getByLabel('Your question')).toBeVisible({ timeout: 15_000 })
  await expect(ta.page.getByText('Finished')).toBeVisible()

  // TA closes the session; the student's view switches to closed.
  await ta.page.getByRole('button', { name: 'Close session' }).click()
  await expect(student.page.getByText('This session is closed')).toBeVisible({ timeout: 15_000 })
})

test('server refuses what a student must not do', async ({ users }) => {
  test.setTimeout(90_000)
  const [ta, student] = await users(['Tina TA', 'Sam Student'])
  const path = await startSession(ta.page)
  const sessionId = path.split('/').pop()!

  await join(student.page, path, 'Can I skip myself?')
  const entryId = await student.page.getByTestId('queue-entry').getAttribute('data-entry-id')
  expect(entryId).toBeTruthy()

  // Not the TA: marking any status on their own entry is refused.
  for (const status of ['done', 'skipped', 'helping']) {
    expect(await rawAction(student.page, 'setStatus', { entryId, status })).toMatchObject({
      success: false,
      error: 'Only this session’s TA can do that.',
    })
  }
  // Only one active entry per student per session.
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'again' })).toMatchObject({
    success: false,
    error: 'You are already in this queue.',
  })
  // Over-long questions are rejected.
  await student.page.getByRole('button', { name: 'Leave' }).click()
  await expect(ta.page.getByText('Can I skip myself?')).toHaveCount(0, { timeout: 15_000 })
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'x'.repeat(201) })).toMatchObject({
    success: false,
  })

  // Once closed, joining is refused even when calling the server directly.
  await ta.page.getByRole('button', { name: 'Close session' }).click()
  await expect(student.page.getByText('This session is closed')).toBeVisible({ timeout: 15_000 })
  expect(await rawAction(student.page, 'joinQueue', { sessionId, question: 'let me in' })).toMatchObject({
    success: false,
    error: 'This session is closed.',
  })
})
