import { Outlet, ScrollRestoration } from 'react-router-dom'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { Toaster } from '@/components/ui/Toaster'

export function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <Toaster />
      <ScrollRestoration />
    </div>
  )
}

/** Full-bleed shell for the editor, which owns the viewport. */
export function WorkspaceLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <Toaster />
      <ScrollRestoration />
    </div>
  )
}
