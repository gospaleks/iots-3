/**
 * Footer caption — wording preserved from the previous inline footer so the
 * UI string stays identical.
 */
export interface DashboardFooterProps {
  pollMs: number
}

export function DashboardFooter({ pollMs }: DashboardFooterProps) {
  return (
    <footer className="text-center text-xs text-muted-foreground">
      Read-only monitor · polling every {pollMs / 1000}s · optional, off the
      benchmark path
    </footer>
  )
}
