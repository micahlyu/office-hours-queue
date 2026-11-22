/**
 * Landing page at "/": a STATIC page (top level of src/pages/), so it loads
 * no auth session and opens no realtime connection. It is also prerendered to
 * HTML at build time for crawlers and link previews (values from src/seo.ts).
 * The app itself starts at /home, which asks visitors to sign in.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  { title: 'TA opens a session', body: 'Sign in, name the session, and copy its link into chat or the slides.' },
  { title: 'Students join the queue', body: 'Open the link, sign in, and add one line about what you need help with.' },
  { title: 'Everyone sees it live', body: 'The TA marks who they’re helping, done, or skipped, and every screen updates at once.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">{APP_NAME}</p>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Office hours without the hallway line.
        </h1>
        <p className="mb-8 max-w-xl text-lg text-muted-foreground">
          A live queue for TAs and students. Share one link, take questions in order, and nobody has to wonder if
          they were forgotten.
        </p>
        <div>
          <Link
            to="/home"
            className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in and start
          </Link>
        </div>

        <ol className="mt-14 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border border-border p-5">
              <p className="mb-2 text-sm font-semibold text-muted-foreground">{i + 1}</p>
              <h2 className="mb-1 font-semibold text-foreground">{step.title}</h2>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-muted-foreground">
          Only a session’s TA can change the queue or close it; students can only edit or leave their own spot.
          Those rules are checked on the server, not just hidden in the page.
        </p>
      </div>
    </>
  )
}
