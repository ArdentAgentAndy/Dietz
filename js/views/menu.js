import { CHANNELS } from '../channels.js?v=56';
import { escapeHtml } from '../format.js?v=56';

let container = null;

function channelCardHtml(channel) {
  const links = channel.subchannels.length
    ? channel.subchannels.map((s) => `<a href="#${s.route}" class="menu-sub-link">${escapeHtml(s.label)}</a>`).join('')
    : '<span class="muted">Coming soon</span>';
  return `
    <div class="menu-card">
      <h2 class="mono">${escapeHtml(channel.label)}</h2>
      <div class="menu-sub-links">${links}</div>
    </div>
  `;
}

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Menu</h1>
      <p class="muted">[M] from anywhere · arrow keys move the channel highlighter above</p>
    </section>
    <section class="card">
      <div class="menu-grid">${CHANNELS.map(channelCardHtml).join('')}</div>
    </section>
  `;
}

export function unmount() {
  container = null;
}
