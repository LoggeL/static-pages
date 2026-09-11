import { createHashRouter, RouterProvider } from 'react-router-dom'
import { SiteLayout, WorkspaceLayout } from '@/components/chrome/SiteLayout'
import Landing from '@/routes/Landing'
import Studio from '@/routes/Studio'
import Pricing from '@/routes/Pricing'
import Checkout from '@/routes/Checkout'
import Account from '@/routes/Account'
import Library from '@/routes/Library'
import Legal from '@/routes/Legal'
import NotFound from '@/routes/NotFound'

/** Hash routing keeps every route shareable and refreshable when the app is
    served from a static subdirectory where no server can rewrite deep links. */
const router = createHashRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/pricing', element: <Pricing /> },
      { path: '/checkout', element: <Checkout /> },
      { path: '/account', element: <Account /> },
      { path: '/library', element: <Library /> },
      { path: '/legal/:doc', element: <Legal /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    element: <WorkspaceLayout />,
    children: [{ path: '/studio', element: <Studio /> }],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
