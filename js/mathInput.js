// Math typing for the report editor (js/views/report.js): a small linear
// "shorthand" you type, converted to LaTeX and rendered with KaTeX.
//
// Shorthand (inside an equation, or a $…$ span of text):
//   f_a  f_(ab)  x^2  s^-1      subscript / superscript (one atom, or a
//                               (group) whose parens are dropped)
//   a/b  (x+1)/(2y)  a<>b       stacked fraction (\/ for a literal slash)
//   √x  √(x+1)                  square root (type "sqrt" + space)
//   ∫_0^T  ∑_(i=1)^N  ∏         big operators, limits via _ and ^
//   qdot qddot rhat rbar rvec rbf   accents on the word before them
//   mat(a, b; c, d)  pmat  vmat  gmat   matrix: , between columns, ; between
//                               rows ([ ], ( ), | |, or no brackets)
//   "text"                      upright text, e.g. F_"max"
//   sin cos exp ln max …        upright function names
//   \frac{a}{b} …               raw LaTeX passes straight through
//   ⬚                           an empty slot left by a template; Tab
//                               jumps between them
//
// Typing (attachMathInput):
//   \            in text: opens an inline equation ($…$). Enter leaves it.
//   ;            in an equation: the next letter comes out Greek, Word
//                Symbol-font style (;a α, ;q θ, ;w ω, ;W Ω — GREEK_KEYS).
//                ;; types a plain ;.
//   space        autocorrects the word before it: Greek names (omega -> ω),
//                int ∫, sum ∑, prod ∏, sqrt √(⬚), d/d and pd/pd (derivative
//                templates), partial ∂, nabla ∇, inf ∞, times ×, cdot ⋅,
//                otimes ⊗, pm ±, approx ≈, … and -> => <= >= != +- ~=.
//                In plain text, x^2 / s^-1 become superscripts (x², s⁻¹).
//   Backspace    right after an autocorrecting space: undo it (keeps what
//                you typed, literally).
//   Enter        in an equation field: done. In a $…$ span: leave it.
//   Tab          next ⬚ slot (Shift+Tab: previous).
//   Escape       done.
//
// Everything stored is the shorthand itself (what you typed), never LaTeX —
// linearToLatex() is deterministic, so any output format (Updates, AIAA,
// IEEE, plain LaTeX) can convert it the same way later.

import { escapeHtml } from './format.js?v=71';

// --- KaTeX (loaded from the CDN on first use) ------------------------------

const KATEX_VERSION = '0.16.11';
let katexPromise = null;

