// ルールエンジンのテスト：node test/rules.test.js
'use strict';
require('../js/rules.js');
const E = globalThis.Engine;
const assert = require('assert');

function perft(pos, d) {
  const ms = E.legalRaw(pos, false);
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) {
    const u = E.make(pos, m);
    n += perft(pos, d - 1);
    E.unmake(pos, m, u);
  }
  return n;
}
function posFromFen(fen) {
  const p = E.parseFen(fen);
  return { b: p.board, turn: p.turn, castle: p.castle, ep: p.ep };
}

// よく知られた perft の値（キャスリング・アンパッサン・昇格・ピンを ふくむ）
const PERFT = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [fen, exp] of PERFT) {
  const pos = posFromFen(fen);
  const before = pos.b.join(',');
  for (let d = 1; d <= exp.length; d++) assert.strictEqual(perft(pos, d), exp[d - 1], `perft(${d}) ${fen}`);
  assert.strictEqual(pos.b.join(','), before, 'make/unmake で盤が元に戻る');
  console.log(`perft OK ${fen.split(' ')[0]} → ${exp.join(' / ')}`);
}

const sq = n => (8 - +n[1]) * 8 + E.FILES.indexOf(n[0]);
const mv = (s, a, b, promo) => E.encode(sq(a), sq(b), promo);
function play(s, list) { for (const [a, b, p] of list) { const m = mv(s, a, b, p); assert(E.legalMoves(s).includes(m), `${a}${b} が指せる`); s = E.apply(s, m); } return s; }

// フールズメイト（最短の チェックメイト）と SAN
{
  const s = play(E.newGame(), [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]);
  assert.strictEqual(s.winner, 1);
  assert.strictEqual(s.result, 'mate');
  assert.deepStrictEqual(s.kifu, ['f3', 'e5', 'g4', 'Qh4#']);
  console.log('チェックメイト・SAN OK');
}

// キャスリング：通り道に利きがあると できない
{
  const s = E.fromPosition(E.parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'));
  const ms = E.legalMoves(s);
  assert(ms.includes(mv(s, 'e1', 'g1')) && ms.includes(mv(s, 'e1', 'c1')));
  const s2 = E.apply(s, mv(s, 'e1', 'g1'));
  assert.strictEqual(s2.board[sq('f1')], E.ROOK);
  assert.strictEqual(s2.board[sq('h1')], 0);
  assert.strictEqual(s2.kifu[0], 'O-O');
  assert.strictEqual(s2.castle & 3, 0);
  const t = E.fromPosition(E.parseFen('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1'));
  assert(!E.legalMoves(t).includes(mv(t, 'e1', 'g1')), 'f1 に利きがあると O-O できない');
  console.log('キャスリング OK');
}

// アンパッサン
{
  const s = play(E.newGame(), [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]);
  const m = mv(s, 'e5', 'd6');
  assert(E.legalMoves(s).includes(m));
  const s2 = E.apply(s, m);
  assert.strictEqual(s2.board[sq('d5')], 0);
  assert.strictEqual(s2.last.captured, E.PAWN);
  assert.strictEqual(s2.kifu[4], 'exd6');
  console.log('アンパッサン OK');
}

// 昇格
{
  const s = E.fromPosition(E.parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1'));
  const ms = E.legalMoves(s).filter(m => E.mFrom(m) === sq('a7'));
  assert.strictEqual(ms.length, 4);
  const s2 = E.apply(s, mv(s, 'a7', 'a8', E.QUEEN));
  assert.strictEqual(s2.board[sq('a8')], E.QUEEN);
  assert.strictEqual(s2.kifu[0], 'a8=Q');
  console.log('昇格 OK');
}

// ステイルメイト・駒不足・千日手（3回）
{
  const s = E.fromPosition(E.parseFen('7k/8/6Q1/8/8/8/8/K7 w - - 0 1'));
  const s2 = E.apply(s, mv(s, 'g6', 'f7'));
  assert.strictEqual(s2.result, 'stalemate');
  const t = E.fromPosition(E.parseFen('7k/8/8/8/8/8/6q1/K6N w - - 0 1'));
  const t2 = E.apply(t, mv(t, 'h1', 'g3'));
  assert.notStrictEqual(t2.result, 'material');
  const u = E.fromPosition(E.parseFen('7k/8/8/8/8/8/6q1/K6N w - - 0 1'));
  const u2 = E.apply(E.apply(u, mv(u, 'a1', 'b1')), E.encode(sq('g2'), sq('g3')));
  assert.strictEqual(u2.result, null);
  const v = E.fromPosition(E.parseFen('7k/8/8/8/8/8/6n1/K7 w - - 0 1'));
  assert(E.insufficient(v.board));
  let r = E.newGame();
  const loop = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
  for (let k = 0; k < 8 && r.winner === null; k++) r = play(r, [loop[k % 4]]);
  assert.strictEqual(r.result, 'repetition');
  console.log('ひきわけ判定 OK');
}

// SAN の書き分け
{
  const s = E.fromPosition(E.parseFen('k7/8/8/8/8/8/8/KN3N2 w - - 0 1'));
  assert.strictEqual(E.moveText(s, mv(s, 'b1', 'd2')), 'Nbd2');
  console.log('SAN の書き分け OK');
}

// ハンデ
{
  const s = E.newGame({ handicap: 'queenRook', handicapSide: 1 });
  assert.strictEqual(s.board[sq('d8')], 0);
  assert.strictEqual(s.board[sq('a8')], 0);
  assert.strictEqual(s.castle & 8, 0);
  const t = E.newGame({ handicap: 'queen', handicapSide: 0 });
  assert.strictEqual(t.board[sq('d1')], 0);
  assert.strictEqual(t.board[sq('d8')], -E.QUEEN);
  console.log('ハンデ OK');
}
console.log('all rules tests passed');
