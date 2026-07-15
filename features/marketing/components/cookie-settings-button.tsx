"use client";

// A plain text button (for the footer) that reopens the cookie preferences.
// It talks to <CookieConsent /> through a window event, so the two can sit in
// different parts of the tree without prop-drilling a shared store.
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("swamp:cookie-settings"))}
      className={className}
    >
      Cookie settings
    </button>
  );
}
