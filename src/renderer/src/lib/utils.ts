import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merge conditional class lists and de-conflict Tailwind utilities (shadcn convention).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
