import clsx, { type ClassValue } from 'clsx'

/** The single class-merge helper every component uses. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
