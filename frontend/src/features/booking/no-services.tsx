import { CalendarPlus } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'

/**
 * A business with an empty catalogue, said the same way on both screens that
 * can meet one.
 *
 * `/b/:slug` and `/b/:slug/book` render the same payload, so a customer who
 * follows a direct booking link must not get a bare "What are you booking?"
 * above nothing where the landing page explains itself. One component rather
 * than the copy twice: this is the state where the page has nothing to offer,
 * and it should not be able to say two different things about it.
 *
 * No way out is offered, deliberately. There is nowhere useful to send anyone —
 * the business page is what the header already links to, and the honest answer
 * is that this business has published nothing to book.
 */
export function NoServices({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={CalendarPlus}
      title="Nothing is bookable here yet"
      description="This business has not published any services. Check back, or get in touch with them directly."
    />
  )
}
