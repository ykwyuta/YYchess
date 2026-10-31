// チェックメイト問題の解説・タイトル・まちがえやすい手を局面から自動で作る
'use strict';
require('../js/rules.js');
require('../js/mate.js');
const E = globalThis.Engine, MT = globalThis.Mate;
const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = E;
const NAME = t => E.PIECES[t].name;

function joinJa(list) { return list.length <= 1 ? list.join('') : list.slice(0, -1).join('・') + ' と ' + list[list.length - 1]; }

// メイトの局面で、なぜ逃げられないのか
function whyMate(s) {
  const b = s.board;
  const k = E.kingSq(b, 1), kx = k & 7, ky = k >> 3;
  const checkers = E.attackers(b, k, 0);
  const nb = b.slice(); nb[k] = 0; // キングがいない盤（キングのうしろに逃げても にらまれている）
  const byPiece = new Map(); const own = [], guarded = [];
  const checkersAll = checkers;
  for (const [dx, dy] of E.DIRS) {
    const x = kx + dx, y = ky + dy;
    if (x < 0 || y < 0 || x > 7 || y > 7) continue;
    const sq = y * 8 + x;
    if (b[sq] < 0) { own.push(E.sqName(sq)); continue; }
    if (b[sq] > 0) {
      // となりの しろの 駒：まもられているので とれない（チェックしている駒は あとで説明）
      if (!checkersAll.includes(sq)) {
        const g = E.attackers(b, sq, 0).map(a => E.typeOf(b[a])).sort((p, q) => (p === KING) - (q === KING));
        if (g.length) guarded.push(`${E.sqName(sq)} の ${NAME(E.typeOf(b[sq]))}は ${g[0] === KING ? 'しろの キング' : NAME(g[0])}が まもっていて とれない`);
      }
      continue;
    }
    const at = E.attackers(nb, sq, 0);
    if (!at.length) continue;
    // いちばん わかりやすい 駒（キング以外を優先）
    const names = [...new Set(at.map(a => E.typeOf(b[a])))].sort((p, q) => (p === KING) - (q === KING));
    const who = names[0] === KING ? 'しろの キング' : NAME(names[0]);
    if (!byPiece.has(who)) byPiece.set(who, []);
    byPiece.get(who).push(E.sqName(sq));
    byPiece.get(who).sort();
  }
  const parts = [];
  for (const [who, sqs] of byPiece) parts.push(`${joinJa(sqs)} は ${who}が にらんでいる`);
  if (own.length) parts.push(`${joinJa(own)} は じぶんの こまで ふさがっている`);
  parts.push(...guarded);
  let txt = parts.length ? `くろの キングの にげみち：${parts.join('。')}。` : '';
  if (checkers.length >= 2) {
    txt += '2つの こまで いっぺんに チェック（ダブルチェック）なので、とることも あいだに はいることも できないよ。';
  } else {
    const c = checkers[0], ct = E.typeOf(b[c]);
    const adj = Math.max(Math.abs((c & 7) - kx), Math.abs((c >> 3) - ky)) <= 1;
    const defs = E.attackers(b, c, 1).filter(a => E.typeOf(b[a]) !== KING);
    if (adj && !defs.length) {
      const guard = E.attackers(b, c, 0).map(a => E.typeOf(b[a]));
      if (guard.length) txt += `${NAME(ct)}は ${guard.includes(KING) && guard.length === 1 ? 'しろの キング' : NAME(guard.filter(t => t !== KING)[0])}が まもっているので、キングは とれないよ。`;
    } else if (!adj && ct !== KNIGHT && ct !== PAWN) {
      txt += `チェックしている ${NAME(ct)}を とることも、あいだに こまを いれて ふせぐことも できないよ。`;
    } else if (ct === KNIGHT) {
      txt += 'ナイトの チェックは とびこえて くるので、あいだに はいって ふせげないよ。';
    }
  }
  return txt;
}

