// Shared job-status color palette. ROYGBIV progression from quoted → paid.
// Lead sits before quoted (the "quote-not-yet-built" state from a public
// intake) and gets a hot pink so it visually outranks even red — those are
// the newest things needing attention. Used by Jobs, Schedule, and any
// future surface that needs status-aware chips.
export function statusColor(s?: string): string {
  switch (s) {
    case "lead":       return "#ff3d6e"; // hot pink — new prospect
    case "quoted":     return "#C00000"; // red
    case "accepted":   return "#ff8800"; // orange
    case "scheduled":  return "#ffcc00"; // yellow
    case "active":     return "#00cc66"; // green
    case "complete":   return "#2E75B6"; // blue
    case "invoiced":   return "#6a3de8"; // indigo
    case "paid":       return "#9d4edd"; // violet
    case "inspection": return "#888";
    default:           return "#888";
  }
}
