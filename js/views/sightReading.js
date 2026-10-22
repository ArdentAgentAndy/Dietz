// Sight Reading — identify the note(s) drawn on a staff. Ported from the
// old Dietz app (see PLAN.md § Practice channel). No backend yet: question
// generation is random/on-the-fly, not authored, so there's nothing to
// sync — streak resets on reload same as the old app.
//
// Key layout deliberately differs from the old app: the old app used
// digit keys 1/2/3 for flat/natural/sharp, but in this app digits 1-9 are
// a GLOBAL shortcut (nav.js jumps to channel N by number) that fires on
// every page. Using them here would double-fire channel navigation while
// answering, so accidentals are remapped to L / ; / ' instead (not
// reserved anywhere else, same left-to-right order: lower/none/raise, and
// sitting right next to Enter for a fast confirm right after).

const KEY_SIGS = {
  C: { name: 'C minor', flats: ['B', 'E', 'A'], sharps: [] },
  D: { name: 'D minor', flats: ['B'], sharps: [] },
  G: { name: 'G minor', flats: ['B', 'E'], sharps: [] },
  Cs: { name: 'C# minor', flats: [], sharps: ['F', 'C', 'G', 'D'] },
};

// Standard staff positions for key-sig accidental symbols (pos = half-steps
// from E4/G2 middle line). Sharp order F C G D matches our 4-sharp key.
const KEY_SIG_SHARP_POSITIONS = {
  treble: { F: 8, C: 5, G: 9, D: 6 },
  bass: { F: 6, C: 3, G: 7, D: 4 },
};
// Flat order B E A — the three flat keys here go up to 3 flats.
const KEY_SIG_FLAT_POSITIONS = {
  treble: { B: 4, E: 0, A: 3 },
  bass: { B: 2, E: -2, A: 1 },
};

const TREBLE_POSITIONS = {
  D3: -8, E3: -7, F3: -6, G3: -5, A3: -4, B3: -3, C4: -2, D4: -1,
  E4: 0, F4: 1, G4: 2, A4: 3, B4: 4, C5: 5, D5: 6, E5: 7, F5: 8, G5: 9,
  A5: 10, B5: 11, C6: 12, D6: 13, E6: 14,
};
const BASS_POSITIONS = {
  A1: -6, B1: -5, C2: -4, D2: -3, E2: -2, F2: -1,
  G2: 0, A2: 1, B2: 2, C3: 3, D3: 4, E3: 5, F3: 6, G3: 7, A3: 8, B3: 9,
  C4: 10, D4: 11, E4: 12, F4: 13, G4: 14,
};
const TREBLE_POOL = Object.keys(TREBLE_POSITIONS);
const BASS_POOL = Object.keys(BASS_POSITIONS);

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const CW = 240, CH = 280;

let container = null;
let onKeyDown = null;

