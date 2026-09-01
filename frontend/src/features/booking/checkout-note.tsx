import type { BookingStatus } from '@/types'

/**
 * The sentence Stripe's redirect earns, and the limit of what it earns.
 *
 * `?checkout=success` on a booking that is still `PENDING` says "we are checking
 * with your bank", never "paid". `?checkout=success` on a `CANCELLED` or expired
 * one says nothing at all — the status heading above already tells the truth,
 * and a thank-you over it would be the worst version of this screen.
 */
export function CheckoutNote({
  checkout,
  status,
  holdExpired,
}: {
  checkout: string | null
  status: BookingStatus
  holdExpired: boolean
}) {
  if (checkout !== 'success' && checkout !== 'cancelled') return null
  // "Expired" is the case the paragraph above names and the one both sentences
  // below would get wrong: "your slot is still held" is false, and thanking
  // somebody for a payment that did not arrive in time is worse.
  if (holdExpired) return null

  if (checkout === 'cancelled') {
    if (status !== 'PENDING') return null
    return (
      <p role="status" className="bg-muted text-foreground mb-6 rounded-sm px-3 py-2 text-sm">
        No problem — you did not pay, and your slot is still held. You can pick up where you left
        off below.
      </p>
    )
  }

  if (status === 'CONFIRMED') {
    return (
      <p role="status" className="bg-primary-wash text-primary mb-6 rounded-sm px-3 py-2 text-sm">
        Thank you — your deposit came through.
      </p>
    )
  }

  if (status === 'PENDING') {
    return (
      <p role="status" className="bg-warning-wash text-warning mb-6 rounded-sm px-3 py-2 text-sm">
        Thanks. We are waiting for your bank to confirm the payment — this page updates itself.
      </p>
    )
  }

  return null
}
