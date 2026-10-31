/*
 * うごきがみえるチェス — CPU 思考ルーチン
 * 評価関数（駒の価値 + 駒の位置）+ αβ探索（反復深化・駒の取り合いを読み切る静止探索）。
 * 制限時間で打ち切るので、スマホでも固まらない。
 */
(function (global) {
  'use strict';
  const E = global.Engine;
  const { genMoves, make, unmake, attacked, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = E;

  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const MATE = 100000;
  const INF = 1e9;

  // margin：最善手からこの点差以内の手をランダムに選ぶ（手加減）
  // blunder：この確率で、まったく適当な手を指す
  // quiet：駒の取り合いを先読みしない（取り返されることに気づかない）
  // checks：チェックのチャンスは逃さない（チェックメイトできればして、そうでなくてもチェックをかける）
  const LEVELS = {
    beginner: { depth: 1, time: 200, margin: 900, blunder: 0.6, quiet: true, checks: true },
    easy: { depth: 1, time: 400, margin: 220, blunder: 0.2 },
    normal: { depth: 3, time: 1200, margin: 30, blunder: 0 },
    hard: { depth: 6, time: 2500, margin: 0, blunder: 0 },
    hint: { depth: 4, time: 1500, margin: 0, blunder: 0 },
  };

  // 駒の位置の評価（白から見た表。y = 0 が 8段目）
  const PST = [null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ];
  // 終盤のキング（まんなかに出て戦う）
  const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  function evaluate(S) {
    const b = S.b;
    let sc = 0, mat0 = 0, mat1 = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || p === KING || p === -KING) continue;
      if (p > 0) mat0 += VAL[p]; else mat1 += VAL[-p];
    }
    const endgame = mat0 + mat1 <= 2600;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      if (p > 0) {
        sc += VAL[p] + (p === KING && endgame ? KING_END[sq] : PST[p][sq]);
      } else {
        const t = -p, m = sq ^ 56; // 上下を反転
        sc -= VAL[t] + (t === KING && endgame ? KING_END[m] : PST[t][m]);
      }
    }
    // 勝っているほうは、駒の少ない終盤で相手のキングを はしに追いつめる
    if (endgame && Math.abs(mat0 - mat1) >= 300) {
      const strong = mat0 > mat1 ? 0 : 1;
      const k = S.k[1 - strong], ks = S.k[strong];
      const kx = k & 7, ky = k >> 3;
      const edge = Math.max(3 - kx, kx - 4) + Math.max(3 - ky, ky - 4);
      const dist = Math.abs(kx - (ks & 7)) + Math.abs(ky - (ks >> 3));
      const bonus = edge * 10 + (14 - dist) * 4;
      sc += strong === 0 ? bonus : -bonus;
    }
    return S.turn === 0 ? sc : -sc;
  }

  function doMove(S, m) {
    const side = S.turn;
    const u = make(S, m);
    const to = (m >> 6) & 63;
    if (S.b[to] === (side === 0 ? KING : -KING)) S.k[side] = to;
    return u;
  }
  function undoMove(S, m, u) {
    unmake(S, m, u);
    const from = m & 63, side = S.turn;
    if (S.b[from] === (side === 0 ? KING : -KING)) S.k[side] = from;
  }

  // 取る手（安い駒で高い駒を）→ 昇格 → キラー手 → 履歴 の順に並べる
  function ordered(S, moves, ply) {
    const b = S.b;
    const keys = new Float64Array(moves.length);
    const k1 = S.killers[ply * 2], k2 = S.killers[ply * 2 + 1];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const from = m & 63, to = (m >> 6) & 63;
      let s;
      const cap = b[to];
      if (cap) s = 200000 + VAL[cap < 0 ? -cap : cap] * 16 - VAL[b[from] < 0 ? -b[from] : b[from]];
      else if (m === k1 || m === k2) s = 150000;
      else s = Math.min(S.hist[m & 4095], 100000);
      if ((m >> 12) & 7) s += ((m >> 12) & 7) === QUEEN ? 180000 : -50000;
      keys[i] = s * 32768 + (m & 0x7fff);
    }
    keys.sort();
    const out = new Array(moves.length);
    for (let i = 0; i < moves.length; i++) out[i] = keys[moves.length - 1 - i] % 32768;
    return out;
  }

  function tick(S) {
    if ((++S.nodes & 1023) === 0 && Date.now() > S.deadline) S.stop = true;
    return S.stop;
  }

  function qsearch(S, alpha, beta, ply, qd) {
    if (tick(S)) return 0;
    if (S.quiet) return evaluate(S);
    const side = S.turn;
    const inChk = attacked(S.b, S.k[side], 1 - side);
    const evasions = inChk && qd < 3;
    let best = -INF;
    if (!evasions) {
      best = evaluate(S);
      if (best >= beta || qd > 10) return best;
      if (best > alpha) alpha = best;
    }
    const moves = ordered(S, genMoves(S, [], !evasions), ply);
    let legal = 0;
    for (const m of moves) {
      const u = doMove(S, m);
      if (attacked(S.b, S.k[side], 1 - side)) { undoMove(S, m, u); continue; }
      legal++;
      const v = -qsearch(S, -beta, -alpha, ply + 1, qd + 1);
      undoMove(S, m, u);
      if (S.stop) return 0;
      if (v > best) {
        best = v;
        if (v > alpha) { alpha = v; if (v >= beta) break; }
      }
    }
    if (evasions && !legal) return -MATE + ply;
    return best;
  }

  function search(S, depth, alpha, beta, ply) {
    const side = S.turn;
    const inChk = attacked(S.b, S.k[side], 1 - side);
    if (inChk) depth++; // チェックされたら 1手 深く読む
    if (depth <= 0) return qsearch(S, alpha, beta, ply, 0);
    if (tick(S)) return 0;
    const moves = ordered(S, genMoves(S, []), ply);
    let legal = 0, best = -INF;
    for (const m of moves) {
      const u = doMove(S, m);
      if (attacked(S.b, S.k[side], 1 - side)) { undoMove(S, m, u); continue; }
      legal++;
      const v = -search(S, depth - 1, -beta, -alpha, ply + 1);
      undoMove(S, m, u);
      if (S.stop) return 0;
      if (v > best) {
        best = v;
        if (v > alpha) {
          alpha = v;
          if (v >= beta) {
            if (!S.b[(m >> 6) & 63]) {
              if (S.killers[ply * 2] !== m) { S.killers[ply * 2 + 1] = S.killers[ply * 2]; S.killers[ply * 2] = m; }
              S.hist[m & 4095] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) return inChk ? -MATE + ply : 0; // チェックメイト or ステイルメイト
    return best;
  }

  // 局面から指し手（整数）を返す。指せる手がなければ null
  // history：これまでに出た局面のキー（千日手を避けるため。なくてもよい）
  function think(board, turn, castle, ep, levelName, history) {
    const L = LEVELS[levelName] || LEVELS.normal;
    const S = {
      b: Int8Array.from(board), turn, castle, ep, k: [E.kingSq(board, 0), E.kingSq(board, 1)],
      nodes: 0, deadline: Date.now() + L.time, stop: false, quiet: !!L.quiet,
      killers: new Int32Array(256), hist: new Int32Array(4096),
    };
    const side = turn;
    const root = E.legalRaw(S, false);
    if (!root.length) return null;
    if (root.length === 1) return root[0];
    if (L.checks) {
      // チェックメイト → 取られない チェック → 取られる チェック の順に探し、見つかった中から適当に選ぶ
      const mates = [], safe = [], risky = [];
      for (const m of root) {
        const u = doMove(S, m);
        if (attacked(S.b, S.k[1 - side], side)) {
          if (!E.legalRaw(S, true).length) mates.push(m);
          else if (!attacked(S.b, (m >> 6) & 63, 1 - side)) safe.push(m);
          else risky.push(m);
        }
        undoMove(S, m, u);
      }
      const pool = mates.length ? mates : safe.length ? safe : risky;
      if (pool.length) return pool[(Math.random() * pool.length) | 0];
    }
    if (L.blunder && Math.random() < L.blunder) return root[(Math.random() * root.length) | 0];

    // 3回目の同一局面になる手（ひきわけ）は、負けているとき以外は避ける
    const seen = new Map();
    for (const k of history || []) seen.set(k, (seen.get(k) || 0) + 1);

    let order = ordered(S, root, 0);
    let best = order[0];
    for (let depth = 1; depth <= L.depth; depth++) {
      const scored = [];
      let alpha = -INF, bestR = -INF, pick = null;
      for (const m of order) {
        const u = doMove(S, m);
        let v;
        if (history && (seen.get(E.posKey({ board: S.b, turn: S.turn, castle: S.castle, ep: S.ep })) || 0) >= 2) v = 0;
        else v = -search(S, depth - 1, -INF, -(alpha - L.margin), 1);
        undoMove(S, m, u);
        if (S.stop) break;
        scored.push([m, v]);
        if (v > alpha) alpha = v;
        const r = v + Math.random() * L.margin;
        if (r > bestR) { bestR = r; pick = m; }
      }
      if (S.stop && depth > 1) break; // 読み切れなかった深さは捨てる
      if (pick !== null) best = pick;
      if (S.stop) break;
      scored.sort((a, b) => b[1] - a[1]);
      order = scored.map(a => a[0]);
      if (alpha >= MATE - 100) break; // チェックメイトを見つけた
    }
    return best;
  }

  global.AI = { think, evaluate, LEVELS, VAL };
})(typeof window !== 'undefined' ? window : globalThis);
