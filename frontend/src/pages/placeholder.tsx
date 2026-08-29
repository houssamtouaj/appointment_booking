import { Hammer } from 'lucide-react'

import { Container } from '@/components/container'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

type PlaceholderProps = {
  eyebrow: string
  title: string
  /** The wave that replaces this stub, so the shell says what it is waiting for. */
  wave: string
  description?: string
}

/**
 * Every route in the table renders one of these until the wave that owns it
 * arrives. Writing the whole table in wave 1 means wave 3 adds a screen rather
 * than making a routing decision under deadline.
 */
export function Placeholder({ eyebrow, title, wave, description }: PlaceholderProps) {
  return (
    <Container>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState
        icon={Hammer}
        title="This screen has not been built yet"
        description={`The route, the shell and the design system are in place. ${wave} fills it in.`}
      />
    </Container>
  )
}
