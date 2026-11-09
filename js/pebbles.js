import { hexToRgba } from './format.js?v=66';

// Shared "pebble" node look (v65 Menu, reused by the Projects page). The
// shapes themselves are CSS (.menu-blob-0 … .menu-blob-7 in styles.css); these
// are the bits of markup both pages build the same way.

// How many .menu-blob-N shape presets exist — cycle through them by index so
// neighbouring pebbles never share the exact same outline.
export const BLOB_PRESET_COUNT = 8;

// The per-node color custom properties .menu-node-channel's border reads: dim
// at rest, strong on hover. The fill stays the neutral --surface2 always.
// `fullStrength` is for a color too dark to survive the usual dimming
// (Research's).
export function pebbleColorVars(hex, fullStrength = false) {
  const dimAlpha = fullStrength ? 1 : 0.35;
  return ` --node-color:${hex}; --node-color-dim:${hexToRgba(hex, dimAlpha)}; --node-color-strong:${hexToRgba(hex, 0.85)};`;
}

// Translucent first-letter "block letter" watermark, behind a node's own label
// (earlier in DOM order, so no z-index needed) — see .menu-node-letter. Empty
// for a label with no leading letter (the `???` placeholders).
export function letterHtml(label, hex) {
  const letter = /^[A-Za-z]/.test(label) ? label[0].toUpperCase() : null;
  if (!letter) return '';
  return `<span class="menu-node-letter" style="color:${hex};" aria-hidden="true">${letter}</span>`;
}
