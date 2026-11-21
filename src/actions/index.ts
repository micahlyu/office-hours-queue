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
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { QUESTION_MAX, type EntryStatus, type QueueEntry, type Session } from '../schemas/queue-schema'

const STATUSES: EntryStatus[] = ['waiting', 'helping', 'done', 'skipped']

const fail = (error: string): ActionResult => ({ success: false, error })

function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // One line: collapse newlines/extra spaces into single spaces.
  const q = raw.replace(/\s+/g, ' ').trim()
  return q && q.length <= QUESTION_MAX ? q : null
}

const joinQueue: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  const question = cleanQuestion(params.question)
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
  return tools.create('queue_entries', { sessionId, question, status: 'waiting' })
}

const setStatus: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const entryId = typeof params.entryId === 'string' ? params.entryId : ''
  const status = params.status as EntryStatus
  if (!entryId || !STATUSES.includes(status)) return fail('Invalid request.')

  const entry = await tools.get<QueueEntry>('queue_entries', entryId)
  if (!entry.success) return fail('Entry not found.')

  const session = await tools.get<Session>('sessions', entry.data.record.data.sessionId)
  if (!session.success) return fail('Session not found.')
  if (session.data.record.data.taId !== userId) return fail('Only this session’s TA can do that.')

  return tools.update('queue_entries', entryId, { status })
}

export const actions: Record<string, ActionHandler<Env>> = { joinQueue, setStatus }
