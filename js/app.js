import './store.js?v=56';
import { initRouter } from './router.js?v=56';
import { initSync } from './sync.js?v=56';
import { compactOldSessions } from './compaction.js?v=56';
import { migrateCourseConfigs } from './migrations.js?v=56';
import { initPush } from './push.js?v=56';
import { initNav } from './nav.js?v=56';

// Registers relative to this page's own path, so the SW's scope is correct
// whether this is served from a domain root or a GitHub Pages project
// subpath — see sw.js for why it exists (installability + offline shell).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

migrateCourseConfigs();
compactOldSessions();
initPush();
initNav(document.getElementById('top-nav'));
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