export function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`;
    script.onload = () => resolve(window.katex);
    script.onerror = () => { katexPromise = null; reject(new Error('KaTeX failed to load')); };
    document.head.appendChild(script);
  });
  return katexPromise;
}

// --- Tables ------------------------------------------------------------------

// Greek names -> the Unicode letter that autocorrect types. The letter maps
// to whichever LaTeX command draws that same glyph (GREEK_TEX), so what you
// see while typing is what renders: ϵ/ε and ϕ/φ follow the glyph, not the
// name.
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const GREEK_TEX = {};
for (const [name, ch] of Object.entries(GREEK)) GREEK_TEX[ch] = `\\${name}`;

// ; + letter (Word's Symbol-font layout). Capitals only where the Greek
// capital looks different from the Latin one.
export const GREEK_KEYS = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', j: 'ϕ', k: 'κ', l: 'λ', m: 'μ',
  n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', v: 'ϖ', w: 'ω', x: 'ξ', y: 'ψ', z: 'ζ',
  G: 'Γ', D: 'Δ', Q: 'Θ', L: 'Λ', X: 'Ξ', P: 'Π', S: 'Σ', U: 'Υ', F: 'Φ', Y: 'Ψ', W: 'Ω',
};

// Exported for the toolbar's Greek palette.
export const GREEK_LETTERS = Object.values(GREEK).filter((ch) => ch !== 'ϖ');

// Which ; key types each letter, for the palette's tooltips.
export const GREEK_KEY_FOR = Object.fromEntries(Object.entries(GREEK_KEYS).map(([k, ch]) => [ch, k]));

const SYMBOL_TEX = {
  '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '∑': '\\sum', '∏': '\\prod',
  '∂': '\\partial', '∇': '\\nabla', '∞': '\\infty', '×': '\\times', '⋅': '\\cdot', '·': '\\cdot',
  '⊗': '\\otimes', '⊕': '\\oplus', '±': '\\pm', '∓': '\\mp', '≈': '\\approx', '≠': '\\neq',
  '≤': '\\leq', '≥': '\\geq', '≡': '\\equiv', '∝': '\\propto', '∼': '\\sim', '→': '\\rightarrow',
  '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '↔': '\\leftrightarrow',
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '∀': '\\forall', '∃': '\\exists', '⊥': '\\perp',
  '∥': '\\parallel', '‖': '\\|', '′': "'",
  // Matrix (semi)definiteness: A ≼ 0, W ≻ 0.
  '≼': '\\preccurlyeq', '≽': '\\succcurlyeq', '≺': '\\prec', '≻': '\\succ', 'ħ': '\\hbar', 'ℓ': '\\ell', '⟨': '\\langle',
  '⟩': '\\rangle', '…': '\\ldots', '⋯': '\\cdots', '∘': '\\circ', '°': '{}^{\\circ}',
  '⬚': '{\\color{#8a8a8a}\\square}',
};

// Word autocorrect (space after the word, inside an equation).
const WORDS = {
  ...GREEK,
  int: '∫', iint: '∬', iiint: '∭', oint: '∮', sum: '∑', prod: '∏', partial: '∂', pd: '∂',
  nabla: '∇', inf: '∞', infty: '∞', times: '×', cdot: '⋅', otimes: '⊗', oplus: '⊕', pm: '±',
  mp: '∓', approx: '≈', neq: '≠', leq: '≤', geq: '≥', equiv: '≡', propto: '∝', perp: '⊥',
  parallel: '∥', deg: '°', hbar: 'ħ', ell: 'ℓ', forall: '∀', exists: '∃', circ: '∘',
  preceq: '≼', succeq: '≽', prec: '≺', succ: '≻',
};

// Templates: inserted with their first ⬚ selected, so you type straight
// into it and Tab to the next.
const TEMPLATES = {
  sqrt: '√(⬚)',
  frac: '(⬚)/(⬚)',
  'd/d': '(d⬚)/(d⬚)',
  'pd/pd': '(∂⬚)/(∂⬚)',
  mat: 'mat(⬚, ⬚; ⬚, ⬚)',
};

const SEQUENCES = {
  '<=>': '⇔', '...': '…', '->': '→', '<-': '←', '=>': '⇒', '<=': '≤', '>=': '≥', '!=': '≠',
  '+-': '±', '-+': '∓', '~=': '≈', '==': '≡', '||': '‖',
};

// Upright function names: KaTeX commands, or \operatorname for the rest.
const FUNCS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'arcsin',
  'arccos', 'arctan', 'exp', 'ln', 'log', 'lg', 'det', 'max', 'min', 'lim', 'arg', 'dim', 'ker', 'gcd', 'Pr']);
const OPNAMES = new Set(['sgn', 'tr', 'diag', 'atan2', 'rank', 'erf', 'sat']);

// Word suffixes that put an accent on the rest of the word (qdot -> q̇).
// Longest first, so "ddot" wins over "dot".
const ACCENTS = [['ddot', '\\ddot'], ['dot', '\\dot'], ['hat', '\\hat'], ['bar', '\\bar'],
  ['vec', '\\vec'], ['tilde', '\\tilde'], ['bf', '\\boldsymbol']];

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻',
  '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ',
  j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ',
  x: 'ˣ', y: 'ʸ', z: 'ᶻ', A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ',
  L: 'ᴸ', M: 'ᴹ', N: 'ᴺ', O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ',
};

export const PLACEHOLDER = '⬚';

// --- Shorthand -> LaTeX ------------------------------------------------------

// Applies the word/sequence autocorrect to the whole string, so a word typed
// without the space ("omega_b") renders the same as the corrected one
// ("ω_b") — and nomenclature symbols match either way. Leaves "quoted text"
// and \latexCommands alone.
export function canonical(src) {
  return String(src || '').replace(/("[^"]*"?)|(\\[A-Za-z]+)|([A-Za-z]+)/g, (m, quoted, cmd, word) => {
    if (word && Object.prototype.hasOwnProperty.call(WORDS, word)) return WORDS[word];
    if (word === 'sqrt') return '√';
    return m;
  }).replace(/<=>|\.\.\.|->|<-|=>|<=|>=|!=|\+-|~=|==|\|\|/g, (m) => SEQUENCES[m]);
}

const isLetter = (c) => c !== undefined && /[A-Za-z]/.test(c);

class Parser {
  constructor(src, symbols) {
    this.s = src;
    this.i = 0;
    this.symbols = symbols || [];
    this.closers = []; // closing brackets of the groups we're inside
    this.scriptDepth = 0; // > 0 inside a _/^/√ operand (commas stay tight there)
  }

  peek(n = 0) { return this.s[this.i + n]; }

  toTex() {
    return seqTex(this.parseSeq(null));
  }

  parseSeq(stop) {
    const out = [];
    while (this.i < this.s.length) {
      const c = this.peek();
      if (stop && stop.includes(c)) break;
      const fraction = c === '/' ? 1 : (c === '<' && this.peek(1) === '>' ? 2 : 0);
      if (fraction) {
        this.i += fraction;
        while (out.length && out[out.length - 1].space) out.pop();
        const top = out.pop() || { tex: '' };
        while (/\s/.test(this.peek() || '')) this.i += 1;
        const bottom = this.parseAtom() || { tex: '' };
        out.push({ tex: `\\frac{${inner(top)}}{${inner(bottom)}}` });
        continue;
      }
      if (/\s/.test(c)) {
        this.i += 1;
        if (!out.length || !out[out.length - 1].space) out.push({ tex: ' ', space: true });
        continue;
      }
      const atom = this.parseAtom();
      if (atom) out.push(atom);
    }
    return out;
  }

  // A base, then any primes and _/^ scripts on it.
  parseAtom() {
    const base = this.parseBase();
    if (!base) return null;
    let tex = base.tex;
    let primes = false;
    let sub = null;
    let sup = null;
    for (;;) {
      const c = this.peek();
      if (c === "'" || c === '′') { tex += "'"; primes = true; this.i += 1; continue; }
      if (c === '_' && sub === null) { this.i += 1; sub = this.parseOperand(); continue; }
      if (c === '^' && sup === null) { this.i += 1; sup = this.parseOperand(); continue; }
      break;
    }
    if (sub === null && sup === null) return primes ? { tex } : base;
    if (sub !== null) tex += `_{${sub}}`;
    if (sup !== null) tex += `^{${sup}}`;
    return { tex };
  }

  // What a _, ^ or √ applies to: an optional sign, then one base (a
  // (group)'s parens dropped).
  parseOperand() {
    let sign = '';
    const c = this.peek();
    if ((c === '-' || c === '+') && this.peek(1) !== undefined && !/\s/.test(this.peek(1))) {
      sign = c;
      this.i += 1;
    }
    this.scriptDepth += 1;
    try {
      const base = this.parseBase(true);
      return sign + (base ? inner(base) : '');
    } finally {
      this.scriptDepth -= 1;
    }
  }

  parseBase(operand = false) {
    const s = this.s;
    const c = this.peek();
    if (c === undefined) return null;
    if (operand && /\s/.test(c)) return null;

    const sym = this.matchSymbol();
    if (sym) return sym;

    if (c === '(' || c === '[' || c === '{') {
      const close = { '(': ')', '[': ']', '{': '}' }[c];
      this.i += 1;
      // Stops at this group's closer or any enclosing one, so "{(I}_zz"
      // ends the ( at the } instead of swallowing the rest of the line.
      this.closers.push(close);
      const body = seqTex(this.parseSeq(this.closers));
      this.closers.pop();
      const closed = this.peek() === close;
      if (closed) this.i += 1;
      if (c === '{') return { tex: `{${body}}`, inner: body };
      const [l, r] = c === '(' ? ['(', ')'] : ['[', ']'];
      // Left unclosed (the matching bracket sits outside this group): draw
      // just the opening bracket, as typed.
      if (!closed) return { tex: `${l}${body}`, inner: body };
      const big = /\\(frac|sum|int|iint|iiint|oint|prod|begin)/.test(body);
      return { tex: big ? `\\left${l}${body}\\right${r}` : `${l}${body}${r}`, inner: body };
    }
    if (c === '"') {
      const end = s.indexOf('"', this.i + 1);
      const text = end === -1 ? s.slice(this.i + 1) : s.slice(this.i + 1, end);
      this.i = end === -1 ? s.length : end + 1;
      return { tex: `\\text{${text.replace(/[\\{}$&#%_^~]/g, (m) => `\\${m}`)}}` };
    }
    if (c === '√') {
      this.i += 1;
      return { tex: `\\sqrt{${this.parseOperand()}}` };
    }
    if (c === '\\') {
      const m = s.slice(this.i).match(/^\\([A-Za-z]+|.?)/);
      this.i += m[0].length;
      if (m[0] === '\\/') return { tex: '/' }; // a literal slash, not a fraction
      return { tex: /[A-Za-z]$/.test(m[0]) ? `${m[0]} ` : m[0] };
    }
    // A script takes a whole letters-and-digits run: q_e0 -> q_{e0}.
    if (operand && isLetter(c)) {
      const run = s.slice(this.i).match(/^[A-Za-z][A-Za-z0-9]*/)[0];
      if (/[0-9]/.test(run)) {
        this.i += run.length;
        return { tex: run };
      }
    }
    if (isLetter(c)) {
      const word = s.slice(this.i).match(/^[A-Za-z]+/)[0];
      if (['mat', 'pmat', 'vmat', 'gmat'].includes(word) && s[this.i + word.length] === '(') {
        return this.parseMatrix(word);
      }
      this.i += word.length;
      return { tex: wordTex(word) };
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(this.peek(1) || ''))) {
      const num = s.slice(this.i).match(/^[0-9]*\.?[0-9]+/)[0];
      this.i += num.length;
      return { tex: num };
    }
    if (c === '_' || c === '^') return operand ? null : { tex: '{}' };
    this.i += 1;
    if (c === '*') return { tex: '\\cdot ' };
    if (GREEK_TEX[c]) return { tex: `${GREEK_TEX[c]} ` };
    if (SYMBOL_TEX[c]) return { tex: `${SYMBOL_TEX[c]} ` };
    if ('&#%$'.includes(c)) return { tex: `\\${c}` };
    if (c === '~') return { tex: '\\sim ' };
    if (c === '}') return { tex: '\\}' };
    // A full space after a comma (KaTeX's default is a thin one), except in
    // scripts, where τ_(c,i) should stay tight. \; rather than "\ ": a
    // trailing "\ " gets trimmed to "\", which then escapes whatever follows.
    if (c === ',') return { tex: this.scriptDepth ? ',' : ',\\;' };
    return { tex: c };
  }

  // mat(a, b; c, d): split on top-level ; (rows) and , (columns).
  parseMatrix(word) {
    this.i += word.length + 1; // past "mat("
    let depth = 0;
    let cell = '';
    const rows = [[]];
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      this.i += 1;
      if ('([{'.includes(c)) depth += 1;
      if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth -= 1;
      }
      if (depth === 0 && c === ',') { rows[rows.length - 1].push(cell); cell = ''; continue; }
      if (depth === 0 && c === ';') { rows[rows.length - 1].push(cell); rows.push([]); cell = ''; continue; }
      cell += c;
    }
    rows[rows.length - 1].push(cell);
    const env = { mat: 'bmatrix', pmat: 'pmatrix', vmat: 'vmatrix', gmat: 'matrix' }[word];
    const body = rows.map((r) => r.map((x) => new Parser(x.trim(), this.symbols).toTex()).join(' & ')).join(' \\\\ ');
    return { tex: `\\begin{${env}}${body}\\end{${env}}` };
  }

  // A nomenclature symbol starting here, as a whole token, becomes a
  // hoverable \htmlData{sym=<id>}{…} (see renderMath's trust option).
  matchSymbol() {
    const before = this.s[this.i - 1];
    if (before !== undefined && /[A-Za-z_^\\]/.test(before)) return null;
    for (const sym of this.symbols) {
      if (!this.s.startsWith(sym.src, this.i)) continue;
      const after = this.s[this.i + sym.src.length];
      if (after !== undefined && /[A-Za-z0-9_'′]/.test(after)) continue;
      this.i += sym.src.length;
      return { tex: `\\htmlData{sym=${sym.id}}{${sym.tex}}` };
    }
    return null;
  }
}

function seqTex(atoms) {
  return atoms.map((a) => a.tex).join('').replace(/\s+/g, ' ').trim();
}

function inner(atom) {
  return atom.inner !== undefined ? atom.inner : atom.tex.trim();
}

function wordTex(word) {
  if (FUNCS.has(word)) return `\\${word} `;
  if (OPNAMES.has(word)) return `\\operatorname{${word}}`;
  if (GREEK[word]) return `${GREEK_TEX[GREEK[word]]} `;
  for (const [suffix, cmd] of ACCENTS) {
    if (word.length > suffix.length && word.endsWith(suffix)) {
      return `${cmd}{${wordTex(word.slice(0, -suffix.length)).trim()}}`;
    }
  }
  return word;
}

// symbols: [{ id, source }] (nomenclature rows). Matched longest first.
export function prepareSymbols(rows) {
  return rows
    .map((r) => ({ id: r.id, src: canonical(r.source).trim() }))
    .filter((r) => r.src && !/^[0-9.]+$/.test(r.src))
    .map((r) => ({ ...r, tex: new Parser(r.src, []).toTex() }))
    .sort((a, b) => b.src.length - a.src.length);
}

export function linearToLatex(src, symbols = []) {
  return new Parser(canonical(src), symbols).toTex();
}

// --- Rendering ---------------------------------------------------------------

// Inline equations (in text, table cells, the nomenclature) are drawn at full
// display size too — \displaystyle — so a fraction or ∫ in a sentence isn't
// shrunk to script size.
export function renderMath(src, { display = false, symbols = [] } = {}) {
  const text = String(src || '').trim();
  if (!text) return '';
  if (!window.katex) return `<code class="math-fallback">${escapeHtml(text)}</code>`;
  const tex = linearToLatex(text, symbols);
  return window.katex.renderToString(display ? tex : `\\displaystyle ${tex}`, {
    displayMode: display,
    throwOnError: false,
    strict: 'ignore',
    trust: (ctx) => ctx.command === '\\htmlData',
  });
}

// **bold**, *italic*, __underline__ (what Ctrl+B / Ctrl+I / Ctrl+U type
// in text). Runs on escaped HTML, so the markers are the only markup.
function formatText(html) {
  return html
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*(?=[^\s*])([^*]*?[^\s*]|[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
}

// Text with $…$ equations in it. An unclosed $ runs to the end. Formatting
// may span an equation (**the spin $ω$ decays**), so equations are swapped
// for placeholders while the markers are applied.
export function renderRich(text, { symbols = [] } = {}) {
  const maths = [];
  const html = String(text || '').split('$').map((part, i) => {
    if (i % 2 === 0) return escapeHtml(part);
    maths.push(renderMath(part, { symbols }));
    return `\u0000${maths.length - 1}\u0000`;
  }).join('');
  return formatText(html).replace(/\n/g, '<br>').replace(/\u0000(\d+)\u0000/g, (m, n) => maths[Number(n)]);
}

// --- Typing ------------------------------------------------------------------

export function insideDollar(value, pos) {
  let n = 0;
  for (let i = 0; i < pos; i += 1) if (value[i] === '$') n += 1;
  return n % 2 === 1;
}

function replaceRange(value, start, end, text) {
  return value.slice(0, start) + text + value.slice(end);
}

function withTemplate(value, start, end, tpl) {
  const next = replaceRange(value, start, end, tpl);
  const slot = tpl.indexOf(PLACEHOLDER);
  return slot === -1
    ? { value: next, pos: start + tpl.length }
    : { value: next, select: [start + slot, start + slot + 1] };
}

// The autocorrect for the text just before `pos`, inside an equation:
// { value, pos } (then a space goes in) or { value, select } (a template —
// its first slot gets selected instead), or null.
export function autocorrectEquation(value, pos) {
  const head = value.slice(0, pos);
  let m = head.match(/(?:^|[^A-Za-z\\])(pd\/pd|d\/d)$/);
  if (m) return withTemplate(value, pos - m[1].length, pos, TEMPLATES[m[1]]);
  m = head.match(/(?:^|[^A-Za-z\\])([A-Za-z]+)$/);
  if (m) {
    const word = m[1];
    const start = pos - word.length;
    if (Object.prototype.hasOwnProperty.call(TEMPLATES, word)) return withTemplate(value, start, pos, TEMPLATES[word]);
    if (Object.prototype.hasOwnProperty.call(WORDS, word)) {
      return { value: replaceRange(value, start, pos, WORDS[word]), pos: start + WORDS[word].length };
    }
    return null;
  }
  for (const len of [3, 2]) {
    const seq = head.slice(-len);
    if (seq.length === len && SEQUENCES[seq]) {
      return { value: replaceRange(value, pos - len, pos, SEQUENCES[seq]), pos: pos - len + 1 };
    }
  }
  return null;
}

// Outside an equation only ^ does anything: "s^-1" -> "s⁻¹" when every
// character has a Unicode superscript, else the word becomes an inline
// equation ("x^(n+1/2)" -> "$x^(n+1/2)$").
export function autocorrectText(value, pos) {
  const head = value.slice(0, pos);
  const m = head.match(/([^\s$^]*)\^(\([^()$]*\)|[-+]?[A-Za-z0-9.]+)$/);
  if (!m) return null;
  const [whole, base, raw] = m;
  const start = pos - whole.length;
  const op = raw.startsWith('(') ? raw.slice(1, -1) : raw;
  const sup = [...op].map((ch) => SUPERSCRIPT[ch]);
  const text = sup.every(Boolean) && op ? base + sup.join('') : `$${base}^${raw}$`;
  return { value: replaceRange(value, start, pos, text), pos: start + text.length };
}

function setValue(el, value, start, end = start) {
  el.value = value;
  el.setSelectionRange(start, end);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectSlot(el, backwards) {
  const v = el.value;
  let idx;
  if (backwards) {
    idx = v.lastIndexOf(PLACEHOLDER, el.selectionStart - 1);
    if (idx === -1) idx = v.lastIndexOf(PLACEHOLDER);
  } else {
    idx = v.indexOf(PLACEHOLDER, el.selectionEnd);
    if (idx === -1) idx = v.indexOf(PLACEHOLDER);
  }
  if (idx === -1) return false;
  el.setSelectionRange(idx, idx + 1);
  return true;
}

// Inserts shorthand at the cursor (toolbar buttons, symbol chips). In a text
// field outside $…$ it goes in as its own $…$ equation. A ⬚ in it gets
// selected. Templates take the current selection: %s is where it goes (an
// empty ⬚ slot if nothing's selected), %e the same but left empty — so
// selecting 5x+3 and pressing ∫ gives ∫_(⬚)^(⬚) 5x+3.
export function insertMath(el, text, mode) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = el.value.slice(start, end);
  const filled = text.replace('%s', selected || PLACEHOLDER).replace('%e', selected);
  const wrap = mode === 'text' && !insideDollar(el.value, start);
  const piece = wrap ? `$${filled}$` : filled;
  const next = replaceRange(el.value, start, end, piece);
  const slot = piece.indexOf(PLACEHOLDER);
  if (slot !== -1) setValue(el, next, start + slot, start + slot + 1);
  else setValue(el, next, start + piece.length - (wrap ? 1 : 0));
  el.focus();
}

// Selecting something in an equation and typing an opening bracket wraps it.
// { draws visible braces (a bare { } is an invisible group); < is ⟨ ⟩.
const WRAP_BRACKETS = { '(': ['(', ')'], '[': ['[', ']'], '{': ['\\{', '\\}'], '<': ['⟨', '⟩'] };

// Ctrl+B / Ctrl+I / Ctrl+U. In text: markdown-style markers that toggle; in an
// equation: the math command around the selection.
const TEXT_MARKS = { b: '**', i: '*', u: '__' };
const MATH_MARKS = { b: '\\boldsymbol', i: '\\mathit', u: '\\underline' };

function toggleMarks(el, mark) {
  const { value: v, selectionStart: s, selectionEnd: e } = el;
  const n = mark.length;
  // A lone * next to a ** belongs to bold, not italic.
  const isMark = (at) => v.slice(at, at + n) === mark
    && !(mark === '*' && (v[at - 1] === '*' || v[at + 1] === '*'));
  if (s >= n && isMark(s - n) && isMark(e)) {
    setValue(el, v.slice(0, s - n) + v.slice(s, e) + v.slice(e + n), s - n, e - n);
    return;
  }
  const sel = v.slice(s, e);
  if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
    setValue(el, v.slice(0, s) + sel.slice(n, -n) + v.slice(e), s, e - 2 * n);
    return;
  }
  setValue(el, v.slice(0, s) + mark + sel + mark + v.slice(e), s + n, e + n);
}

// mode: 'eq' (the whole field is one equation) | 'text' (prose with $…$
// equations). multiline: Enter in prose adds a line instead of finishing.
export function attachMathInput(el, { mode = 'text', multiline = false, onCommit } = {}) {
  let undo = null;
  let greekNext = false; // ; was just pressed in an equation
  const setGreek = (on) => {
    greekNext = on;
    el.classList.toggle('is-greek-next', on);
  };
  el.addEventListener('blur', () => setGreek(false));

  el.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

    if (greekNext && !['Shift', 'CapsLock'].includes(e.key)) {
      setGreek(false);
      if (plain && (GREEK_KEYS[e.key] || e.key === ';')) {
        e.preventDefault();
        const ch = e.key === ';' ? ';' : GREEK_KEYS[e.key];
        setValue(el, replaceRange(el.value, start, end, ch), start + ch.length);
        undo = null;
        return;
      }
      // Anything else: the ; was meant literally.
      if (plain && e.key.length === 1) {
        setValue(el, replaceRange(el.value, start, end, ';'), start + 1);
        return; // the key itself still types normally after it
      }
    }
    if (e.key === ';' && plain && (mode === 'eq' || insideDollar(el.value, start))) {
      e.preventDefault();
      setGreek(true);
      return;
    }

    if (e.key === 'Backspace' && undo && plain
      && el.value === undo.after && start === undo.afterStart && end === undo.afterEnd) {
      e.preventDefault();
      setValue(el, undo.restore, undo.restorePos);
      undo = null;
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) undo = null;

    const eqHere = mode === 'eq' || insideDollar(el.value, start);

    const fmt = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && TEXT_MARKS[fmt]) {
      e.preventDefault();
      undo = null;
      if (eqHere) {
        const sel = el.value.slice(start, end);
        const open = `${MATH_MARKS[fmt]}{`;
        setValue(el, replaceRange(el.value, start, end, `${open}${sel}}`), start + open.length, start + open.length + sel.length);
      } else {
        toggleMarks(el, TEXT_MARKS[fmt]);
      }
      return;
    }

    if (eqHere && start !== end && WRAP_BRACKETS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      undo = null;
      const [open, close] = WRAP_BRACKETS[e.key];
      const wrapped = open + el.value.slice(start, end) + close;
      setValue(el, replaceRange(el.value, start, end, wrapped), start + wrapped.length);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCommit?.();
      return;
    }

    if (e.key === '\\' && plain && mode === 'text' && !eqHere) {
      e.preventDefault();
      setValue(el, replaceRange(el.value, start, end, '$$'), start + 1);
      return;
    }

    if (e.key === 'Tab' && el.value.includes(PLACEHOLDER)) {
      e.preventDefault();
      selectSlot(el, e.shiftKey);
      return;
    }

    if (e.key === ' ' && plain && start === end) {
      const res = eqHere ? autocorrectEquation(el.value, start) : autocorrectText(el.value, start);
      if (!res) return;
      e.preventDefault();
      const before = el.value;
      if (res.select) {
        setValue(el, res.value, res.select[0], res.select[1]);
      } else {
        setValue(el, replaceRange(res.value, res.pos, res.pos, ' '), res.pos + 1);
      }
      undo = {
        after: el.value,
        afterStart: el.selectionStart,
        afterEnd: el.selectionEnd,
        // Undo keeps the space you typed, with the word left as-is.
        restore: replaceRange(before, start, start, ' '),
        restorePos: start + 1,
      };
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && plain) {
      if (mode === 'eq') {
        e.preventDefault();
        const res = start === end ? autocorrectEquation(el.value, start) : null;
        if (res && !res.select) setValue(el, res.value, res.pos);
        onCommit?.();
        return;
      }
      if (eqHere) {
        // Leave the $…$ span: correct the last word, then hop past the
        // closing $ (adding one if it's missing).
        e.preventDefault();
        let value = el.value;
        let pos = start;
        const res = start === end ? autocorrectEquation(value, pos) : null;
        if (res && !res.select) ({ value, pos } = res);
        const close = value.indexOf('$', pos);
        if (close === -1) setValue(el, `${value}$`, value.length + 1);
        else setValue(el, value, close + 1);
        return;
      }
      const res = start === end ? autocorrectText(el.value, start) : null;
      if (!multiline) {
        e.preventDefault();
        if (res) setValue(el, res.value, res.pos);
        onCommit?.();
        return;
      }
      if (res) {
        e.preventDefault();
        setValue(el, replaceRange(res.value, res.pos, res.pos, '\n'), res.pos + 1);
      }
    }
  });
}