function describe(fen, N) {
  const p = E.parseFen(fen);
  const pos = { b: p.board, turn: 0, castle: 0, ep: -1 };
  const S = new MT.Solver();
  const ml = S.mainLine(pos, N);
  let s = E.fromPosition(p);
  const states = [s];
  for (const m of ml.line) { s = E.apply(s, m); states.push(s); }
  const answer = s.kifu.join(' ');
  const tags = new Set();
  // タイトル用の特徴
  const last = s.last;
  const k = E.kingSq(s.board, 1);
  const checkers = E.attackers(s.board, k, 0);
  const kx = k & 7, ky = k >> 3;
  let allOwn = true;
  for (const [dx, dy] of E.DIRS) {
    const x = kx + dx, y = ky + dy;
    if (x < 0 || y < 0 || x > 7 || y > 7) continue;
    if (s.board[y * 8 + x] >= 0) allOwn = false;
  }
  if (checkers.length >= 2) tags.add('double');
  else if (!checkers.includes(last.to)) tags.add('discovered');
  if (last.piece === KNIGHT && allOwn) tags.add('smothered');
  if (ky === 0 && (last.piece === ROOK || last.piece === QUEEN) && (last.to >> 3) === 0 && !tags.has('double')) {
    // うしろの だん：キングの前が じぶんの こまで ふさがっている
    let blocked = true;
    for (const dx of [-1, 0, 1]) { const x = kx + dx; if (x >= 0 && x < 8 && s.board[8 + x] >= 0 && !E.attacked(s.board, 8 + x, 0)) blocked = false; }
    if (blocked) tags.add('backrank');
  }
  ml.line.forEach((m, i) => {
    const st = states[i];
    if (E.mPromo(m)) tags.add('promo');
    if (i % 2 === 1 && st.board[E.mTo(m)]) tags.add('sacrifice');
  });
  const kingHelps = E.attackers(s.board, k, 0).length === 0 ? false : (() => {
    const wk = E.kingSq(s.board, 0);
    return Math.max(Math.abs((wk & 7) - kx), Math.abs((wk >> 3) - ky)) === 2;
  })();
  if (kingHelps) tags.add('king');

  const mateName = NAME(last.promo || last.piece);
  let title;
  if (tags.has('smothered')) title = 'スマザードメイト';
  else if (tags.has('double')) title = 'ダブルチェック';
  else if (tags.has('discovered')) title = 'あきチェック';
  else if (tags.has('promo')) title = `ポーンが ${NAME(last.promo || QUEEN)}に`;
  else if (tags.has('sacrifice')) title = 'すてごまで さそいだす';
  else if (tags.has('backrank')) title = 'うしろの だんで メイト';
  else if (tags.has('king')) title = `キングと ${mateName}`;
  else title = `${mateName}で メイト`;

  // 解説
  let text = '';
  ml.line.forEach((m, i) => {
    const st = states[i];
    if (i % 2 === 0) {
      const w = E.moveWords(st, m);
      const final = i === ml.line.length - 1;
      const after = states[i + 1];
      const ck = E.attackers(after.board, E.kingSq(after.board, 1), 0);
      const d = !ck.includes(E.mTo(m)) ? 'うごいた こまの うしろから ' : ck.length >= 2 ? '2つの こまで いっぺんに ' : '';
      text += `${w}。${d}${final ? 'チェックメイト！' : 'チェック！'}`;
    } else {
      const w = E.moveWords(st, m);
      const only = E.legalMoves(st).length === 1;
      text += `くろは ${w}${only ? '（これしか ない）' : ''}。`;
    }
  });
  text += whyMate(s);

  // まちがえやすい手：ほかのチェックと、そのときの くろの 逃げ方
  const s0 = states[0];
  const traps = [];
  const checks = S.checks({ b: p.board.slice(), turn: 0, castle: 0, ep: -1 }).filter(m => m !== ml.line[0]);
  const ans = ml.line[0], ansT = E.typeOf(s0.board[E.mFrom(ans)]);
  const score = m => (E.typeOf(s0.board[E.mFrom(m)]) === ansT ? 4 : 0) + (E.mTo(m) === E.mTo(ans) ? 3 : 0) + (s0.board[E.mTo(m)] ? 1 : 0);
  checks.sort((a, b) => score(b) - score(a) || a - b);
  for (const m of checks.slice(0, 2)) {
    const q = { b: p.board.slice(), turn: 0, castle: 0, ep: -1 };
    E.make(q, m);
    if (S.defend(q, N - 1)) continue; // これでもメイトできる（手数が同じ）なら のせない
    const d = S.bestDefense(q, N - 1);
    const s1 = E.apply(s0, m);
    traps.push([E.moveText(s0, m), E.moveText(s1, d.move)]);
  }
  return { moves: N, fen, answer, title, text: text.trim(), traps, tags: [...tags] };
}

module.exports = { describe, whyMate };
