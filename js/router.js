import { syncActiveRoute } from './nav.js?v=68';
import { isConfigured } from './sync.js?v=68';

const routes = [
  { pattern: /^\/$/, load: () => import('./views/menu.js?v=68') },
  { pattern: /^\/home$/, load: () => import('./views/home.js?v=68') },
  { pattern: /^\/logging$/, load: () => import('./views/logging.js?v=68') },
  { pattern: /^\/courses$/, load: () => import('./views/courses.js?v=68') },
  { pattern: /^\/course\/([^/]+)$/, load: () => import('./views/course.js?v=68'), params: ['id'] },
  { pattern: /^\/lessons$/, load: () => import('./views/lessons.js?v=68') },
  { pattern: /^\/revision$/, load: () => import('./views/revision.js?v=68') },
  { pattern: /^\/canvas$/, load: () => import('./views/canvas.js?v=68') },
  { pattern: /^\/calendar$/, load: () => import('./views/calendar.js?v=68') },
  { pattern: /^\/roadmap$/, load: () => import('./views/roadmap.js?v=68') },
  { pattern: /^\/projects$/, load: () => import('./views/projects.js?v=68') },
  { pattern: /^\/projects\/board$/, load: () => import('./views/whiteboard.js?v=68') },
  { pattern: /^\/projects\/([^/]+)\/report$/, load: () => import('./views/report.js?v=68'), params: ['id'] },
  { pattern: /^\/projects\/([^/]+)$/, load: () => import('./views/project.js?v=68'), params: ['id'] },
  { pattern: /^\/public$/, load: () => import('./views/public.js?v=68') },
  { pattern: /^\/contacts$/, load: () => import('./views/contacts.js?v=68') },
  { pattern: /^\/today$/, load: () => import('./views/today.js?v=68') },
  { pattern: /^\/settings$/, load: () => import('./views/settings.js?v=68') },
  { pattern: /^\/sight-reading$/, load: () => import('./views/sightReading.js?v=68') },
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
