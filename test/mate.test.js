// チェックメイト問題 50 問の検証：node test/mate.test.js
// 手数ちょうどでメイト／それより短くできない／本手順の攻め方の手が唯一／traps の手ではメイトできない
'use strict';
require('../js/rules.js');
require('../js/mate.js');
require('../js/mate-data.js');
const E = globalThis.Engine, MT = globalThis.Mate;
const X = require('../tools/explain.js');
const assert = require('assert');

const probs = globalThis.MATE_PROBLEMS;
assert.strictEqual(probs.length, 50, '50問');
const fens = new Set();
const pos = p => { const f = E.parseFen(p.fen); return { b: f.board, turn: f.turn, castle: f.castle, ep: f.ep }; };
probs.forEach((p, i) => {
  const no = `第${i + 1}問`;
  assert(!fens.has(p.fen), `${no} 重複`); fens.add(p.fen);
  const f = E.parseFen(p.fen);
  assert.strictEqual(f.turn, 0, `${no} しろの番`);
  assert.strictEqual(E.kingSq(f.board, 0) >= 0 && E.kingSq(f.board, 1) >= 0, true, `${no} キング`);
  assert(!E.inCheck(f.board, 1) && !E.inCheck(f.board, 0), `${no} 最初からチェック`);
  // ふつうの対局で ありうる駒の数（クイーン 1・ルーク/ビショップ/ナイト 2 まで、ポーンは 1・8段目にない）
  for (const side of [0, 1]) {
    const cnt = [0, 0, 0, 0, 0, 0, 0];
    f.board.forEach((v, sq) => { if (v && E.sideOf(v) === side) { cnt[E.typeOf(v)]++; if (E.typeOf(v) === E.PAWN) assert((sq >> 3) % 7 !== 0, `${no} ポーンの位置`); } });
    assert(cnt[E.QUEEN] <= 1 && cnt[E.ROOK] <= 2 && cnt[E.BISHOP] <= 2 && cnt[E.KNIGHT] <= 2 && cnt[E.PAWN] <= 8, `${no} 駒の数`);
  }
  const S = new MT.Solver();
  assert.strictEqual(S.mateLength(pos(p), p.moves), p.moves, `${no} 手数`);
  const ml = S.mainLine(pos(p), p.moves);
  assert(ml.alts.every(a => a === 1), `${no} 攻め方の手が唯一でない`);
  let s = E.fromPosition(f);
  for (const m of ml.line) s = E.apply(s, m);
  assert.strictEqual(s.kifu.join(' '), p.answer, `${no} 正解手順`);
  assert.strictEqual(s.winner, 0, `${no} メイトになっていない`);
  // 解説は局面から作ったものと一致する（手で書き換えたら tools/explain.js も直す）
  const d = X.describe(p.fen, p.moves);
  assert.strictEqual(p.text, d.text, `${no} 解説`);
  // まちがえやすい手：チェックだが メイトできず、くろは その応手で逃げる
  const s0 = E.fromPosition(f);
  for (const [atk, def] of p.traps) {
    const m = S.checks(pos(p)).find(x => E.moveText(s0, x) === atk);
    assert(m !== undefined, `${no} trap ${atk} はチェックでない`);
    const q = pos(p);
    E.make(q, m);
    assert(!S.defend(q, p.moves - 1), `${no} trap ${atk} でメイトできてしまう`);
    const r = S.bestDefense(q, p.moves - 1);
    assert.strictEqual(E.moveText(E.apply(s0, m), r.move), def, `${no} trap ${atk} の応手`);
  }
});
const count = n => probs.filter(p => p.moves === n).length;
console.log(`メイト問題 ${probs.length}問 OK（1かい ${count(1)}・2かい ${count(3)}・3かい ${count(5)}）`);
