import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { LogoMark } from '@/components/brand/Logo'

export default function NotFound() {
  return (
    <div className="relative flex min-h-[70vh] items-center overflow-hidden px-5 py-20 sm:px-8">
      <div className="grid-field pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(circle_at_50%_35%,black,transparent_72%)]" aria-hidden="true" />
      <div className="relative mx-auto max-w-md text-center">
        <LogoMark className="mx-auto size-10" />
        <p className="mono-label mt-7 text-flare">error 404</p>
        <h1 className="mt-4 text-[32px] font-semibold leading-[1.1] sm:text-4xl">Nothing is behind this frame.</h1>
        <p className="mt-5 text-[14.5px] leading-relaxed text-mist">That page does not exist. The studio and the credits are still where you left them.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/studio">
            <Button>Open the studio</Button>
          </Link>
          <Link to="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
