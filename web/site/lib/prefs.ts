// Per-browser playback preferences. Nothing here is a money or access fact —
// these only remember what the viewer last chose in the player.

const CAPTIONS_KEY = "katha.captions.v1";
export const CAPTIONS_OFF = "off";

/** The caption language the viewer last chose, "off", or null when never chosen. */
export function getCaptionPref(): string | null {
  try { return localStorage.getItem(CAPTIONS_KEY); } catch { return null; }
}
export function setCaptionPref(lang: string) {
  try { localStorage.setItem(CAPTIONS_KEY, lang); } catch { /* ignore */ }
}
