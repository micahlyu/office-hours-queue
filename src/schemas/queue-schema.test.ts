/**
 * Direct-write permission rules, checked with the same functions the record
 * room runs on every write. (The server actions are covered by tests/queue.spec.ts.)
 */
import { describe, expect, it } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, checkFieldPermissions, lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'
import { queueEntriesSchema, sessionsSchema } from './queue-schema'

const TA = 'user-ta'
const STUDENT = 'user-student'
const OTHER = 'user-other'

const session = { createdBy: TA, data: { title: 'OH', taId: TA, isOpen: true } }
const entry = { createdBy: STUDENT, data: { sessionId: 's1', studentId: STUDENT, question: 'q', status: 'waiting' } }

describe('schema', () => {
  it('passes the SDK schema linter', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })
})

describe('sessions', () => {
  it('signed-in users can read and create; anonymous cannot read', () => {
    expect(canCreate(sessionsSchema, 'member')).toBe(true)
    expect(canRead(sessionsSchema, 'member', session, STUDENT)).toBe(true)
    expect(canRead(sessionsSchema, '*', session, 'anon')).toBe(false)
  })

  it('only the TA can close or rename it', () => {
    expect(canUpdate(sessionsSchema, 'member', session, TA)).toBe(true)
    expect(canUpdate(sessionsSchema, 'member', session, STUDENT)).toBe(false)
    expect(canDelete(sessionsSchema, 'member', session, TA)).toBe(false)
  })

  it('the TA cannot hand the session to someone else', () => {
    expect(checkFieldPermissions(sessionsSchema, 'member', { taId: OTHER }, session.data)).not.toBeNull()
    expect(checkFieldPermissions(sessionsSchema, 'member', { isOpen: false }, session.data)).toBeNull()
  })
})

describe('queue_entries', () => {
  it('students cannot create entries directly (must use joinQueue)', () => {
    expect(canCreate(queueEntriesSchema, 'member')).toBe(false)
  })

  it('a student can edit and delete only their own entry', () => {
    expect(canUpdate(queueEntriesSchema, 'member', entry, STUDENT)).toBe(true)
    expect(canDelete(queueEntriesSchema, 'member', entry, STUDENT)).toBe(true)
    expect(canUpdate(queueEntriesSchema, 'member', entry, OTHER)).toBe(false)
    expect(canDelete(queueEntriesSchema, 'member', entry, OTHER)).toBe(false)
  })

  it('a student can change the question but not the status', () => {
    expect(checkFieldPermissions(queueEntriesSchema, 'member', { question: 'new' }, entry.data)).toBeNull()
    expect(checkFieldPermissions(queueEntriesSchema, 'member', { status: 'done' }, entry.data)).not.toBeNull()
    // Email opt-in is set only through joinQueue.
    expect(checkFieldPermissions(queueEntriesSchema, 'member', { notify: true }, entry.data)).not.toBeNull()
  })

  it('the TA gets no direct write access to entries (status goes through setStatus)', () => {
    expect(canUpdate(queueEntriesSchema, 'member', entry, TA)).toBe(false)
    expect(canDelete(queueEntriesSchema, 'member', entry, TA)).toBe(false)
  })
})
