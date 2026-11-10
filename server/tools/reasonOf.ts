/** The text that says why something failed, for a console message, whatever was thrown. */
export const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err))
