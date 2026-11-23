/**
 * Office Hours Queue: collections and their server-enforced permissions.
 *
 * The RecordRoom checks these rules on every read and write and filters data
 * before it leaves the server, so the UI never has to be trusted.
 *
 * Rule that RBAC can't express ("only the TA of *this entry's session*") lives
 * in server actions instead: see src/actions/index.ts.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const QUESTION_MAX = 200
export const TITLE_MAX = 80

export type EntryStatus = 'waiting' | 'helping' | 'done' | 'skipped'

export type Session = {
  title: string
  taId: string
  isOpen: boolean
}

export type QueueEntry = {
  sessionId: string
  studentId: string
  question: string
  status: EntryStatus
  /** Student opted in to an email when the TA starts helping them. */
  notify: boolean
}

// Signed-in users who aren't app admins are 'member' (or 'viewer'); both get the same rules.
const signedIn = <T>(rules: T) => ({ viewer: rules, member: rules, admin: rules })

export const sessionsSchema: CollectionSchema = {
  name: 'sessions',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: TITLE_MAX },
    // userBound: the server stamps the creator's id here and ignores whatever the client sends.
    { name: 'taId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'isOpen', storage: 'number', interpretation: { kind: 'boolean' }, default: true },
  ],
  ownerField: 'taId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    ...signedIn({
      read: true,
      create: true,
      // Only the session's TA can rename or close/reopen it.
      update: 'own' as const,
      delete: false,
      writableFields: ['title', 'isOpen'],
    }),
  },
}

export const queueEntriesSchema: CollectionSchema = {
  name: 'queue_entries',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'sessions', displayColumn: 'title' }, required: true, immutable: true },
    { name: 'studentId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'question', storage: 'text', interpretation: 'plain', required: true, maxLength: QUESTION_MAX },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['waiting', 'helping', 'done', 'skipped'] }, default: 'waiting' },
    // Set only by joinQueue (not in writableFields), so nobody can opt someone else in to email.
    { name: 'notify', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
  ],
  ownerField: 'studentId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    ...signedIn({
      read: true,
      // Joining goes through the joinQueue action (checks the session is open, one entry per student).
      create: false,
      // A student may edit only the question on their own entry, never its status.
      update: 'own' as const,
      // Leaving the queue = deleting your own entry.
      delete: 'own' as const,
      writableFields: ['question'],
    }),
  },
}
