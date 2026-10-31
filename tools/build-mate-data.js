// 選んだ問題から js/mate-data.js を作る：node tools/build-mate-data.js > js/mate-data.js
'use strict';
const fs = require('fs');
const X = require('./explain.js');
const dir = process.argv[2] || '.';
const load = f => JSON.parse(fs.readFileSync(`${dir}/${f}.json`));
const PICK = [
  ['m1', [6, 5, 3, 11, 38, 35, 8, 20, 18, 0, 24, 2, 7, 15, 17, 13, 26, 16, 33, 22]],
  ['m3', [19, 36, 37, 18, 10, 9, 30, 34, 14, 8, 4, 5, 7, 13, 29, 20, 11, 28, 39, 6]],
  ['m5_12', [3, 2]], ['m5_14', [0]], ['m5_13', [0, 1, 2]], ['m5_14', [3]], ['m5_11', [0]], ['m5_12', [0]], ['m5_11', [2]],
];
const out = [];
for (const [f, idx] of PICK) {
  const a = load(f);
  for (const i of idx) {
    const p = X.describe(a[i].fen, a[i].moves);
    delete p.tags;
    out.push(p);
  }
}
const q = s => JSON.stringify(s);
let js = `/*
 * うごきがみえるチェス — チェックメイト問題 50 問
 * fen：問題の局面（しろの番）。moves：手数（両方の手を数える。1 = 1かいで メイト、3 = 2かい、5 = 3かい）
 * answer：正解手順。traps：まちがえやすい チェックと、そのときの くろの 逃げ方
 * tools/gen-mate.js で作った候補から選び、解説は tools/explain.js で局面から作った。
 * すべて test/mate.test.js で、手数・正解の唯一性・traps の内容を検証している
 */
(function (global) {
  'use strict';
  global.MATE_PROBLEMS = [
`;
let prev = 0;
for (const p of out) {
  if (p.moves !== prev) { js += `    // ---------- ${(p.moves + 1) >> 1}かいで メイト ----------\n`; prev = p.moves; }
  js += `    { moves: ${p.moves}, fen: ${q(p.fen)}, answer: ${q(p.answer)}, title: ${q(p.title)},\n      text: ${q(p.text)},\n      traps: ${q(p.traps)} },\n`;
}
js += '  ];\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
process.stdout.write(js);
