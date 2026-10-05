import { store } from './store.js?v=41';
import { formatDateISO } from './format.js?v=41';

const TIMER_KEY = 'dietz:timer';

function load() {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(timer) {
  if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else localStorage.removeItem(TIMER_KEY);
}

export const timerState = {
  get current() {
    return load();
  },
};

export function startTimer(categoryId) {
  if (load()) stopTimer();
  save({ categoryId, startedAt: Date.now() });
}

export function stopTimer() {
  const current = load();
  if (!current) return null;
  const endedAt = Date.now();
  const elapsedMs = endedAt - current.startedAt;
  save(null);

  return store.upsert('Sessions', {
    categoryId: current.categoryId,
    date: formatDateISO(new Date(current.startedAt)),
    start: new Date(current.startedAt).toISOString(),
    end: new Date(endedAt).toISOString(),
    minutes: elapsedMs / 60000,
    source: 'timer',
    note: '',
  });
}