let state = {
  notesCount: 1,
  clefMode: 'random',
  keyMode: 'Cs',
  currentClef: 'treble',
  currentNotes: [],
  inputs: [],
  streak: 0,
  locked: false,
};

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <header class="sr-header">
      <h1 class="mono">Sight Reading</h1>
      <p>Identify the note(s) shown on the staff</p>
    </header>

    <div class="sr-settings-row">
      <div class="sr-setting-group">
        <div class="sr-setting-label">Notes in chord</div>
        <select id="sr-set-notes">
          <option value="1" selected>1 note</option>
          <option value="2">2 notes</option>
          <option value="3">3 notes</option>
          <option value="4">4 notes</option>
        </select>
      </div>
      <div class="sr-setting-group">
        <div class="sr-setting-label">Clef</div>
        <select id="sr-set-clef">
          <option value="treble">Treble</option>
          <option value="bass">Bass</option>
          <option value="random" selected>Randomise</option>
        </select>
      </div>
      <div class="sr-setting-group">
        <div class="sr-setting-label">Key</div>
        <select id="sr-set-key">
          <option value="Cs" selected>C# minor</option>
          <option value="C">C minor</option>
          <option value="D">D minor</option>
          <option value="G">G minor</option>
        </select>
      </div>
    </div>

    <div class="sr-main-area">
      <div class="sr-staff-wrap">
        <canvas id="sr-staff-canvas"></canvas>
      </div>
      <div class="sr-input-panel">
        <div>
          <div class="sr-section-label">Your answer</div>
          <div id="sr-note-entries"></div>
        </div>
        <div class="sr-kbd-guide">
          <div class="sr-section-label">Keys</div>
          <div class="sr-kbd-row">
            <div class="sr-kbd-item"><span class="sr-kbd">A</span>–<span class="sr-kbd">G</span><span style="margin-left:2px;">note</span></div>
          </div>
          <div class="sr-kbd-row">
            <div class="sr-kbd-item"><span class="sr-kbd">L</span><span>♭</span></div>
            <div class="sr-kbd-item"><span class="sr-kbd">;</span><span>♮</span></div>
            <div class="sr-kbd-item"><span class="sr-kbd">'</span><span>♯</span></div>
          </div>
          <div class="sr-kbd-row">
            <div class="sr-kbd-item"><span class="sr-kbd">↵</span><span>confirm</span></div>
            <div class="sr-kbd-item"><span class="sr-kbd">⌫</span><span>clear</span></div>
          </div>
        </div>
        <div>
          <div class="sr-streak-block">
            <span class="sr-streak-num" id="sr-streak-val">0</span>
            <span class="sr-streak-label">streak</span>
          </div>
          <div class="sr-feedback" id="sr-feedback"></div>
        </div>
      </div>
    </div>
  `;

  initCanvas();

  container.querySelector('#sr-set-notes').addEventListener('change', (e) => {
    state.notesCount = parseInt(e.target.value, 10);
    newQuestion();
  });
  container.querySelector('#sr-set-clef').addEventListener('change', (e) => {
    state.clefMode = e.target.value;
    newQuestion();
  });
  container.querySelector('#sr-set-key').addEventListener('change', (e) => {
    state.keyMode = e.target.value;
    newQuestion();
  });

  onKeyDown = handleKeyDown;
  window.addEventListener('keydown', onKeyDown);

  newQuestion();
}

export function unmount() {
  if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
  onKeyDown = null;
  container = null;
}

function pickClef() {
  if (state.clefMode === 'random') return Math.random() < 0.5 ? 'treble' : 'bass';
  return state.clefMode;
}

function noteBase(s) {
  return s.slice(0, -1);
}

function accSymbol(a) {
  return a === '#' ? '♯' : a === 'b' ? '♭' : a === 'n' ? '♮' : '';
}

function genNotes(clef, n, key) {
  const pool = clef === 'treble' ? TREBLE_POOL : BASS_POOL;
  const posMap = clef === 'treble' ? TREBLE_POSITIONS : BASS_POSITIONS;
  const sig = KEY_SIGS[key];
  const result = [];
  const usedPos = new Set();
  let attempts = 0;
  while (result.length < n && attempts < 300) {
    attempts++;
    const noteStr = pool[Math.floor(Math.random() * pool.length)];
    const pos = posMap[noteStr];
    if (usedPos.has(pos)) continue;
    usedPos.add(pos);
    const base = noteBase(noteStr);

    let keySigAcc = null;
    if (sig.sharps.includes(base)) keySigAcc = '#';
    else if (sig.flats.includes(base)) keySigAcc = 'b';

    // ~20% chance: override with a natural (courtesy accidental shown on
    // the note), only meaningful when the key sig would otherwise alter it.
    let acc = keySigAcc;
    let courtesyAcc = null;
    if (keySigAcc !== null && Math.random() < 0.2) {
      acc = null;
      courtesyAcc = 'n';
    }

    result.push({ noteStr, base, acc, courtesyAcc, keySigAcc });
  }
  result.sort((a, b) => posMap[a.noteStr] - posMap[b.noteStr]);
  return result;
}

function entryDisplay(e) {
  if (!e || !e.letter) return null;
  return e.letter + accSymbol(e.acc);
}

function newQuestion() {
  state.currentClef = pickClef();
  state.currentNotes = genNotes(state.currentClef, state.notesCount, state.keyMode);
  state.inputs = Array(state.notesCount).fill(null).map(() => ({ letter: null, acc: null }));
  state.locked = false;
  updateFeedback('', '');
  renderEntries('idle');
  draw();
}

function renderEntries(mode, correctArr) {
  const entriesEl = container.querySelector('#sr-note-entries');
  entriesEl.innerHTML = '';
  const n = state.notesCount;
  const firstEmpty = state.inputs.findIndex((e) => !e.letter);

  for (let i = 0; i < n; i++) {
    const div = document.createElement('div');
    div.className = 'sr-note-entry';
    div.style.marginBottom = i < n - 1 ? '5px' : '0';
    const inp = state.inputs[i];
    const display = entryDisplay(inp);

    if (mode === 'result' && correctArr) {
      div.classList.add(correctArr[i] ? 'sr-correct' : 'sr-wrong');
    } else if (display) {
      div.classList.add('sr-active');
    } else if (i === firstEmpty) {
      div.classList.add('sr-active');
    }

    const noteDisp = document.createElement('div');
    noteDisp.className = 'sr-note-display' + (display ? '' : ' sr-placeholder');
    noteDisp.textContent = display || (n > 1 ? `Note ${i + 1}` : 'Note');

    const sub = document.createElement('div');
    sub.className = 'sr-note-sublabel';

    if (mode === 'result' && correctArr) {
      const ans = state.currentNotes[i];
      const ansStr = ans.base + accSymbol(ans.acc || ans.courtesyAcc);
      sub.textContent = correctArr[i] ? '✓ correct' : `answer: ${ansStr}`;
      sub.style.color = correctArr[i] ? 'var(--green)' : 'var(--red)';
    } else if (display) {
      sub.className = 'sr-note-sublabel sr-hint';
      sub.textContent = inp.acc ? 'Enter to confirm' : 'L ♭  ; ♮  \' ♯  — then Enter';
    } else if (i === firstEmpty) {
      sub.className = 'sr-note-sublabel sr-hint';
      sub.textContent = 'type a letter key';
    } else {
      sub.textContent = '—';
    }

    div.appendChild(noteDisp);
    div.appendChild(sub);
    entriesEl.appendChild(div);
  }
}

function updateFeedback(msg, cls) {
  const el = container.querySelector('#sr-feedback');
  el.textContent = msg;
  el.className = 'sr-feedback ' + cls;
}

function checkAnswers() {
  const correct = state.currentNotes.map((note, i) => {
    const inp = state.inputs[i];
    if (!inp || !inp.letter) return false;

    const letterMatch = inp.letter.toUpperCase() === note.base.toUpperCase();

    // Bare letter (no modifier typed) is accepted for a standard key-sig
    // note, but NOT when a courtesy natural is shown — typing ♮ there
    // proves the player saw it rather than just guessing the key sig.
    let accMatch;
    if (note.courtesyAcc) {
      accMatch = inp.acc === 'n';
    } else if (note.keySigAcc) {
      accMatch = inp.acc === null || inp.acc === note.keySigAcc;
    } else {
      accMatch = inp.acc === null;
    }

    return letterMatch && accMatch;
  });

  const allCorrect = correct.every(Boolean);
  renderEntries('result', correct);
  if (allCorrect) {
    state.streak++;
    container.querySelector('#sr-streak-val').textContent = state.streak;
    updateFeedback('Correct!', 'sr-correct');
    setTimeout(() => newQuestion(), 400);
  } else {
    state.streak = 0;
    container.querySelector('#sr-streak-val').textContent = 0;
    updateFeedback('Wrong — see answers above', 'sr-wrong');
    state.locked = true;
    setTimeout(() => {
      state.locked = false;
      newQuestion();
    }, 400);
  }
}

function handleKeyDown(e) {
  if (state.locked) return;
  const k = e.key.toUpperCase();

  if ('ABCDEFG'.includes(k) && k.length === 1) {
    e.preventDefault();
    const idx = state.inputs.findIndex((s) => !s.letter);
    if (idx === -1) return;
    state.inputs[idx].letter = k;
    state.inputs[idx].acc = null;
    renderEntries('idle');
    return;
  }
  if (k === 'L' || e.key === ';' || e.key === "'") {
    e.preventDefault();
    const acc = k === 'L' ? 'b' : e.key === ';' ? 'n' : '#';
    for (let i = state.inputs.length - 1; i >= 0; i--) {
      if (state.inputs[i].letter) {
        state.inputs[i].acc = acc;
        break;
      }
    }
    renderEntries('idle');
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    for (let i = state.inputs.length - 1; i >= 0; i--) {
      if (state.inputs[i].letter) {
        state.inputs[i] = { letter: null, acc: null };
        break;
      }
    }
    renderEntries('idle');
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!state.inputs.every((s) => s.letter)) {
      updateFeedback('Fill all ' + state.notesCount + ' note(s) first', '');
      return;
    }
    checkAnswers();
  }
}

function initCanvas() {
  const canvas = container.querySelector('#sr-staff-canvas');
  canvas.width = CW * 2;
  canvas.height = CH * 2;
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
}

function draw() {
  const canvas = container.querySelector('#sr-staff-canvas');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, CW, CH);

  const lineCol = 'rgba(255,255,255,0.18)';
  const noteCol = '#e8e8e8';
  const ledgCol = 'rgba(255,255,255,0.4)';
  const keyCol = 'rgba(195,222,232,0.55)';
  const clefCol = '#d8d8d8';
  const keySigCol = 'rgba(195,222,232,0.75)';

  const STEP = 7;
  const staffCY = CH / 2 + 5;
  const staffTop = staffCY - 2 * STEP;

  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 5; i++) {
    const y = staffTop + (4 - i * 2) * STEP;
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(CW - 8, y);
    ctx.stroke();
  }

  function posToY(pos) {
    return staffTop + (4 - pos) * STEP;
  }

  const clefRight = drawClef(ctx, state.currentClef, staffTop, STEP, clefCol);

  ctx.fillStyle = keyCol;
  ctx.font = `400 9px 'Space Mono', monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(KEY_SIGS[state.keyMode].name, CW - 8, 12);

  const sig = KEY_SIGS[state.keyMode];
  const keySigX = clefRight + 6;
  ctx.fillStyle = keySigCol;
  ctx.font = `bold ${STEP * 2.8}px serif`;
  ctx.textAlign = 'left';
  // 'middle' centers the glyph's own box on its target staff position
  // regardless of font size — a fixed baseline offset (the old approach)
  // only lines up for the one font size it was eyeballed against, and
  // drifts the glyph off its line/space as soon as the size changes.
  ctx.textBaseline = 'middle';

  const posMapSharpKeySig = state.currentClef === 'treble'
    ? KEY_SIG_SHARP_POSITIONS.treble
    : KEY_SIG_SHARP_POSITIONS.bass;
  const posMapFlatKeySig = state.currentClef === 'treble'
    ? KEY_SIG_FLAT_POSITIONS.treble
    : KEY_SIG_FLAT_POSITIONS.bass;

  // Laid out left-to-right using each glyph's *measured* width (plus a
  // fixed pad) rather than a guessed fixed spacing — a guessed spacing
  // that's too narrow lets adjacent accidentals overlap/touch.
  const accPad = 4;
  const orderedAccs = sig.sharps.length > 0
    ? SHARP_ORDER.filter((n) => sig.sharps.includes(n)).map((n) => ({ glyph: '♯', pos: posMapSharpKeySig[n] }))
    : FLAT_ORDER.filter((n) => sig.flats.includes(n)).map((n) => ({ glyph: '♭', pos: posMapFlatKeySig[n] }));

  let xCursor = keySigX;
  for (const { glyph, pos } of orderedAccs) {
    if (pos === undefined) continue;
    const y = posToY(pos);
    ctx.fillText(glyph, xCursor, y);
    xCursor += ctx.measureText(glyph).width + accPad;
  }
  ctx.textBaseline = 'alphabetic';

  const keySigEndX = orderedAccs.length > 0 ? xCursor - accPad : keySigX;

  const cx = keySigEndX + 20;

  const posMap = state.currentClef === 'treble' ? TREBLE_POSITIONS : BASS_POSITIONS;
  const NR = STEP * 1.2;

  const positions = state.currentNotes.map((n) => posMap[n.noteStr]);
  const offsets = computeChordOffsets(positions, NR);

  const allX = offsets.map((o) => cx + o);
  const xMin = Math.min(...allX) - NR - 5;
  const xMax = Math.max(...allX) + NR + 5;
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);

  ctx.strokeStyle = ledgCol;
  ctx.lineWidth = 1.2;

  // A note one step below/above the staff (e.g. treble D4/G5) sits in the
  // gap right next to the staff and gets no ledger line at all — only a
  // note a full line-step further out earns one. Counting in full
  // line-steps (floor(|offset| / 2)) avoids drawing a line nothing sits on.
  if (minPos < 0) {
    const ledgerCount = Math.floor(Math.abs(minPos) / 2);
    for (let i = 1; i <= ledgerCount; i++) {
      const ly = posToY(-2 * i);
      ctx.beginPath();
      ctx.moveTo(xMin, ly);
      ctx.lineTo(xMax, ly);
      ctx.stroke();
    }
  }

  if (maxPos > 8) {
    const ledgerCount = Math.floor((maxPos - 8) / 2);
    for (let i = 1; i <= ledgerCount; i++) {
      const ly = posToY(8 + 2 * i);
      ctx.beginPath();
      ctx.moveTo(xMin, ly);
      ctx.lineTo(xMax, ly);
      ctx.stroke();
    }
  }

  state.currentNotes.forEach((note, i) => {
    const pos = posMap[note.noteStr];
    if (pos === undefined) return;
    const y = posToY(pos);
    const nx = cx + offsets[i];

    ctx.fillStyle = noteCol;
    ctx.beginPath();
    ctx.ellipse(nx, y, NR, NR * 0.74, -0.18, 0, Math.PI * 2);
    ctx.fill();

    if (note.courtesyAcc) {
      ctx.fillStyle = noteCol;
      ctx.font = `bold ${STEP * 1.55}px serif`;
      ctx.textAlign = 'right';
      ctx.fillText(accSymbol(note.courtesyAcc), nx - NR - 1, y + STEP * 0.44);
    }
  });
}

function computeChordOffsets(positions, NR) {
  const n = positions.length;
  if (n === 0) return [];
  const offsets = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(positions[i + 1] - positions[i]) <= 1) {
      offsets[i] = -(NR + 1);
      offsets[i + 1] = NR + 1;
      i++;
    }
  }
  return offsets;
}

function drawClef(ctx, clef, staffTop, STEP, color) {
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  const x = 4;
  const glyph = clef === 'treble' ? '𝄞' : '𝄢';
  ctx.font = clef === 'treble' ? `${STEP * 14}px serif` : `${STEP * 8}px serif`;
  ctx.fillText(glyph, x, staffTop + (clef === 'treble' ? STEP * 4.1 : STEP * 2.3));
  return x + ctx.measureText(glyph).width;
}
