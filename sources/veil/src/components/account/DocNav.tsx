import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

export interface DocSectionLink {
  id: string
  label: string
}

/** Sticky section rail that tracks the reader with an IntersectionObserver, so
    the active marker is derived from scroll position rather than click order. */
export function DocNav({ sections }: { sections: DocSectionLink[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      // A narrow band just under the sticky header decides what counts as "current".
      { rootMargin: '-18% 0px -72% 0px' },
    )
    sections
      .map((section) => document.getElementById(section.id))
      .forEach((node) => node && observer.observe(node))
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav aria-label="Document sections" className="lg:sticky lg:top-24 lg:self-start">
      <p className="mono-label text-dim">on this page</p>
      <ul className="mt-4 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {sections.map((section, index) => {
          const isActive = section.id === active
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors duration-200 lg:rounded-lg',
                  isActive ? 'border-flare/40 bg-flare/10 text-flare' : 'border-line text-dim hover:border-white/20 hover:text-mist',
                )}
              >
                <span className="tabular-nums opacity-60">{String(index + 1).padStart(2, '0')}</span>
                {section.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
