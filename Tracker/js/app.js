import './store.js';
import { initRouter } from './router.js';
import { initSync } from './sync.js';

initRouter();
initSync(document.getElementById('sync-status'));
