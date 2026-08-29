import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import { createQueryClient } from '@/api/query-client'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'

const router = createBrowserRouter(routes)

/**
 * The provider stack, in the one order that works:
 *
 * `QueryClientProvider` outermost, because `AuthProvider` calls
 * `queryClient.clear()` on sign-out and `setQueryData` on sign-in. `AuthProvider`
 * next, because the router's `RequireAuth` layout reads the session. The router
 * last, because everything below it is a screen.
 */
export function App() {
  // `useState` rather than a module-level constant: a client created at module
  // scope is shared by every test in a file, and a cache that outlives a test is
  // how "passes alone, fails in the suite" starts.
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  )
}
