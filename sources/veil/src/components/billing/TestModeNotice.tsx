import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'

/** The card fields are real inputs on a checkout with no processor behind it,
    so the page has to say that before anyone types into them. */
export function TestModeNotice({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-rose/35 bg-rose/[0.06] p-4', className)}>
      <Badge tone="rose" className="mt-0.5 shrink-0">
        Test mode
      </Badge>
      <p className="text-[12.5px] leading-relaxed text-mist">
        No card is charged and nothing is transmitted. The fields are validated locally, in this tab, and discarded when you leave the page.
      </p>
    </div>
  )
}
