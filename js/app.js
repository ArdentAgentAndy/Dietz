import './store.js?v=2';
import { initRouter } from './router.js?v=2';
import { initSync } from './sync.js?v=2';
import { compactOldSessions } from './compaction.js?v=2';

compactOldSessions();
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
