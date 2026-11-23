/**
 * /s/<sessionId>: the shareable session room.
 *
 * Everyone sees the same live queue (useQuery streams changes over the record
 * room's WebSocket). What you can *do* depends on who you are:
 *   - the session's TA: share link, mark helping/done/skip, close or reopen,
 *     and ask AI to group similar waiting questions;
 *   - a student: join with one question (optionally asking for an email when
 *     it's their turn), edit it, or leave.
 * The buttons are just UI: every one of these is re-checked on the server
 * (schema permissions in src/schemas/queue-schema.ts, or src/actions/index.ts).
 */

import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useMutations, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Badge, Button, Checkbox, Input, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import type { QuestionGroup } from '@/actions/group-questions'
import { QUESTION_MAX, type EntryStatus, type QueueEntry, type Session } from '../../../../schemas/queue-schema'

const ACTIVE: EntryStatus[] = ['helping', 'waiting']

// Display text only; the stored status values stay lowercase.
const STATUS_LABEL: Record<EntryStatus, string> = {
  waiting: 'Waiting',
  helping: 'Helping',
  done: 'Done',
  skipped: 'Skipped',
}

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const toast = useToast()

  // shortcut: loads every session and picks one; fine at class scale, switch to a recordId filter if sessions grow large.
  const { records: sessions, status: sessionsStatus } = useQuery<Session>('sessions')
  const session = sessions.find((s) => s.recordId === sessionId)

  const { records: entries } = useQuery<QueueEntry>('queue_entries', {
    where: { sessionId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const sessionMutations = useMutations<Session>('sessions')
  const entryMutations = useMutations<QueueEntry>('queue_entries')

  if (sessionsStatus === 'loading') return <p className="p-10 text-center text-muted-foreground">Loading…</p>
  if (!session) {
    return (
      <div className="p-10 text-center">
        <p className="mb-4 text-muted-foreground">This session doesn’t exist.</p>
        <Link to="/home" className="underline">Go home</Link>
      </div>
    )
  }

  const isTA = session.data.taId === userId
  const active = entries
    .filter((e) => ACTIVE.includes(e.data.status))
    // Whoever is being helped stays on top; everyone else in join order.
    .sort((a, b) => ACTIVE.indexOf(a.data.status) - ACTIVE.indexOf(b.data.status))
  const finished = entries.filter((e) => !ACTIVE.includes(e.data.status))
  const myEntry = active.find((e) => e.data.studentId === userId)
  const waiting = active.filter((e) => e.data.status === 'waiting')
  const myPosition = myEntry ? waiting.indexOf(myEntry) + 1 : 0

  // Runs a write and shows the server's refusal (if any) as a toast.
  const attempt = (label: string) => async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      toast.error(label, err instanceof Error ? err.message : undefined)
    }
  }

  const setStatus = (entryId: string, status: EntryStatus) =>
    attempt('Could not update entry')(() => callAction('setStatus', { entryId, status }))

  const toggleOpen = () =>
    attempt('Could not update session')(() =>
      sessionMutations.putConfirmed(sessionId, { isOpen: !session.data.isOpen }),
    )

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{session.data.title}</h1>
          <Badge variant={session.data.isOpen ? 'success' : 'secondary'}>
            {session.data.isOpen ? 'Open' : 'Closed'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          TA: {getName(session.data.taId) ?? 'Unknown'} · {waiting.length} waiting
        </p>
      </header>

      {isTA && <TAControls session={session} onToggleOpen={toggleOpen} ready={sessionMutations.ready} />}
      {isTA && waiting.length >= 2 && <QuestionGroups sessionId={sessionId} waiting={waiting} />}

      {!isTA && !myEntry && session.data.isOpen && <JoinForm sessionId={sessionId} />}
      {!isTA && !myEntry && !session.data.isOpen && (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          This session is closed and isn’t taking new questions.
        </p>
      )}
      {myEntry && (
        <MyEntry
          entry={myEntry}
          position={myPosition}
          ready={entryMutations.ready}
          onSave={(question) =>
            attempt('Could not save')(() => entryMutations.putConfirmed(myEntry.recordId, { question }))
          }
          onLeave={() => attempt('Could not leave')(() => entryMutations.removeConfirmed(myEntry.recordId))}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Queue</h2>
        {active.length === 0 && <p className="text-sm text-muted-foreground">Nobody is waiting.</p>}
        <ol className="divide-y divide-border rounded-md border border-border">
          {active.map((e) => (
            <li key={e.recordId} className="flex items-start gap-3 px-4 py-3" data-testid="queue-entry" data-entry-id={e.recordId}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {getName(e.data.studentId) ?? 'Student'}
                  {e.data.studentId === userId && ' (you)'}
                  {e.data.status === 'helping' && <Badge variant="info" className="ml-2">Being helped</Badge>}
                </p>
                <p className="break-words text-sm text-muted-foreground">{e.data.question}</p>
              </div>
              {isTA && (
                <div className="flex shrink-0 gap-1">
                  {e.data.status === 'waiting' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(e.recordId, 'helping')}>Help</Button>
                  )}
                  <Button size="sm" onClick={() => setStatus(e.recordId, 'done')}>Done</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(e.recordId, 'skipped')}>Skip</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {isTA && finished.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Finished</h2>
          <ul className="divide-y divide-border rounded-md border border-border">
            {finished.map((e) => (
              <li key={e.recordId} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1 truncate">
                  {getName(e.data.studentId) ?? 'Student'}: {e.data.question}
                </span>
                <Badge variant={e.data.status === 'done' ? 'success' : 'secondary'}>{STATUS_LABEL[e.data.status]}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setStatus(e.recordId, 'waiting')}>Requeue</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TAControls(props: { session: RecordData<Session>; onToggleOpen: () => void; ready: boolean }) {
  const { success } = useToast()
  const link = `${window.location.origin}/s/${props.session.recordId}`
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <Input readOnly value={link} aria-label="Share link" className="w-full min-w-0 sm:w-auto sm:flex-1" onFocus={(e) => e.target.select()} />
      <Button
        variant="outline"
        onClick={() => navigator.clipboard.writeText(link).then(() => success('Link copied'))}
      >
        Copy link
      </Button>
      <Button variant={props.session.data.isOpen ? 'destructive' : 'secondary'} disabled={!props.ready} onClick={props.onToggleOpen}>
        {props.session.data.isOpen ? 'Close session' : 'Reopen'}
      </Button>
    </div>
  )
}

function JoinForm({ sessionId }: { sessionId: string }) {
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const [notify, setNotify] = useState(false)
  const [busy, setBusy] = useState(false)

  async function join(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await callAction('joinQueue', { sessionId, question, notify })
      setQuestion('')
    } catch (err) {
      toast.error('Could not join', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={join} className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label="Your question"
          placeholder="What do you need help with? (one line)"
          value={question}
          maxLength={QUESTION_MAX}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" disabled={busy || !question.trim()}>Join queue</Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={notify} onCheckedChange={setNotify} />
        Email me when it’s my turn
      </label>
    </form>
  )
}

function MyEntry(props: {
  entry: RecordData<QueueEntry>
  position: number
  ready: boolean
  onSave: (question: string) => void
  onLeave: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.entry.data.question)
  const helping = props.entry.data.status === 'helping'

  function save(e: FormEvent) {
    e.preventDefault()
    props.onSave(draft.replace(/\s+/g, ' ').trim())
    setEditing(false)
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">
        {helping ? 'Your TA is helping you now.' : `You’re #${props.position} in line.`}
      </p>
      {editing ? (
        <form onSubmit={save} className="flex gap-2">
          <Input aria-label="Edit your question" value={draft} maxLength={QUESTION_MAX} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <Button type="submit" disabled={!props.ready || !draft.trim()}>Save</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <p className="flex-1 break-words text-sm">{props.entry.data.question}</p>
          <Button size="sm" variant="outline" onClick={() => { setDraft(props.entry.data.question); setEditing(true) }}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={!props.ready} onClick={props.onLeave}>Leave</Button>
        </div>
      )}
    </div>
  )
}

/** TA-only: ask the server to group waiting questions by topic (AI integration). A snapshot, refreshed on click. */
function QuestionGroups({ sessionId, waiting }: { sessionId: string; waiting: RecordData<QueueEntry>[] }) {
  const toast = useToast()
  const { getName } = useUserLookup()
  const [groups, setGroups] = useState<QuestionGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const byId = new Map(waiting.map((e) => [e.recordId, e]))

  async function run() {
    setBusy(true)
    try {
      setGroups((await callAction<{ groups: QuestionGroup[] }>('groupQuestions', { sessionId })).groups)
    } catch (err) {
      toast.error('Could not group questions', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-3" data-testid="question-groups">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Similar questions</h2>
        <Button size="sm" variant="outline" onClick={run} loading={busy} disabled={busy}>
          {groups ? 'Regroup' : 'Group similar questions'}
        </Button>
      </div>
      {groups && (
        <ul className="space-y-2">
          {groups.map((g, i) => {
            // Entries helped or removed since the snapshot drop out.
            const items = g.ids.flatMap((id) => byId.get(id) ?? [])
            if (!items.length) return null
            return (
              <li key={i} className="text-sm" data-testid="question-group">
                <p className="font-medium">
                  {g.topic} <span className="text-muted-foreground">({items.length})</span>
                </p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {items.map((e) => (
                    <li key={e.recordId} className="break-words">
                      {getName(e.data.studentId) ?? 'Student'}: {e.data.question}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Groups are suggested by AI from the waiting questions.</p>
    </section>
  )
}
