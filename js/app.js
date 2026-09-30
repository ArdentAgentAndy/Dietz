import './store.js?v=1';
import { initRouter } from './router.js?v=1';
import { initSync } from './sync.js?v=1';
import { compactOldSessions } from './compaction.js?v=1';

compactOldSessions();
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
