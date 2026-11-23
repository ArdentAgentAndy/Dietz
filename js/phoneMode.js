// Phone mode: a per-device layout switch (the phone button next to the
// Settings cog). Stored in this browser's localStorage only, never in the
// synced tables, so turning it on on the phone doesn't touch the laptop.
// When on, <html> gets the `phone-mode` class and the phone layouts in
// css/styles.css (written as `.phone-mode ...` rules) apply.
//
// Until the button is used on a device, it follows the screen: on for a
// phone-sized screen (same 700px breakpoint the CSS already used), off
// otherwise. The first click stores an explicit on/off for this device.
//
// index.html has an inline copy of applyPhoneMode's first-paint logic in
// <head>, so the class is set before the page draws (no flash of the
// laptop layout on a phone). Keep the two in step.

const KEY = 'dietz:phoneMode';
const AUTO_QUERY = '(max-width: 700px)';

function storedChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

// What this device has chosen (or would get automatically).
function wantsPhoneMode() {
  const choice = storedChoice();
  if (choice) return choice === 'on';
  return window.matchMedia(AUTO_QUERY).matches;
}

// Whether the phone layout is what's showing right now — read off the page
// itself, so pages always agree with the layout actually on screen.
export function isPhoneMode() {
  return document.documentElement.classList.contains('phone-mode');
}

// A keybind hint like "[H] " on a button, wrapped so phone mode can hide it
// (styles.css's .kbd-hint; no keyboard there). Unchanged on the laptop.
export function kbd(key) {
  return `<span class="kbd-hint">[${key}]</span> `;
}

function applyPhoneMode() {
  const on = wantsPhoneMode();
  document.documentElement.classList.toggle('phone-mode', on);
  const btn = document.getElementById('phone-mode-btn');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    const auto = storedChoice() ? '' : ' (automatic for this screen)';
    btn.title = `Phone mode: ${on ? 'on' : 'off'}${auto}. Click to turn ${on ? 'off' : 'on'} on this device only.`;
  }
  // Pages that size things in JS (e.g. Today's stopwatch columns) can listen for this.
  window.dispatchEvent(new CustomEvent('phonemodechange', { detail: { on } }));
}

export function initPhoneMode() {
  applyPhoneMode();
  document.getElementById('phone-mode-btn')?.addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, wantsPhoneMode() ? 'off' : 'on');
    } catch {
      // storage blocked (private mode): the toggle just won't persist
      document.documentElement.classList.toggle('phone-mode');
      return;
    }
    applyPhoneMode();
  });
  // Still on automatic: follow the screen if it crosses the breakpoint
  // (rotating a tablet, resizing a laptop window).
  window.matchMedia(AUTO_QUERY).addEventListener('change', () => {
    if (!storedChoice()) applyPhoneMode();
  });
}
