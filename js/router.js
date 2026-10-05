const routes = [
  { pattern: /^\/$/, load: () => import('./views/home.js?v=50') },
  { pattern: /^\/courses$/, load: () => import('./views/courses.js?v=50') },
  { pattern: /^\/course\/([^/]+)$/, load: () => import('./views/course.js?v=50'), params: ['id'] },
  { pattern: /^\/classes$/, load: () => import('./views/classes.js?v=50') },
  { pattern: /^\/canvas$/, load: () => import('./views/canvas.js?v=50') },
  { pattern: /^\/calendar$/, load: () => import('./views/calendar.js?v=50') },
  { pattern: /^\/roadmap$/, load: () => import('./views/roadmap.js?v=50') },
  { pattern: /^\/settings$/, load: () => import('./views/settings.js?v=50') },
];

function currentPath() {
  const hash = location.hash.slice(1);
  return hash.startsWith('/') ? hash : '/' + hash;
}

function updateActiveTab(path) {
  const top = '/' + (path.split('/')[1] || '');
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === top);
  });
}

let activeModule = null;

async function render() {
  const path = currentPath();
  const app = document.getElementById('app');
  updateActiveTab(path);

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
