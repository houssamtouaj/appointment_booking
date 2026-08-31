import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The centred dialog the admin screens put forms in.
 *
 * Wave 4's `CancelDialog` is an `AlertDialog` and wave 6's `BookingSheet` is a
 * side sheet, and neither is what a form wants: an alert dialog is for a question
 * that cannot be undone and refuses to be dismissed casually, and a sheet is for
 * reading a record beside the thing it belongs to. A form is a task with a Cancel
 * on it, so it is a plain `Dialog`, centred, scrollable, and it closes on Escape
 * and on the overlay.
 *
 * Three of them exist in wave 7 — new service, invite a colleague, edit a
 * colleague — which is exactly the number at which the shell stops being worth
 * copying. What it guarantees, and what is easy to forget on the third copy:
 * a `Dialog.Title` and a `Dialog.Description` both exist and are both wired to
 * the content (Radix warns about the second and is right — a dialog with no
 * description announces its heading and then silence), the panel never exceeds
 * the viewport, and its body scrolls rather than the page behind it.
 */

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /**
   * What this dialog is for, in one sentence. Read out after the title, so it
   * must say something the title does not.
   */
  description: string
  /** The actions. Right-aligned above 640px, stacked and full-width below it. */
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: ModalProps) {
  const content = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bg-scrim fixed inset-0 z-40" />
        <Dialog.Content
          ref={content}
          /**
           * Focus the field marked `data-first-field`, if the body has one.
           *
           * Radix's own default puts focus on the first tabbable element inside
           * the panel, which here is the Close button in the header — correct for
           * a panel you read, wrong for a form you fill in, where it costs a Tab
           * before anybody can type.
           *
           * `autoFocus` on the input would be the obvious fix and is a lint error
           * on purpose: on a *page*, moving focus without being asked steals it
           * from whatever the person was doing and skips past everything above
           * the field. Inside a dialog neither applies — focus has just been
           * moved into the panel by definition, and the field is the first thing
           * in it. So the behaviour lives here, once, where that argument is
           * true, rather than as a rule disabled at three call sites.
           */
          onOpenAutoFocus={(event) => {
            const first = content.current?.querySelector<HTMLElement>('[data-first-field]')
            if (!first) return
            event.preventDefault()
            first.focus()
          }}
          className={cn(
            'bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            // `max-h` with the body scrolling inside: a form with eight fields on
            // a 375px phone is taller than the viewport, and a dialog that
            // overflows the window puts its submit button somewhere unreachable.
            'flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col',
            'shadow-e3 rounded-lg border',
            className,
          )}
        >
          <header className="border-rule flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-display-sm text-foreground leading-tight">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="border-rule flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
