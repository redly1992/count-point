// The original vanilla app has no persistent navigation chrome — each
// screen is a full-bleed fixed div toggled via showScreen(). React Router
// gives us that same "one screen visible at a time" behavior for free, so
// this shell intentionally renders nothing but the active route.
export function AppShell({ children }) {
  return <>{children}</>;
}
