/*
 * うごきがみえるチェス — ルールエンジン
 * 盤面状態は純粋なデータとして扱い、apply は常に新しい状態を返す。
 * 低レベルの指し手生成（genMoves / make / unmake / attacked）は AI の探索でもそのまま使う。
 *
 * 座標：x は画面の左から 0〜7（ファイル a〜h）、y は上から 0〜7（ランクは 8 - y）。sq = y * 8 + x。
 * 駒：白（side 0・下側）は正の数、黒（side 1・上側）は負の数。
 * 指し手：整数。bit 0-5 = 移動元、bit 6-11 = 移動先、bit 12-14 = 昇格する駒（0 = なし）。
 * 局面 pos：{ b: 盤, turn, castle（bit0 白O-O, bit1 白O-O-O, bit2 黒O-O, bit3 黒O-O-O）, ep（アンパッサンで取れるマス、なければ -1）}
 */
(function (global) {
  'use strict';

  const SIZE = 8;
  const N = 64;
  const MAX_PLY = 400;

  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

  const SIDES = [
    { name: 'しろ', mark: '○', en: 'White' },
    { name: 'くろ', mark: '●', en: 'Black' },
  ];

  // 方向 0〜7：上・右上・右・右下・下・左下・左・左上（白から見た向き。上が前）
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const M = (...ds) => ds.reduce((a, d) => a | (1 << d), 0);
  const ORTH = M(0, 2, 4, 6), DIAG = M(1, 3, 5, 7), ALL = 255;
  const KNIGHT_JUMPS = [[1, -2], [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2]];

  // step = 1マスだけ動ける方向、slide = どこまでも動ける方向、jump = ナイトとび
  // pawn は特別：まえに 1マス（さいしょは 2マス）、とるときは ななめまえ
  const PIECES = [
    null,
    { letter: '', name: 'ポーン', step: M(0), slide: 0, capture: M(1, 7), pawn: true,
      desc: 'まえに 1マス すすむよ（さいしょだけ 2マス すすめる）。あいてを とるときは ななめまえ。いちばん おくまで いくと べつの こまに かわれるよ！' },
    { letter: 'N', name: 'ナイト', step: 0, slide: 0, jump: true,
      desc: 'たて 2・よこ 1（または たて 1・よこ 2）の ところへ ジャンプ！ ほかの こまを とびこえられる ただひとつの こま。' },
    { letter: 'B', name: 'ビショップ', step: 0, slide: DIAG,
      desc: 'ななめに、どこまでも すすめるよ。ずっと おなじ いろの マスに いるよ。' },
    { letter: 'R', name: 'ルーク', step: 0, slide: ORTH,
      desc: 'たて・よこに、どこまでも すすめるよ。キングと いっしょに「キャスリング」が できる。' },
    { letter: 'Q', name: 'クイーン', step: 0, slide: ALL,
      desc: 'たて・よこ・ななめ、8ほうこうに どこまでも すすめる。いちばん つよい こま！' },
    { letter: 'K', name: 'キング', step: ALL, slide: 0,
      desc: 'まわりの 8ほうこうに 1マス。とられそうに なったら（チェック）にげよう。つかまったら まけ！' },
  ];
  const PROMO_ORDER = [QUEEN, ROOK, BISHOP, KNIGHT];

  // ハンデ（駒落ち）。座標は上側（黒）の駒。下側に適用するときは上下に移す
  const HANDICAPS = {
    none: { name: 'なし', remove: [] },
    pawn: { name: 'ポーン 1つ（f のポーン）', remove: [[5, 1]] },
    knight: { name: 'ナイト 1つ', remove: [[1, 0]] },
    rook: { name: 'ルーク 1つ', remove: [[0, 0]] },
    queen: { name: 'クイーン', remove: [[3, 0]] },
    queenRook: { name: 'クイーン と ルーク', remove: [[3, 0], [0, 0]] },
    queenRooks: { name: 'クイーン と ルーク 2つ', remove: [[3, 0], [0, 0], [7, 0]] },
  };
  const HANDICAP_ORDER = ['none', 'pawn', 'knight', 'rook', 'queen', 'queenRook', 'queenRooks'];

  const FILES = 'abcdefgh';

  function inB(x, y) { return x >= 0 && y >= 0 && x < 8 && y < 8; }
  function sideOf(p) { return p > 0 ? 0 : 1; }
  function typeOf(p) { return p < 0 ? -p : p; }
  function sqName(sq) { return FILES[sq & 7] + (8 - (sq >> 3)); }
  function sqColor(sq) { return ((sq & 7) + (sq >> 3)) & 1; } // 0 = あかるい マス
  function promoRow(side) { return side === 0 ? 0 : 7; }

  // ---- 指し手の符号化 ----

  function mFrom(m) { return m & 63; }
  function mTo(m) { return (m >> 6) & 63; }
  function mPromo(m) { return (m >> 12) & 7; }
  function encode(from, to, promo) { return from | (to << 6) | ((promo || 0) << 12); }

  // ---- 利き ----

  function attacked(b, sq, by) {
    const sgn = by === 0 ? 1 : -1;
    const x = sq & 7, y = sq >> 3;
    // ポーン（白のポーンは下から上へ取る＝攻撃マスの 1つ下にいる）
    const py = y + sgn;
    if (py >= 0 && py < 8) {
      if (x > 0 && b[py * 8 + x - 1] === PAWN * sgn) return true;
      if (x < 7 && b[py * 8 + x + 1] === PAWN * sgn) return true;
    }
    for (let i = 0; i < 8; i++) {
      const tx = x + KNIGHT_JUMPS[i][0], ty = y + KNIGHT_JUMPS[i][1];
      if (tx >= 0 && ty >= 0 && tx < 8 && ty < 8 && b[ty * 8 + tx] === KNIGHT * sgn) return true;
    }
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      const diag = d & 1;
      let cx = x + dx, cy = y + dy, first = true;
      while (cx >= 0 && cy >= 0 && cx < 8 && cy < 8) {
        const p = b[cy * 8 + cx] * sgn;
        if (p) {
          if (p > 0) {
            if (p === QUEEN || (diag ? p === BISHOP : p === ROOK)) return true;
            if (first && p === KING) return true;
          }
          break;
        }
        first = false; cx += dx; cy += dy;
      }
    }
    return false;
  }

  // sq に利いている by 側の駒のマス一覧
  function attackers(b, sq, by) {
    const sgn = by === 0 ? 1 : -1;
    const x = sq & 7, y = sq >> 3;
    const res = [];
    const py = y + sgn;
    if (py >= 0 && py < 8) {
      if (x > 0 && b[py * 8 + x - 1] === PAWN * sgn) res.push(py * 8 + x - 1);
      if (x < 7 && b[py * 8 + x + 1] === PAWN * sgn) res.push(py * 8 + x + 1);
    }
    for (let i = 0; i < 8; i++) {
      const tx = x + KNIGHT_JUMPS[i][0], ty = y + KNIGHT_JUMPS[i][1];
      if (tx >= 0 && ty >= 0 && tx < 8 && ty < 8 && b[ty * 8 + tx] === KNIGHT * sgn) res.push(ty * 8 + tx);
    }
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      const diag = d & 1;
      let cx = x + dx, cy = y + dy, first = true;
      while (cx >= 0 && cy >= 0 && cx < 8 && cy < 8) {
        const p = b[cy * 8 + cx] * sgn;
        if (p) {
          if (p > 0 && (p === QUEEN || (diag ? p === BISHOP : p === ROOK) || (first && p === KING))) res.push(cy * 8 + cx);
          break;
        }
        first = false; cx += dx; cy += dy;
      }
    }
    return res;
  }

  function kingSq(b, side) {
    const k = side === 0 ? KING : -KING;
    for (let sq = 0; sq < N; sq++) if (b[sq] === k) return sq;
    return -1;
  }
  function inCheck(b, side) {
    const k = kingSq(b, side);
    return k >= 0 && attacked(b, k, 1 - side);
  }

  // ---- 指し手生成（キングを取られる手も含む「疑似合法手」。キャスリングだけは通り道の利きも見る）----

  function pushPawn(out, from, to, side) {
    if ((to >> 3) === promoRow(side)) {
      for (const t of PROMO_ORDER) out.push(from | (to << 6) | (t << 12));
    } else {
      out.push(from | (to << 6));
    }
  }

  function genMoves(pos, out, capsOnly) {
    const b = pos.b, side = pos.turn;
    const own = side === 0 ? 1 : -1;
    const fwd = -own; // 白は上（y が小さくなる）へ進む
    for (let sq = 0; sq < N; sq++) {
      const p = b[sq] * own;
      if (p <= 0) continue;
      const x = sq & 7, y = sq >> 3;
      if (p === PAWN) {
        const ty = y + fwd;
        if (ty < 0 || ty > 7) continue;
        const one = ty * 8 + x;
        if (!b[one]) {
          if (!capsOnly || ty === promoRow(side)) {
            pushPawn(out, sq, one, side);
            const startRow = side === 0 ? 6 : 1;
            if (!capsOnly && y === startRow && !b[one + fwd * 8]) out.push(sq | ((one + fwd * 8) << 6));
          }
        }
        for (let dx = -1; dx <= 1; dx += 2) {
          const tx = x + dx;
          if (tx < 0 || tx > 7) continue;
          const to = ty * 8 + tx;
          if (b[to] * own < 0 || to === pos.ep) pushPawn(out, sq, to, side);
        }
        continue;
      }
      if (p === KNIGHT) {
        for (let i = 0; i < 8; i++) {
          const tx = x + KNIGHT_JUMPS[i][0], ty = y + KNIGHT_JUMPS[i][1];
          if (tx < 0 || ty < 0 || tx > 7 || ty > 7) continue;
          const to = ty * 8 + tx;
          const q = b[to] * own;
          if (q > 0 || (capsOnly && !q)) continue;
          out.push(sq | (to << 6));
        }
        continue;
      }
      const pc = PIECES[p];
      const sm = pc.step, lm = pc.slide;
      for (let d = 0; d < 8; d++) {
        const bit = 1 << d;
        if (!((sm | lm) & bit)) continue;
        const dx = DIRS[d][0], dy = DIRS[d][1];
        let tx = x + dx, ty = y + dy;
        while (tx >= 0 && ty >= 0 && tx < 8 && ty < 8) {
          const to = ty * 8 + tx;
          const q = b[to] * own;
          if (q > 0) break;
          if (!capsOnly || q < 0) out.push(sq | (to << 6));
          if (q < 0 || !(lm & bit)) break;
          tx += dx; ty += dy;
        }
      }
      // キャスリング：キングもルークも動いていない・あいだが空いている・キングがチェックされていない・通り道に利きがない
      if (p === KING && !capsOnly && pos.castle) {
        const row = side === 0 ? 56 : 0;
        if (sq === row + 4) {
          const opp = 1 - side;
          const ks = side === 0 ? 1 : 4, qs = side === 0 ? 2 : 8;
          if ((pos.castle & ks) && !b[row + 5] && !b[row + 6] && b[row + 7] === ROOK * own &&
              !attacked(b, row + 4, opp) && !attacked(b, row + 5, opp) && !attacked(b, row + 6, opp)) out.push(sq | ((row + 6) << 6));
          if ((pos.castle & qs) && !b[row + 3] && !b[row + 2] && !b[row + 1] && b[row] === ROOK * own &&
              !attacked(b, row + 4, opp) && !attacked(b, row + 3, opp) && !attacked(b, row + 2, opp)) out.push(sq | ((row + 2) << 6));
        }
      }
    }
    return out;
  }

  // ---- 指す・戻す（局面を直接書き換える。戻り値は unmake に渡す情報）----

  // キャスリングの権利を失うマス（そこから動く／そこで取られる）
  const CASTLE_MASK = new Uint8Array(64).fill(15);
  CASTLE_MASK[60] = 15 & ~3; CASTLE_MASK[63] = 15 & ~1; CASTLE_MASK[56] = 15 & ~2;
  CASTLE_MASK[4] = 15 & ~12; CASTLE_MASK[7] = 15 & ~4; CASTLE_MASK[0] = 15 & ~8;

  function make(pos, m) {
    const b = pos.b;
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
    const p = b[from];
    const t = p < 0 ? -p : p;
    let cap = b[to];
    let flag = 0; // 1 = アンパッサン、2 = キャスリング
    const undo = (cap + 8) | (pos.castle << 4) | ((pos.ep + 1) << 8);
    if (t === PAWN && to === pos.ep && !cap) {
      // アンパッサン：取られるポーンは 移動先の うしろ
      const capSq = to + (p > 0 ? 8 : -8);
      cap = b[capSq];
      b[capSq] = 0;
      flag = 1;
    } else if (t === KING && (to - from === 2 || from - to === 2)) {
      if (to > from) { b[from + 1] = b[from + 3]; b[from + 3] = 0; }
      else { b[from - 1] = b[from - 4]; b[from - 4] = 0; }
      flag = 2;
    }
    b[to] = promo ? (p > 0 ? promo : -promo) : p;
    b[from] = 0;
    pos.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    pos.ep = (t === PAWN && (to - from === 16 || from - to === 16)) ? (from + to) >> 1 : -1;
    pos.turn ^= 1;
    return undo | (flag << 15) | ((flag === 1 ? cap + 8 : 0) << 17);
  }

  function unmake(pos, m, u) {
    const b = pos.b;
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
    const flag = (u >> 15) & 3;
    pos.turn ^= 1;
    const p = b[to];
    b[from] = promo ? (p > 0 ? PAWN : -PAWN) : p;
    b[to] = (u & 15) - 8;
    if (flag === 1) {
      b[to + (p > 0 ? 8 : -8)] = ((u >> 17) & 15) - 8;
    } else if (flag === 2) {
      if (to > from) { b[from + 3] = b[from + 1]; b[from + 1] = 0; }
      else { b[from - 4] = b[from - 1]; b[from - 1] = 0; }
    }
    pos.castle = (u >> 4) & 15;
    pos.ep = ((u >> 8) & 127) - 1;
  }

  // 取った駒（make の戻り値から）
  function capturedOf(u) {
    const flag = (u >> 15) & 3;
    return flag === 1 ? ((u >> 17) & 15) - 8 : (u & 15) - 8;
  }

  // ---- 合法手 ----

  function legalRaw(pos, firstOnly) {
    const out = genMoves(pos, []);
    const side = pos.turn;
    const res = [];
    for (const m of out) {
      const u = make(pos, m);
      const ok = !inCheck(pos.b, side);
      unmake(pos, m, u);
      if (ok) {
        res.push(m);
        if (firstOnly) return res;
      }
    }
    return res;
  }

  function posOf(s) { return { b: s.board.slice(), turn: s.turn, castle: s.castle, ep: s.ep }; }

  function legalMoves(s) {
    if (s.winner !== null) return [];
    return legalRaw(posOf(s), false);
  }

  // 盤上の駒 1枚が（チェックなどを考えずに）動けるマス。相手の駒の「届く範囲」の表示用
  function reachFrom(s, sq) {
    const p = s.board[sq];
    if (!p) return [];
    const pos = { b: s.board.slice(), turn: sideOf(p), castle: 0, ep: -1 };
    const out = [];
    for (const m of genMoves(pos, [])) if (mFrom(m) === sq && !out.includes(mTo(m))) out.push(mTo(m));
    // ポーンは、いま とれる駒が なくても ななめまえに 利いている
    if (typeOf(p) === PAWN) {
      const x = sq & 7, ty = (sq >> 3) + (p > 0 ? -1 : 1);
      if (ty >= 0 && ty < 8) for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < 8 && !out.includes(ty * 8 + x + dx)) out.push(ty * 8 + x + dx);
    }
    return out;
  }

  // ---- 局面 ----

  const BACK = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];

  function newGame(opts) {
    opts = opts || {};
    const board = new Int8Array(N);
    for (let x = 0; x < 8; x++) {
      board[x] = -BACK[x];
      board[8 + x] = -PAWN;
      board[48 + x] = PAWN;
      board[56 + x] = BACK[x];
    }
    const hc = HANDICAPS[opts.handicap] || HANDICAPS.none;
    const hs = opts.handicapSide === 0 ? 0 : 1;
    let castle = 15;
    for (const [x, y] of hc.remove) {
      const sq = hs === 1 ? y * 8 + x : (7 - y) * 8 + x;
      board[sq] = 0;
      castle &= CASTLE_MASK[sq];
    }
    const s = {
      board, turn: 0, castle, ep: -1, half: 0, ply: 0,
      handicap: opts.handicap || 'none', handicapSide: hs,
      keys: [], kifu: [], last: null, inCheck: false,
      winner: null, result: null,
    };
    s.keys.push(posKey(s));
    return s;
  }

  function clone(s) {
    return {
      board: s.board.slice(), turn: s.turn, castle: s.castle, ep: s.ep, half: s.half, ply: s.ply,
      handicap: s.handicap, handicapSide: s.handicapSide,
      keys: s.keys.slice(), kifu: s.kifu.slice(),
      last: s.last, inCheck: s.inCheck, winner: s.winner, result: s.result,
    };
  }

  // 同一局面の判定用。アンパッサンのマスは、実際に取れるときだけ区別する
  function posKey(s) {
    let ep = -1;
    if (s.ep >= 0) {
      const own = s.turn === 0 ? 1 : -1;
      const y = (s.ep >> 3) + own, x = s.ep & 7;
      if ((x > 0 && s.board[y * 8 + x - 1] === PAWN * own) || (x < 7 && s.board[y * 8 + x + 1] === PAWN * own)) ep = s.ep;
    }
    return s.turn + ':' + s.board.join(',') + ':' + s.castle + ':' + ep;
  }

  // 代数式記法（SAN）：Nf3、exd5、O-O、e8=Q+ など
  function moveText(s, m, legal) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m);
    const p = s.board[from], t = typeOf(p);
    let txt;
    if (t === KING && Math.abs(to - from) === 2) {
      txt = to > from ? 'O-O' : 'O-O-O';
    } else {
      const capture = !!s.board[to] || (t === PAWN && to === s.ep);
      if (t === PAWN) {
        txt = (capture ? FILES[from & 7] + 'x' : '') + sqName(to) + (promo ? '=' + PIECES[promo].letter : '');
      } else {
        txt = PIECES[t].letter;
        // 同じ種類の駒が同じマスに行けるときは、どの駒かを書き分ける
        const others = (legal || legalMoves(s)).filter(o => mTo(o) === to && mFrom(o) !== from && s.board[mFrom(o)] === p);
        if (others.length) {
          const sameFile = others.some(o => (mFrom(o) & 7) === (from & 7));
          const sameRank = others.some(o => (mFrom(o) >> 3) === (from >> 3));
          if (!sameFile) txt += FILES[from & 7];
          else if (!sameRank) txt += 8 - (from >> 3);
          else txt += sqName(from);
        }
        txt += (capture ? 'x' : '') + sqName(to);
      }
    }
    const pos = posOf(s);
    make(pos, m);
    if (inCheck(pos.b, pos.turn)) txt += legalRaw(pos, true).length ? '+' : '#';
    return txt;
  }

  // 子ども向けの 指し手の説明（「ナイト b1 → c3」など）
  function moveWords(s, m) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m);
    const t = typeOf(s.board[from]);
    if (t === KING && Math.abs(to - from) === 2) return `キャスリング（${to > from ? 'みじかい ほう' : 'ながい ほう'}）`;
    let w = `${PIECES[t].name} ${sqName(from)} → ${sqName(to)}`;
    const cap = s.board[to] || (t === PAWN && to === s.ep ? PAWN : 0);
    if (cap) w += `（${PIECES[typeOf(cap)].name}を とる${t === PAWN && to === s.ep && !s.board[to] ? '・アンパッサン' : ''}）`;
    if (promo) w += ` ${PIECES[promo].name}に なる`;
    return w;
  }

  // 駒が足りなくて どちらも チェックメイトできない
  function insufficient(b) {
    const minors = [];
    for (let sq = 0; sq < N; sq++) {
      const t = typeOf(b[sq]);
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors.push([t, sqColor(sq)]);
    }
    if (minors.length <= 1) return true;
    // ビショップだけで、ぜんぶ おなじ いろの マス
    return minors.every(([t, c]) => t === BISHOP && c === minors[0][1]);
  }

  function apply(s, m) {
    const n = clone(s);
    const side = s.turn;
    const from = mFrom(m), to = mTo(m), promo = mPromo(m);
    const piece = typeOf(s.board[from]);
    n.kifu.push(moveText(s, m));
    const pos = posOf(s);
    const u = make(pos, m);
    const cap = capturedOf(u);
    n.board = pos.b; n.turn = pos.turn; n.castle = pos.castle; n.ep = pos.ep;
    const castling = piece === KING && Math.abs(to - from) === 2;
    n.last = {
      move: m, from, to, piece, promo, side, captured: cap ? typeOf(cap) : 0,
      enPassant: piece === PAWN && to === s.ep && !s.board[to],
      castle: castling ? (to > from ? 'short' : 'long') : null,
      rookFrom: castling ? (to > from ? from + 3 : from - 4) : -1,
      rookTo: castling ? (to > from ? from + 1 : from - 1) : -1,
    };
    n.ply++;
    n.half = (piece === PAWN || cap) ? 0 : s.half + 1;
    n.inCheck = inCheck(n.board, n.turn);
    const key = posKey(n);
    n.keys.push(key);

    if (!legalRaw(pos, true).length) {
      if (n.inCheck) { n.winner = side; n.result = 'mate'; }
      else { n.winner = -1; n.result = 'stalemate'; }
      return n;
    }
    if (insufficient(n.board)) { n.winner = -1; n.result = 'material'; return n; }
    let seen = 0;
    for (let k = 0; k < n.keys.length; k++) if (n.keys[k] === key) seen++;
    if (seen >= 3) { n.winner = -1; n.result = 'repetition'; return n; }
    if (n.half >= 100) { n.winner = -1; n.result = 'fifty'; return n; }
    if (n.ply >= MAX_PLY) { n.winner = -1; n.result = 'maxply'; }
    return n;
  }

  function resign(s) {
    const n = clone(s);
    n.winner = 1 - s.turn;
    n.result = 'resign';
    return n;
  }

  function replay(opts, moves) {
    let s = newGame(opts);
    for (const m of moves) {
      if (s.winner !== null) break;
      if (!legalMoves(s).includes(m)) break;
      s = apply(s, m);
    }
    return s;
  }

  // ---- FEN（局面の文字表記）----
  // 例：'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const FEN_CH = ' PNBRQK';

  function toFen(s) {
    const rows = [];
    for (let y = 0; y < 8; y++) {
      let r = '', empty = 0;
      for (let x = 0; x < 8; x++) {
        const p = s.board[y * 8 + x];
        if (!p) { empty++; continue; }
        if (empty) { r += empty; empty = 0; }
        const c = FEN_CH[typeOf(p)];
        r += p > 0 ? c : c.toLowerCase();
      }
      rows.push(r + (empty || ''));
    }
    let c = '';
    if (s.castle & 1) c += 'K';
    if (s.castle & 2) c += 'Q';
    if (s.castle & 4) c += 'k';
    if (s.castle & 8) c += 'q';
    return `${rows.join('/')} ${s.turn === 0 ? 'w' : 'b'} ${c || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half || 0} ${((s.ply || 0) >> 1) + 1}`;
  }

  function parseFen(fen) {
    const [bd, tn, cs, ep, half] = fen.trim().split(/\s+/);
    const board = new Int8Array(N);
    bd.split('/').forEach((row, y) => {
      let x = 0;
      for (const c of row) {
        if (/\d/.test(c)) { x += +c; continue; }
        const t = FEN_CH.indexOf(c.toUpperCase());
        board[y * 8 + x] = c === c.toUpperCase() ? t : -t;
        x++;
      }
    });
    let castle = 0;
    if (cs && cs !== '-') {
      if (cs.includes('K')) castle |= 1;
      if (cs.includes('Q')) castle |= 2;
      if (cs.includes('k')) castle |= 4;
      if (cs.includes('q')) castle |= 8;
    }
    const epSq = ep && ep !== '-' ? (8 - +ep[1]) * 8 + FILES.indexOf(ep[0]) : -1;
    return { board, turn: tn === 'b' ? 1 : 0, castle, ep: epSq, half: +half || 0 };
  }

  // 任意の局面から始める（チェックメイト問題など）
  function fromPosition(p) {
    const s = {
      board: Int8Array.from(p.board), turn: p.turn, castle: p.castle || 0, ep: p.ep === undefined ? -1 : p.ep,
      half: p.half || 0, ply: 0,
      handicap: 'none', handicapSide: 1,
      keys: [], kifu: [], last: null, inCheck: false,
      winner: null, result: null,
    };
    s.inCheck = inCheck(s.board, s.turn);
    s.keys.push(posKey(s));
    return s;
  }

  global.Engine = {
    SIZE, N, MAX_PLY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    SIDES, DIRS, KNIGHT_JUMPS, PIECES, PROMO_ORDER, HANDICAPS, HANDICAP_ORDER, FILES,
    inB, sideOf, typeOf, sqName, sqColor, promoRow,
    mFrom, mTo, mPromo, encode,
    genMoves, reachFrom, attacked, attackers, kingSq, inCheck, make, unmake, capturedOf, legalRaw, legalMoves, posOf,
    newGame, clone, posKey, moveText, moveWords, insufficient, apply, resign, replay, toFen, parseFen, fromPosition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
