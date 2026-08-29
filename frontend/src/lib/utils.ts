import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes, last-wins on conflicts.
 *
 * The shadcn convention, kept because every atom pulled in by `shadcn add`
 * imports it by this name from this path.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
