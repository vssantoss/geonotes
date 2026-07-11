/**
 * Empty list state drawn as a topographic sketch: faint contour rings with
 * a map pin where the user stands, and the message underneath.
 *
 * @param message - what to tell the user (why the list is empty, what to do).
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-8 py-14 text-center">
      <svg
        viewBox="0 0 220 150"
        className="w-44 text-muted-foreground/35"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        {/* Contour rings, slightly irregular like a topographic map. */}
        <path d="M110 58c9 0 16 6 16 14s-8 15-17 15-15-7-15-14 7-15 16-15Z" />
        <path d="M112 42c18-1 33 12 34 28 1 17-15 31-35 32-20 1-37-12-38-28-1-17 18-31 39-32Z" />
        <path d="M109 26c28-2 54 17 56 42 2 26-21 48-53 50-32 2-59-16-61-41-2-26 25-49 58-51Z" />
        <path d="M107 10c38-3 74 22 77 55 2 28-19 53-52 62" strokeLinecap="round" />
        {/* The pin: you are here. */}
        <path
          d="M110 82c-7-8-10-13-10-18a10 10 0 1 1 20 0c0 5-3 10-10 18Z"
          className="fill-primary/90 stroke-none"
        />
        <circle cx="110" cy="63" r="3.5" className="fill-background stroke-none" />
      </svg>
      <p className="max-w-60 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
