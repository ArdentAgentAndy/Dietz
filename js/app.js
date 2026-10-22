import './store.js?v=62';
import { initRouter } from './router.js?v=62';
import { initSync } from './sync.js?v=62';
import { compactOldSessions, dedupeCompactedSessions } from './compaction.js?v=62';
import { migrateCourseConfigs } from './migrations.js?v=62';
import { initPush } from './push.js?v=62';
import { initNav } from './nav.js?v=62';

// Registers relative to this page's own path, so the SW's scope is correct
// whether this is served from a domain root or a GitHub Pages project
// subpath — see sw.js for why it exists (installability + offline shell).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

migrateCourseConfigs();
dedupeCompactedSessions();
compactOldSessions();
initPush();
initNav(document.getElementById('top-nav'), document.getElementById('top-nav-menu'));
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
