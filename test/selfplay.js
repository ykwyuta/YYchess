// CPU 同士の自動対戦：node test/selfplay.js [白の強さ] [黒の強さ] [局数]
'use strict';
require('../js/rules.js');
require('../js/ai.js');
const E = globalThis.Engine, AI = globalThis.AI;
const [l0 = 'normal', l1 = 'easy', games = '2'] = process.argv.slice(2);
const tally = { 0: 0, 1: 0, '-1': 0 };
for (let g = 0; g < +games; g++) {
  let s = E.newGame();
  let maxT = 0, totT = 0;
  while (s.winner === null) {
    const t0 = Date.now();
    const m = AI.think(s.board, s.turn, s.castle, s.ep, s.turn === 0 ? l0 : l1, s.keys);
    const dt = Date.now() - t0;
    maxT = Math.max(maxT, dt); totT += dt;
    if (!E.legalMoves(s).includes(m)) throw new Error('illegal move from AI');
    s = E.apply(s, m);
  }
  tally[s.winner]++;
  console.log(`game ${g + 1}: winner=${s.winner} result=${s.result} ply=${s.ply} avg=${(totT / s.ply).toFixed(0)}ms max=${maxT}ms`);
  if (g === 0) console.log(s.kifu.slice(0, 30).join(' '));
}
console.log(`${l0}(しろ) ${tally[0]} - ${tally[1]} ${l1}(くろ)  ひきわけ ${tally[-1]}`);
