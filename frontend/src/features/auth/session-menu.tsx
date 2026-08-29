import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/use-auth'

/**
 * The right-hand end of the header: who is signed in, and the way out.
 *
 * Wave 5 replaces this with the admin nav's account menu. Until then it is what
 * makes the exit demo checkable — "sign in as demo, see the user's name" needs
 * the name to be somewhere.
 */
export function SessionMenu() {
  const { status, user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [leaving, setLeaving] = useState(false)

  // Nothing during the bootstrap. A "Log in" link that appears for one round
  // trip and then turns into a name is worse than a gap the same width.
  if (status === 'loading') return <span className="h-8 w-px" aria-hidden="true" />

  if (status === 'anonymous') {
    // Don't offer a link to the page you are on.
    if (location.pathname === '/login') return null
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to="/login">Log in</Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm sm:inline">
        <span className="text-foreground font-medium">{user?.fullName}</span>
        <span className="text-muted-foreground"> · {user?.business.name}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true)
          try {
            await signOut()
            toast.success('Signed out')
            navigate('/login', { replace: true })
          } finally {
            setLeaving(false)
          }
        }}
      >
        {leaving ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  )
}
