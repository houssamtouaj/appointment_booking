import { Container } from '@/components/container'

type AuthLayoutProps = {
  eyebrow: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** The "no account? register" line under the card. */
  footer?: React.ReactNode
}

/**
 * The shell all five account screens sit in.
 *
 * One card, narrow, and the page's own ruled line under the title rather than
 * the full `PageHeader` — these screens have no actions and no eyebrow-plus-
 * button row to justify it, and a header built for a data screen looks
 * over-dressed on a form with two inputs.
 */
export function AuthLayout({ eyebrow, title, description, children, footer }: AuthLayoutProps) {
  return (
    <Container width="copy" className="max-w-md py-12 sm:py-16">
      <p className="text-muted-foreground text-2xs tracking-eyebrow mb-1 font-mono uppercase">
        {eyebrow}
      </p>
      <h1 className="font-display text-display-sm text-foreground tracking-display leading-tight">
        {title}
      </h1>
      {description ? <p className="text-muted-foreground mt-2 text-sm">{description}</p> : null}

      {/* The same rule the page header draws, at card width. */}
      <div className="mt-5 mb-8 flex items-center" aria-hidden="true">
        <span className="bg-primary h-px w-10 shrink-0" />
        <span className="bg-rule h-px flex-1" />
      </div>

      {children}

      {footer ? <div className="text-muted-foreground mt-8 text-sm">{footer}</div> : null}
    </Container>
  )
}
