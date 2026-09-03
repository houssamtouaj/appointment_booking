import { Link } from 'react-router-dom'

import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n'

/**
 * A real 404, not a redirect to the landing page. Three of this app's routes are
 * links the backend mails out (F12) — a reset-password token that has been
 * mistyped or truncated by a mail client has to say so, because silently landing
 * on a booking page looks like the link worked.
 */
export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <Container width="copy">
      <div className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
        <p className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          {t('notFound.eyebrow')}
        </p>
        <h1 className="font-display text-display-md text-foreground tracking-display mt-2 leading-tight">
          {t('notFound.title')}
        </h1>
        <p className="text-muted-foreground max-w-copy mt-3 text-base">{t('notFound.body')}</p>
        <Button asChild className="mt-7">
          <Link to="/">{t('notFound.action')}</Link>
        </Button>
      </div>
    </Container>
  )
}
