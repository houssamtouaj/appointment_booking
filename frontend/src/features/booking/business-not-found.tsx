import { SearchX } from 'lucide-react'

import { Container } from '@/components/container'

type BusinessNotFoundProps = {
  slug: string
}

/**
 * `/b/unknown-slug` — a designed screen, not a crash and not a redirect.
 *
 * This URL is the one a business pastes into a message, a bio or a QR code, so
 * the ways it arrives broken are mundane: a typo, a mail client that cut it, a
 * business that changed its slug. Each of those deserves to be told what
 * happened. Redirecting to the demo tenant instead would be worse than a blank
 * page, because it looks like the link worked.
 *
 * The slug is echoed back, quoted, because "demo-salón" and "demo-salon" are
 * indistinguishable in a sentence and obvious side by side.
 */
export function BusinessNotFound({ slug }: BusinessNotFoundProps) {
  return (
    <Container width="copy">
      <div className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <span className="bg-muted text-muted-foreground mb-5 inline-flex size-11 items-center justify-center rounded-sm">
          <SearchX className="size-5" aria-hidden="true" />
        </span>
        <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          Error 404
        </p>
        <h1 className="font-display text-display-md text-foreground tracking-display mt-2 leading-tight">
          No business here
        </h1>
        <p className="text-muted-foreground max-w-copy mt-3 text-base">
          Nothing is published at{' '}
          <code className="text-foreground bg-muted rounded-xs px-1.5 py-0.5 font-mono text-sm">
            /b/{slug}
          </code>
          . Check the link for a typo, or ask the business for a fresh one — some mail clients cut
          long links in half.
        </p>
      </div>
    </Container>
  )
}
