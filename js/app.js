import './store.js?v=59';
import { initRouter } from './router.js?v=59';
import { initSync } from './sync.js?v=59';
import { compactOldSessions } from './compaction.js?v=59';
import { migrateCourseConfigs } from './migrations.js?v=59';
import { initPush } from './push.js?v=59';
import { initNav } from './nav.js?v=59';

// Registers relative to this page's own path, so the SW's scope is correct
// whether this is served from a domain root or a GitHub Pages project
// subpath — see sw.js for why it exists (installability + offline shell).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

migrateCourseConfigs();
compactOldSessions();
initPush();
initNav(document.getElementById('top-nav'), document.getElementById('top-nav-menu'));
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
