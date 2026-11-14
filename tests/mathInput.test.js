import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearToLatex, prepareSymbols, autocorrectEquation, autocorrectText } from '../js/mathInput.js';

test('scripts: one atom, a (group), or a letters+digits run', () => {
  assert.equal(linearToLatex('f_a'), 'f_{a}');
  assert.equal(linearToLatex('f_(a b)'), 'f_{a b}');
  assert.equal(linearToLatex('s^-1'), 's^{-1}');
  assert.equal(linearToLatex('x_a^b'), 'x_{a}^{b}');
  assert.equal(linearToLatex('sgn(q_e0)'), '\\operatorname{sgn}(q_{e0})');
  assert.equal(linearToLatex('F_10.7'), 'F_{10.7}');
  assert.equal(linearToLatex("f'(x)"), "f'(x)");
});

test('fractions, roots, big operators, accents, matrices', () => {
  assert.equal(linearToLatex('(x+1)<>(2y)'), '\\frac{x+1}{2y}');
  assert.equal(linearToLatex('a/b'), '\\frac{a}{b}');
  assert.equal(linearToLatex('(x+1)/(2y)'), '\\frac{x+1}{2y}');
  assert.equal(linearToLatex('v = r/t + 1'), 'v = \\frac{r}{t} + 1');
  assert.equal(linearToLatex('(dq)/(dt)'), '\\frac{dq}{dt}');
  assert.equal(linearToLatex('a\\/b'), 'a/b');
  assert.equal(linearToLatex('qdot = 1<>2 q ⊗ omega'), '\\dot{q} = \\frac{1}{2} q \\otimes \\omega');
  assert.equal(linearToLatex('h = √(mu p)'), 'h = \\sqrt{\\mu p}');
  assert.equal(linearToLatex('sqrt(x)'), '\\sqrt{x}');
  assert.equal(linearToLatex('sum_(i=1)^N x_i'), '\\sum _{i=1}^{N} x_{i}');
  assert.equal(linearToLatex('omegadot_b'), '\\dot{\\omega}_{b}');
  assert.equal(linearToLatex('mat(a, b; c, d)'), '\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}');
  assert.equal(linearToLatex('F_"max"'), 'F_{\\text{max}}');
  assert.equal(linearToLatex('gmat(a; b)'), '\\begin{matrix}a \\\\ b\\end{matrix}');
});

test('commas get a full space, except inside scripts', () => {
  assert.equal(linearToLatex('f(x, y)'), 'f(x,\\; y)');
  assert.equal(linearToLatex('f(x,y)'), 'f(x,\\;y)');
  assert.equal(linearToLatex('τ_(c,i)'), '\\tau _{c,i}');
  // A comma at the end of a group must not escape the closing brace.
  assert.equal(linearToLatex('\\boldsymbol{,}'), '\\boldsymbol {,\\;}');
});

test('a bracket left open inside a group stays open (no invented closer)', () => {
  // Word builds (I_zz - I_yy) as sub("(I", "zz") followed by "- I_yy)".
  assert.equal(linearToLatex('{(I}_(zz)-I_(yy))'), '{(I}_{zz}-I_{yy})');
});

test('nomenclature symbols become hoverable, only as whole tokens', () => {
  const syms = prepareSymbols([{ id: 'S1', source: 'ω_b' }, { id: 'S2', source: 'r' }, { id: 'S3', source: 'r_p' }]);
  assert.equal(linearToLatex('omega_b^T', syms), '\\htmlData{sym=S1}{\\omega _{b}}^{T}');
  assert.equal(linearToLatex('r_p + r', syms), '\\htmlData{sym=S3}{r_{p}} + \\htmlData{sym=S2}{r}');
  assert.equal(linearToLatex('r_q', syms), 'r_{q}');
  assert.equal(linearToLatex('x_r', syms), 'x_{r}');
});

test('equation autocorrect: words, templates, sequences', () => {
  assert.deepEqual(autocorrectEquation('omega', 5), { value: 'ω', pos: 1 });
  assert.deepEqual(autocorrectEquation('x int', 5), { value: 'x ∫', pos: 3 });
  assert.deepEqual(autocorrectEquation('d/d', 3), { value: '(d⬚)/(d⬚)', select: [2, 3] });
  assert.deepEqual(autocorrectEquation('a<=>', 4), { value: 'a⇔', pos: 2 });
  assert.deepEqual(autocorrectEquation('M preceq', 8), { value: 'M ≼', pos: 3 });
  assert.equal(linearToLatex('W ≻ 0, A ≼ 0'), 'W \\succ 0,\\; A \\preccurlyeq 0');
  assert.equal(autocorrectEquation('qdot', 4), null);
  assert.equal(autocorrectEquation('\\alpha', 6), null);
});

test('text autocorrect: ^ becomes Unicode superscripts, else an inline equation', () => {
  assert.deepEqual(autocorrectText('m s^-1', 6), { value: 'm s⁻¹', pos: 5 });
  assert.deepEqual(autocorrectText('x^(n+1)', 7), { value: 'xⁿ⁺¹', pos: 4 });
  assert.deepEqual(autocorrectText('x^(1/2)', 7), { value: '$x^(1/2)$', pos: 9 });
  assert.equal(autocorrectText('plain', 5), null);
});
