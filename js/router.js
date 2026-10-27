import { syncActiveRoute } from './nav.js?v=65';
import { isConfigured } from './sync.js?v=65';

const routes = [
  { pattern: /^\/$/, load: () => import('./views/menu.js?v=65') },
  { pattern: /^\/home$/, load: () => import('./views/home.js?v=65') },
  { pattern: /^\/logging$/, load: () => import('./views/logging.js?v=65') },
  { pattern: /^\/courses$/, load: () => import('./views/courses.js?v=65') },
  { pattern: /^\/course\/([^/]+)$/, load: () => import('./views/course.js?v=65'), params: ['id'] },
  { pattern: /^\/lessons$/, load: () => import('./views/lessons.js?v=65') },
  { pattern: /^\/revision$/, load: () => import('./views/revision.js?v=65') },
  { pattern: /^\/canvas$/, load: () => import('./views/canvas.js?v=65') },
  { pattern: /^\/calendar$/, load: () => import('./views/calendar.js?v=65') },
  { pattern: /^\/roadmap$/, load: () => import('./views/roadmap.js?v=65') },
  { pattern: /^\/public$/, load: () => import('./views/public.js?v=65') },
  { pattern: /^\/contacts$/, load: () => import('./views/contacts.js?v=65') },
  { pattern: /^\/today$/, load: () => import('./views/today.js?v=65') },
  { pattern: /^\/settings$/, load: () => import('./views/settings.js?v=65') },
  { pattern: /^\/sight-reading$/, load: () => import('./views/sightReading.js?v=65') },
];

function currentPath() {
  const hash = location.hash.slice(1);
  return hash.startsWith('/') ? hash : '/' + hash;
}

let activeModule = null;

async function render() {
  const path = currentPath();

  // A device with no Apps Script URL/token entered yet — a stranger's
  // device never will have one — can't fetch anything the private pages
  // need, so every route except Settings (to enter the token) and Public
  // itself redirects there instead. Returning here (rather than falling
  // through) leaves rendering to the hashchange this triggers.
  if (!isConfigured() && path !== '/settings' && path !== '/public') {
    location.hash = '#/public';
    return;
  }

  const app = document.getElementById('app');
  syncActiveRoute(path);

  if (activeModule?.unmount) activeModule.unmount();
  activeModule = null;

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const mod = await route.load();
    const params = {};
    (route.params || []).forEach((name, i) => (params[name] = match[i + 1]));
    app.innerHTML = '';
    mod.render(app, params);
    activeModule = mod;
    return;
  }

  app.innerHTML = '<p class="muted">Page not found.</p>';
}

export function initRouter() {
  window.addEventListener('hashchange', render);
  render();
}
