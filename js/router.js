import { syncActiveRoute } from './nav.js?v=56';

const routes = [
  { pattern: /^\/$/, load: () => import('./views/menu.js?v=56') },
  { pattern: /^\/logging$/, load: () => import('./views/logging.js?v=56') },
  { pattern: /^\/courses$/, load: () => import('./views/courses.js?v=56') },
  { pattern: /^\/course\/([^/]+)$/, load: () => import('./views/course.js?v=56'), params: ['id'] },
  { pattern: /^\/lessons$/, load: () => import('./views/lessons.js?v=56') },
  { pattern: /^\/canvas$/, load: () => import('./views/canvas.js?v=56') },
  { pattern: /^\/calendar$/, load: () => import('./views/calendar.js?v=56') },
  { pattern: /^\/roadmap$/, load: () => import('./views/roadmap.js?v=56') },
  { pattern: /^\/today$/, load: () => import('./views/today.js?v=56') },
  { pattern: /^\/settings$/, load: () => import('./views/settings.js?v=56') },
];

function currentPath() {
  const hash = location.hash.slice(1);
  return hash.startsWith('/') ? hash : '/' + hash;
}

let activeModule = null;

async function render() {
  const path = currentPath();
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
