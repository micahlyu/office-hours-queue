/**
 * /home: a TA creates a session room here and sees the sessions they run.
 * Students normally skip this page: they arrive on a /s/<sessionId> link from their TA.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useMutations, useQuery } from 'deepspace'
import { Badge, Button, Input, useToast } from '@/components/ui'
import { TITLE_MAX, type Session } from '../../../schemas/queue-schema'

export default function HomePage() {
  const { userId } = useAuth()
  const navigate = useNavigate()
  const { error } = useToast()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const sessions = useMutations<Session>('sessions')
  const { records: mine, status } = useQuery<Session>('sessions', {
    where: { taId: userId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })

  async function createSession(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      // taId is filled in by the server (userBound), so we don't send our own id.
      const id = await sessions.createConfirmed({ title: title.trim(), isOpen: true } as Session)
      navigate(`/s/${id}`)
    } catch (err) {
      error('Could not create session', err instanceof Error ? err.message : undefined)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Office Hours Queue</h1>
        <p className="text-sm text-muted-foreground">
          Start a session, share its link with your students, and help them in order.
        </p>
        <form onSubmit={createSession} className="flex gap-2">
          <Input
            aria-label="Session title"
            placeholder="e.g. CS 61A, Tuesday office hours"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" disabled={!sessions.ready || busy || !title.trim()}>
            Start session
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Your sessions</h2>
        {status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
        {status === 'ready' && mine.length === 0 && (
          <p className="text-sm text-muted-foreground">You haven’t started any sessions yet.</p>
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {mine.map((s) => (
            <li key={s.recordId}>
              <Link to={`/s/${s.recordId}`} className="flex items-center justify-between px-4 py-3 hover:bg-accent">
                <span>{s.data.title}</span>
                <Badge variant={s.data.isOpen ? 'success' : 'secondary'}>{s.data.isOpen ? 'Open' : 'Closed'}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
