import { Link } from 'react-router-dom'

import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'

/**
 * A real 404, not a redirect to the landing page. Three of this app's routes are
 * links the backend mails out (F12) — a reset-password token that has been
 * mistyped or truncated by a mail client has to say so, because silently landing
 * on a booking page looks like the link worked.
 */
export function NotFoundPage() {
  return (
    <Container width="copy">
      <div className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          Error 404
        </p>
        <h1 className="font-display text-display-md text-foreground tracking-display mt-2 leading-tight">
          No such page
        </h1>
        <p className="text-muted-foreground max-w-copy mt-3 text-base">
          The link may be incomplete. Links sent by email expire, and some mail clients cut long
          ones in half — if you followed one, request a fresh link.
        </p>
        <Button asChild className="mt-7">
          <Link to="/">Go to the booking page</Link>
        </Button>
      </div>
    </Container>
  )
}
