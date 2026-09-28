import './store.js';
import { initRouter } from './router.js';
import { initSync } from './sync.js';
import { compactOldSessions } from './compaction.js';

compactOldSessions();
initRouter();
initSync(document.getElementById('sync-status'), document.getElementById('sync-btn'));
