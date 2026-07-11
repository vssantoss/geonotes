import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges Tailwind class lists, resolving conflicts (shadcn/ui convention).
 *
 * @param inputs - class values (strings, arrays, conditionals).
 * @returns the merged class string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
