import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'

interface RevealProps {
  children: ReactNode
  delay?: number
  className?: string
  /** Distance travelled, in pixels. */
  distance?: number
}

/** Scroll-triggered entrance used across the marketing pages. */
export function Reveal({ children, delay = 0, className, distance = 18 }: RevealProps) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
