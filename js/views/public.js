// Public's own page content hasn't been designed yet — this is just the
// stub that makes it a real, directly-navigable route (see the Public
// channel's `route` in js/channels.js).
let container = null;

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Public</h1>
      <p class="muted">Coming soon.</p>
    </section>
  `;
}

export function unmount() {
  container = null;
}
