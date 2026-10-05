import './store.js?v=42';
import { initRouter } from './router.js?v=42';
import { initSync } from './sync.js?v=42';
import { compactOldSessions } from './compaction.js?v=42';
import { migrateCourseConfigs } from './migrations.js?v=42';
import { initPush } from './push.js?v=42';

// Registers relative to this page's own path, so the SW's scope is correct
// whether this is served from a domain root or a GitHub Pages project
// subpath — see sw.js for why it exists (installability + offline shell).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

migrateCourseConfigs();
compactOldSessions();
initPush();
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));

// Global tab-switch shortcuts, matching the nav order in index.html.
const TAB_ROUTES = ['/', '/courses', '/classes', '/canvas', '/calendar', '/roadmap', '/settings'];

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const current = location.hash.replace(/^#/, '') || '/';
    const currentIndex = TAB_ROUTES.indexOf(current);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const step = e.key === 'ArrowLeft' ? -1 : 1;
    const next = (base + step + TAB_ROUTES.length) % TAB_ROUTES.length;
    location.hash = `#${TAB_ROUTES[next]}`;
    return;
  }

  const index = Number(e.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= TAB_ROUTES.length) return;
  location.hash = `#${TAB_ROUTES[index]}`;
});
