/**
 * Server actions: called from the browser as POST /api/actions/<name>.
 *
 * Actions run with RBAC switched off (see src/server/action-routes.ts), so each
 * one does its own authorization. `userId` comes from the verified sign-in
 * token, never from `params`, so a caller can't pretend to be someone else.
 *
 * These exist only for the rules the schema permissions can't express:
 *   - joinQueue: the session must be open and the student not already queued.
 *   - setStatus: the caller must be the TA *of the entry's session*.
 *   - groupQuestions: same TA check, then a paid AI call.
 * They are also the only place integrations are called (the browser proxy is
 * closed in src/server/http-routes.ts), so only the right person can spend them.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { QUESTION_MAX, type EntryStatus, type QueueEntry, type Session } from '../schemas/queue-schema'
import {
  GROUPING_MODEL,
  GROUPING_SYSTEM_PROMPT,
  groupingUserMessage,
  parseGroups,
} from './group-questions'

const STATUSES: EntryStatus[] = ['waiting', 'helping', 'done', 'skipped']

const fail = (error: string): ActionResult => ({ success: false, error })

function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // One line: collapse newlines/extra spaces into single spaces.
  const q = raw.replace(/\s+/g, ' ').trim()
  return q && q.length <= QUESTION_MAX ? q : null
}

/** Load a session and confirm the caller is its TA. */
async function loadOwnSession(tools: ActionTools, sessionId: string, userId: string) {
  const session = await tools.get<Session>('sessions', sessionId)
  if (!session.success) return { error: 'Session not found.' }
  if (session.data.record.data.taId !== userId) return { error: 'Only this session’s TA can do that.' }
  return { session: session.data.record.data }
}

const joinQueue: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  const question = cleanQuestion(params.question)
  const notify = params.notify === true
  if (!sessionId) return fail('Missing session.')
  if (!question) return fail(`Question must be 1–${QUESTION_MAX} characters.`)

  const session = await tools.get<Session>('sessions', sessionId)
  if (!session.success) return fail('Session not found.')
  if (!session.data.record.data.isOpen) return fail('This session is closed.')

  // shortcut: check-then-create can race if one student double-submits at the same instant; fine for a class queue.
  const mine = await tools.query<QueueEntry>('queue_entries', { where: { sessionId, studentId: userId } })
  if (!mine.success) return fail('Could not check the queue.')
  if (mine.data.records.some((r) => r.data.status === 'waiting' || r.data.status === 'helping')) {
    return fail('You are already in this queue.')
  }

  // studentId is userBound: the record room stamps it with userId itself.
  return tools.create('queue_entries', { sessionId, question, status: 'waiting', notify })
}

/**
 * Email integration, best effort: a failed email must never block the TA's click.
 * Plain text only, so no session title or question can inject HTML.
 */
async function emailYourTurn(tools: ActionTools, env: Env, entry: QueueEntry, session: Session): Promise<boolean> {
  try {
    const user = await tools.get<{ email?: string }>('users', entry.studentId)
    const to = user.success ? user.data.record.data.email : undefined
    if (!to) return false
    // shortcut: links to the default app.space domain; switch to a configured origin if a custom domain is added.
    const link = `https://${env.APP_NAME}.app.space/s/${entry.sessionId}`
    const sent = await tools.integration('email/send', {
      to,
      subject: `Your TA is ready for you: ${session.title}`,
      text: `Your TA has started helping you in "${session.title}".\n\nYour question: ${entry.question}\n\nOpen the queue: ${link}`,
    })
    if (!sent.success) console.warn(`[email] send failed: ${sent.error}`)
    return sent.success
  } catch (err) {
    console.warn('[email] send threw', err)
    return false
  }
}

const setStatus: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const entryId = typeof params.entryId === 'string' ? params.entryId : ''
  const status = params.status as EntryStatus
  if (!entryId || !STATUSES.includes(status)) return fail('Invalid request.')

  const entry = await tools.get<QueueEntry>('queue_entries', entryId)
  if (!entry.success) return fail('Entry not found.')
  const data = entry.data.record.data

  const { session, error } = await loadOwnSession(tools, data.sessionId, userId)
  if (!session) return fail(error)

  const updated = await tools.update('queue_entries', entryId, { status })
  if (!updated.success) return updated

  // Email only on the change into "helping", and only if the student opted in.
  const emailed = status === 'helping' && data.status !== 'helping' && data.notify
    ? await emailYourTurn(tools, env, data, session)
    : false
  return { success: true, data: { recordId: entryId, emailed } }
}

const groupQuestions: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  if (!sessionId) return fail('Missing session.')
  const { session, error } = await loadOwnSession(tools, sessionId, userId)
  if (!session) return fail(error)

  const waiting = await tools.query<QueueEntry>('queue_entries', {
    where: { sessionId, status: 'waiting' },
    orderBy: 'createdAt',
    limit: 50, // caps prompt size and cost
  })
  if (!waiting.success) return fail('Could not read the queue.')
  const entries = waiting.data.records.map((r) => ({ id: r.recordId, question: r.data.question }))
  if (entries.length < 2) return { success: true, data: { groups: [] } }

  const reply = await tools.integration<{ content?: { type: string; text?: string }[] }>(
    'anthropic/chat-completion',
    {
      model: GROUPING_MODEL,
      max_tokens: 1000,
      temperature: 0,
      system: GROUPING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: groupingUserMessage(entries) }],
    },
  )
  if (!reply.success) {
    console.warn(`[ai] grouping failed: ${reply.error}`)
    return fail('Could not group questions right now. Try again in a moment.')
  }
  const text = reply.data.content?.find((c) => c.type === 'text')?.text ?? ''
  return { success: true, data: { groups: parseGroups(text, entries.map((e) => e.id)) } }
}

export const actions: Record<string, ActionHandler<Env>> = { joinQueue, setStatus, groupQuestions }
