/*
 * うごきがみえるチェス — チェックメイト問題のソルバー
 * 攻め方＝白（side 0）、守り方＝黒（side 1）。攻め方は毎手チェックをかけ、守り方は一番長く逃げる手を指す。
 * 問題の自動生成（tools/gen-mate.js）と、遊ぶときの正解判定の両方で使う。
 * 手数は将棋の詰将棋と同じく、両方の手を数える（1手 = 白の 1手でメイト、3手 = 白・黒・白）。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const { make, unmake, legalRaw, inCheck } = E;

  function Solver() { this.memo = new Map(); this.nodes = 0; }

  Solver.prototype.key = function (pos, n) { return n + ':' + pos.b.join(',') + ':' + pos.turn + pos.castle + ':' + pos.ep; };

  // 攻め方のチェック（合法手のうち、相手のキングにチェックがかかるもの）
  Solver.prototype.checks = function (pos) {
    const res = [];
    for (const m of legalRaw(pos, false)) {
      const u = make(pos, m);
      if (inCheck(pos.b, 1)) res.push(m);
      unmake(pos, m, u);
    }
    return res;
  };

  // 攻め方の手番で、n 手（奇数）以内にメイトできるか
  Solver.prototype.attack = function (pos, n) {
    if (n < 1) return false;
    const k = this.key(pos, n);
    const memo = this.memo.get(k);
    if (memo !== undefined) return memo;
    this.nodes++;
    let ok = false;
    for (const m of this.checks(pos)) {
      const u = make(pos, m);
      const r = this.defend(pos, n - 1);
      unmake(pos, m, u);
      if (r) { ok = true; break; }
    }
    this.memo.set(k, ok);
    return ok;
  };

  // 守り方の手番（チェックされている）で、残り n 手以内に必ずメイトされるか
  Solver.prototype.defend = function (pos, n) {
    const ms = legalRaw(pos, false);
    if (!ms.length) return true;
    if (n < 2) return false;
    for (const m of ms) {
      const u = make(pos, m);
      const r = this.attack(pos, n - 1);
      unmake(pos, m, u);
      if (!r) return false;
    }
    return true;
  };

  Solver.prototype.mateLength = function (pos, max) {
    for (let n = 1; n <= max; n += 2) if (this.attack(pos, n)) return n;
    return 0;
  };

  // 攻め方の手番で、n 手以内にメイトできるチェックの一覧
  Solver.prototype.solutions = function (pos, n) {
    const res = [];
    for (const m of this.checks(pos)) {
      const u = make(pos, m);
      if (this.defend(pos, n - 1)) res.push(m);
      unmake(pos, m, u);
    }
    return res;
  };

  // 守り方の最善の応手：一番長く逃げられる手。同じ長さなら、駒を取る手 → キングが動く手 を選ぶ
  Solver.prototype.bestDefense = function (pos, max) {
    let best = null, bestLen = -1, bestRank = -1;
    for (const m of legalRaw(pos, false)) {
      const king = E.typeOf(pos.b[E.mFrom(m)]) === E.KING;
      const cap = !!pos.b[E.mTo(m)];
      const u = make(pos, m);
      let len = 0;
      for (let n = 1; n <= max + 2; n += 2) { if (this.attack(pos, n)) { len = n; break; } }
      if (!len) len = Infinity;
      unmake(pos, m, u);
      const rank = (cap ? 2 : 0) + (king ? 1 : 0);
      if (len > bestLen || (len === bestLen && rank > bestRank)) { best = m; bestLen = len; bestRank = rank; }
    }
    return { move: best, len: bestLen };
  };

  // 本手順（最善の応手に対する攻め方の手）。各局面で攻め方の正解がいくつあるかも返す
  Solver.prototype.mainLine = function (pos0, n) {
    const pos = { b: Int8Array.from(pos0.b), turn: pos0.turn, castle: pos0.castle, ep: pos0.ep };
    const line = [], alts = [];
    while (n > 0) {
      const sols = this.solutions(pos, n);
      if (!sols.length) return null;
      alts.push(sols.length);
      const m = sols[0];
      line.push(m);
      make(pos, m);
      if (n === 1) break;
      const d = this.bestDefense(pos, n - 2);
      if (d.move === null) break;
      line.push(d.move);
      make(pos, d.move);
      n -= 2;
    }
    return { line, alts };
  };

  global.Mate = { Solver };
})(typeof window !== 'undefined' ? window : globalThis);
