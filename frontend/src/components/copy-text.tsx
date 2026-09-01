import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CopyTextProps = {
  /** The exact string a person needs to keep. Shown in full, never truncated in the DOM. */
  value: string
  /** Names the button for a screen reader: "Copy your booking link". */
  label: string
  className?: string
}

/**
 * A string shown as text, with a button that copies it.
 *
 * **The text is the point, and the button is the convenience** — which is the
 * opposite of how this control is usually built. The manage link is the only
 * credential a customer will ever have for their booking (backend D1: there is
 * no account), so it has to be readable, selectable and transcribable by
 * somebody whose clipboard is blocked, whose browser is old, or who is reading
 * this on a phone and writing it on paper. A copy button alone would put the one
 * thing they cannot afford to lose behind an API that silently does nothing on
 * an insecure origin.
 *
 * `select-all` makes a click select the whole value, so the manual path is one
 * gesture rather than a careful drag across a URL with no spaces in it.
 *
 * The confirmation is `role="status"` rather than a toast: it belongs beside the
 * thing that was copied, and a toast in the corner is a message about a button
 * rather than about the link.
 */
export function CopyText({ value, label, className }: CopyTextProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // Cleared on unmount, because this component sits on a screen people leave the
  // moment they have what they came for, and a timer that fires into an
  // unmounted tree is a warning in the console at best.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      // Absent on an insecure origin and in some embedded browsers. The value is
      // on screen either way, which is why failing here is quiet — but quiet
      // means *nothing*, not "Copied". This was `await navigator.clipboard?.…`,
      // which resolves to `undefined` when there is no clipboard and then
      // announced a copy that never happened: the exact silent failure the doc
      // above says a copy-button-only control would have.
      if (!navigator.clipboard) return
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={cn('flex items-stretch gap-2', className)}>
      <code
        className={cn(
          'border-border bg-muted text-foreground min-w-0 flex-1 rounded-sm border',
          'px-3 py-2 font-mono text-xs break-all select-all',
        )}
      >
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto shrink-0"
        onClick={() => void copy()}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        <span>{copied ? 'Copied' : 'Copy'}</span>
        <span className="sr-only"> — {label}</span>
      </Button>
      {/* Announced without stealing focus from the button that was just pressed. */}
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  )
}
