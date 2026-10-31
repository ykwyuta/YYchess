// チェックメイト問題の候補を自動生成する：node tools/gen-mate.js <手数 1|3|5> <個数> [seed]
// 条件：ちょうど N 手でメイト（それより短くはできない）／本手順の攻め方の手が唯一／白の駒（キング以外）に無駄がない
// 出力：js/mate-data.js にそのまま貼れる形（解説・まちがえやすい手・タイトルも自動で作る）
'use strict';
require('../js/rules.js');
require('../js/mate.js');
const E = globalThis.Engine, MT = globalThis.Mate;
const X = require('./explain.js');
const N = +(process.argv[2] || 1), COUNT = +(process.argv[3] || 10);
let seed = +(process.argv[4] || 1);
const rnd = () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = n => (rnd() * n) | 0;
const pick = a => a[ri(a.length)];
const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = E;

function gen() {
  const b = new Int8Array(64);
  const kx = ri(8), ky = rnd() < 0.6 ? 0 : rnd() < 0.7 ? 1 : 2 + ri(2);
  b[ky * 8 + kx] = -KING;
  const near = (r, minY, maxY) => {
    for (let k = 0; k < 40; k++) {
      const x = kx + ri(2 * r + 1) - r, y = ky + ri(2 * r + 1) - r;
      if (x < 0 || x > 7 || y < minY || y > maxY || b[y * 8 + x]) continue;
      return y * 8 + x;
    }
    return -1;
  };
  // 黒：キングのまわりのポーンと少しの駒
  const np = ri(4);
  for (let i = 0; i < np; i++) {
    const x = kx + ri(3) - 1, y = ky + 1 + (rnd() < 0.3 ? 1 : 0);
    if (x < 0 || x > 7 || y < 1 || y > 6 || b[y * 8 + x]) continue;
    b[y * 8 + x] = -PAWN;
  }
  const nd = ri(3);
  for (let i = 0; i < nd; i++) {
    const t = pick([ROOK, BISHOP, KNIGHT, ROOK, QUEEN, PAWN]);
    const sq = near(1 + ri(3), t === PAWN ? 1 : 0, t === PAWN ? 6 : 7); if (sq < 0) continue;
    b[sq] = -t;
  }
  // 白：攻める駒
  const na = 1 + ri(3);
  for (let i = 0; i < na; i++) {
    const t = pick([QUEEN, ROOK, ROOK, BISHOP, KNIGHT, KNIGHT, PAWN, QUEEN, BISHOP]);
    const sq = near(1 + ri(4), t === PAWN ? 1 : 0, t === PAWN ? 6 : 7); if (sq < 0) continue;
    b[sq] = t;
  }
  // 白のキング：はなれたところ（たまに近くで手伝う）
  for (let k = 0; k < 40; k++) {
    const sq = rnd() < 0.2 ? near(2, 0, 7) : 32 + ri(32);
    if (sq < 0 || b[sq]) continue;
    const dx = Math.abs((sq & 7) - kx), dy = Math.abs((sq >> 3) - ky);
    if (dx <= 1 && dy <= 1) continue;
    b[sq] = KING;
    break;
  }
  if (E.kingSq(b, 0) < 0) return null;
  if (E.inCheck(b, 1) || E.inCheck(b, 0)) return null;
  return { b, turn: 0, castle: 0, ep: -1 };
}

function analyze(pos) {
  const S = new MT.Solver();
  if (S.mateLength(pos, N) !== N) return null;
  const ml = S.mainLine(pos, N);
  if (!ml || ml.alts.some(a => a !== 1)) return null;
  // 白の駒（キング以外）に無駄がないか
  for (let sq = 0; sq < 64; sq++) {
    if (pos.b[sq] <= 0 || pos.b[sq] === KING) continue;
    const p2 = { b: pos.b.slice(), turn: 0, castle: 0, ep: -1 };
    p2.b[sq] = 0;
    if (E.inCheck(p2.b, 1)) continue; // 取り除くとチェックになる＝必要な駒
    if (new MT.Solver().mateLength(p2, N)) return null;
  }
  // 黒が 1手目から すでに動けない（ステイルメイト寸前）ものは 不自然なので すてる
  return ml.line;
}

const out = [], seen = new Set();
let tries = 0;
const t0 = Date.now();
while (out.length < COUNT && Date.now() - t0 < +(process.env.TL || 600000)) {
  tries++;
  const pos = gen();
  if (!pos) continue;
  const s0 = E.fromPosition({ board: pos.b, turn: 0, castle: 0, ep: -1 });
  const fen = E.toFen(s0);
  if (seen.has(fen)) continue;
  seen.add(fen);
  const line = analyze(pos);
  if (!line) continue;
  out.push(X.describe(fen, N));
  process.stderr.write(`${out.length} (${tries} tries)\n`);
}
console.log(JSON.stringify(out, null, 1));
process.stderr.write(`tries=${tries} found=${out.length}\n`);
