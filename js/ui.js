/*
 * うごきがみえるチェス — 画面表示と操作
 */
(function () {
  'use strict';
  const E = window.Engine;
  const AI = window.AI;
  const MT = window.Mate;
  const PROBS = window.MATE_PROBLEMS || [];
  const P = E.PIECES;
  const { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } = E;
  const $ = id => document.getElementById(id);
  const STORE = 'yychess.v1';

  const app = {
    G: null,
    states: [],         // states[k] = k 手目のあとの局面（まった用）
    moves: [],
    mode: 'cpu',        // 'cpu' | 'two' | 'tsume'
    human: [true, false],
    level: 'beginner',
    handicap: 'none',
    flip: false,        // くろを下に表示する
    sel: null,          // {kind:'board', sq} | {kind:'look', sq}
    legal: [],
    targets: new Map(), // 選択中の駒の行き先 → 指し手の配列
    hint: null,
    busy: false,
    token: 0,           // 新しいゲームやまったで、古い CPU の思考結果を捨てるため
    anim: null,
    settings: { guide: true, danger: true, furi: true, sound: true },
    tsume: null,        // メイト問題中：{ idx, solver, failed, demo }
    tsumeDone: {},      // クリアした問題（番号 → true）
  };

  const cells = [];

  // ---------- 保存 ----------

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        settings: app.settings,
        tsumeDone: app.tsumeDone,
        game: { mode: app.mode, human: app.human, level: app.level, handicap: app.handicap, flip: app.flip, moves: app.moves, tsume: app.tsume ? app.tsume.idx : null },
      }));
    } catch (e) { /* 保存できない環境でも遊べる */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // ---------- 駒の絵 ----------

  // 駒の形（100×100 のまんなか。まわりに うごきマークを描く すきまを残す）
  const BASE = '<rect class="body" x="31" y="72" width="38" height="8" rx="3"/>';
  const SHAPES = {
    [PAWN]: '<path class="body" d="M39,72 C39,62 42,55 46,51 C41,49 40,44 41,40 C42,34 46,31 50,31 C54,31 58,34 59,40 C60,44 59,49 54,51 C58,55 61,62 61,72 Z"/>' + BASE,
    [ROOK]: '<path class="body" d="M35,72 L39,48 H35 V29 H42 V35 H47 V29 H53 V35 H58 V29 H65 V48 H61 L65,72 Z"/><path class="detail" d="M39,48 H61"/>' + BASE,
    [BISHOP]: '<path class="body" d="M38,72 C35,62 37,52 43,44 C46,40 48,37 50,34 C52,37 54,40 57,44 C63,52 65,62 62,72 Z"/><circle class="body" cx="50" cy="29" r="4.5"/><path class="detail" d="M54,45 L47,55"/>' + BASE,
    [KNIGHT]: '<path class="body" d="M36,72 C37,64 42,59 47,55 C48,52 47,50 45,50 L39,55 C36,57 32,55 32,51 C32,48 34,46 36,43 C40,37 44,33 47,32 L49,25 L54,31 C62,34 67,43 68,54 C69,61 68,67 67,72 Z"/><circle class="detail-fill" cx="47" cy="40" r="2.6"/>' + BASE,
    [QUEEN]: '<path class="body" d="M35,72 L29,42 L40,55 L41,35 L47,53 L50,31 L53,53 L59,35 L60,55 L71,42 L65,72 Z"/>' +
      '<circle class="body" cx="29" cy="40" r="3.5"/><circle class="body" cx="41" cy="33" r="3.5"/><circle class="body" cx="50" cy="29" r="3.5"/><circle class="body" cx="59" cy="33" r="3.5"/><circle class="body" cx="71" cy="40" r="3.5"/>' +
      '<path class="detail" d="M37,64 H63"/>' + BASE,
    [KING]: '<path class="body" d="M35,72 C31,62 30,52 37,48 C43,45 48,50 50,55 C52,50 57,45 63,48 C70,52 69,62 65,72 Z"/>' +
      '<path class="body" d="M47.5,26 H52.5 V31 H57 V36 H52.5 V47 H47.5 V36 H43 V31 H47.5 Z"/><path class="detail" d="M37,64 H63"/>' + BASE,
  };

  // 駒の絵（100×100）。down = 上側（相手側）。駒の絵は向きを変えず、うごきマークだけ向きを変える
  function pieceSVG(t, side, down, opts) {
    opts = opts || {};
    const guide = opts.guide !== undefined ? opts.guide : app.settings.guide;
    let g = '';
    if (guide) g += `<g${down ? ' transform="rotate(180 50 50)"' : ''}>${markers(t)}</g>`;
    g += SHAPES[t];
    if (opts.furi !== false) g += `<text class="furi" x="50" y="${down ? 14 : 92}">${P[t].name}</text>`;
    return `<svg class="pc s${side}${down ? ' down' : ''}" viewBox="0 0 100 100" aria-hidden="true">${g}</svg>`;
  }

  // うごきマーク：● = 1マス、▲ = どこまでも、○ = ジャンプ、× = とる ときだけ（駒が上を向いた向きで描く）
  function markers(t) {
    const pc = P[t];
    let h = '';
    for (let d = 0; d < 8; d++) {
      const bit = 1 << d;
      const r = d % 2 ? 55 : 42;
      const rot = `rotate(${d * 45} 50 50)`;
      if (pc.slide & bit) h += `<path class="mk" d="M50,${50 - r - 6}l7,10h-14z" transform="${rot}"/>`;
      else if (pc.step & bit) h += `<circle class="mk" cx="50" cy="${50 - r}" r="5.5" transform="${rot}"/>`;
      else if (pc.capture & bit) {
        // × は まわさずに描く（まわすと ＋ に見える）
        const a = d * Math.PI / 4, cx = 50 + Math.sin(a) * (r - 2), cy = 50 - Math.cos(a) * (r - 2);
        h += `<path class="mk-cap" d="M${cx - 4.5},${cy - 4.5}l9,9m0,-9l-9,9"/>`;
      }
    }
    if (pc.jump) for (const [dx, dy] of E.KNIGHT_JUMPS) h += `<circle class="mk-jump" cx="${50 + dx * 21}" cy="${50 + dy * 21}" r="5"/>`;
    return h;
  }

  // 5×5 の「うごきの図」
  function diagramSVG(t, side, down) {
    const pc = P[t];
    const f = down ? -1 : 1;
    let h = '';
    for (let i = 0; i <= 5; i++) h += `<path class="dg-line" d="M${i * 20},0V100M0,${i * 20}H100"/>`;
    const cell = (x, y, cls) => `<rect class="${cls}" x="${x * 20 + 1}" y="${y * 20 + 1}" width="18" height="18" rx="3"/>`;
    let marks = '';
    for (let d = 0; d < 8; d++) {
      const bit = 1 << d;
      const dx = E.DIRS[d][0] * f, dy = E.DIRS[d][1] * f;
      if (pc.slide & bit) {
        for (let k = 1; k <= 2; k++) h += cell(2 + dx * k, 2 + dy * k, 'dg-slide');
        const x2 = 50 + dx * 46, y2 = 50 + dy * 46;
        marks += `<path class="dg-arrow" d="M${50 + dx * 12},${50 + dy * 12}L${x2 - dx * 4},${y2 - dy * 4}"/>`;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI;
        marks += `<path class="dg-head" d="M0,-5L8,0L0,5z" transform="translate(${x2 - dx * 3} ${y2 - dy * 3}) rotate(${ang})"/>`;
      } else if (pc.step & bit) {
        h += cell(2 + dx, 2 + dy, 'dg-step');
        marks += `<circle class="dg-dot" cx="${50 + dx * 20}" cy="${50 + dy * 20}" r="5"/>`;
        if (pc.pawn) { // さいしょだけ 2マス
          h += cell(2 + dx * 2, 2 + dy * 2, 'dg-slide');
          marks += `<circle class="dg-ring" cx="${50 + dx * 40}" cy="${50 + dy * 40}" r="4"/>`;
        }
      } else if (pc.capture & bit) {
        h += cell(2 + dx, 2 + dy, 'dg-capcell');
        const cx = 50 + dx * 20, cy = 50 + dy * 20;
        marks += `<path class="dg-x" d="M${cx - 5},${cy - 5}l10,10m0,-10l-10,10"/>`;
      }
    }
    if (pc.jump) {
      for (const [dx, dy] of E.KNIGHT_JUMPS) {
        h += cell(2 + dx, 2 + dy, 'dg-step');
        marks += `<circle class="dg-ring" cx="${50 + dx * 20}" cy="${50 + dy * 20}" r="5"/>`;
      }
    }
    h += `<rect class="dg-center" x="41" y="41" width="18" height="18" rx="3"/>`;
    h += `<g class="pc s${side}" transform="translate(40 40) scale(0.2)">${SHAPES[t]}</g>`;
    return `<svg class="diagram s${side}" viewBox="-2 -2 104 104" aria-hidden="true">${h}${marks}</svg>`;
  }

  // ---------- 初期化 ----------

  function init() {
    const board = $('board');
    for (let v = 0; v < E.N; v++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.v = v;
      board.appendChild(c);
      cells.push(c);
    }
    board.addEventListener('click', e => {
      const c = e.target.closest('.cell');
      if (c) onCell(viewToSq(+c.dataset.v));
    });

    $('btn-menu').addEventListener('click', () => { $('btn-resign').disabled = !canResign(); $('dlg-menu').showModal(); });
    $('btn-guide').addEventListener('click', () => $('dlg-guide').showModal());
    $('btn-hint').addEventListener('click', onHint);
    $('btn-tsume').addEventListener('click', openTsumeList);
    $('btn-ts-retry').addEventListener('click', () => { if (app.tsume) startTsume(app.tsume.idx, []); });
    $('btn-ts-answer').addEventListener('click', () => { if (app.tsume && !app.tsume.demo) tsumeResult('answer'); });
    $('dlg-tsume').addEventListener('close', () => {
      const v = $('dlg-tsume').returnValue;
      if (/^\d+$/.test(v)) startTsume(+v, []);
    });
    $('dlg-tsume-result').addEventListener('close', () => onTsumeResult($('dlg-tsume-result').returnValue));
    $('btn-undo').addEventListener('click', onUndo);

    $('dlg-menu').addEventListener('close', () => {
      const v = $('dlg-menu').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'howto') $('dlg-howto').showModal();
      else if (v === 'tsume') openTsumeList();
      else if (v === 'guide') $('dlg-guide').showModal();
      else if (v === 'settings') openSettings();
      else if (v === 'resign') onResign();
    });
    const fNew = $('dlg-new').querySelector('form');
    fNew.addEventListener('change', syncNewForm);
    $('dlg-new').addEventListener('close', () => {
      if ($('dlg-new').returnValue !== 'ok') return;
      const order = fNew.order.value === 'random' ? (Math.random() < 0.5 ? 'first' : 'second') : fNew.order.value;
      startGame({ mode: fNew.mode.value, level: fNew.level.value, order, handicap: fNew.handicap.value });
    });
    $('dlg-settings').addEventListener('close', () => {
      const f = $('dlg-settings').querySelector('form');
      for (const k of Object.keys(app.settings)) app.settings[k] = f[k].checked;
      applySettings();
      save();
      render();
    });
    $('dlg-result').addEventListener('close', () => {
      const v = $('dlg-result').returnValue;
      if (v === 'new') openNew(false);
      else if (v === 'undo') onUndo();
    });
    $('dlg-promote').addEventListener('close', () => {
      const v = $('dlg-promote').returnValue;
      const pend = app.pendingPromo;
      app.pendingPromo = null;
      if (!pend || !/^\d$/.test(v)) return;
      const m = pend.find(x => E.mPromo(x) === +v);
      if (m !== undefined) commit(m);
    });
    // 「なにに かわる？」は外側をタップしても閉じない（選ぶまで待つ）
    $('dlg-promote').addEventListener('cancel', e => e.preventDefault());

    const sel = $('sel-handicap');
    sel.innerHTML = E.HANDICAP_ORDER.map(k => `<option value="${k}">${E.HANDICAPS[k].name}</option>`).join('');

    fillGuide();
    new ResizeObserver(() => {
      const w = $('board').clientWidth / 8;
      document.body.classList.toggle('roomy', w >= 52);
    }).observe($('board'));

    const saved = load();
    if (saved && saved.settings) Object.assign(app.settings, saved.settings);
    if (saved && saved.tsumeDone) app.tsumeDone = saved.tsumeDone;
    applySettings();
    const g = saved && saved.game;
    if (g && g.mode === 'tsume' && PROBS[g.tsume]) {
      startTsume(g.tsume, g.moves || []);
    } else if (g && Array.isArray(g.moves)) {
      app.mode = g.mode === 'two' ? 'two' : 'cpu';
      app.human = g.human || [true, false];
      app.level = AI.LEVELS[g.level] ? g.level : 'beginner';
      app.handicap = E.HANDICAPS[g.handicap] ? g.handicap : 'none';
      app.flip = !!g.flip;
      rebuild(g.moves);
      renderLabels();
      render();
      if (app.G.winner === null) proceed();
    } else {
      startGame({ mode: 'cpu', level: 'beginner', order: 'first', handicap: 'none' }, true);
      openNew(true);
    }
  }

  function applySettings() {
    document.body.classList.toggle('no-furi', !app.settings.furi);
  }

  function openSettings() {
    const f = $('dlg-settings').querySelector('form');
    for (const k of Object.keys(app.settings)) f[k].checked = app.settings[k];
    $('dlg-settings').showModal();
  }

  function openNew(first) {
    const f = $('dlg-new').querySelector('form');
    f.mode.value = app.mode === 'two' ? 'two' : 'cpu';
    f.level.value = app.level;
    f.handicap.value = app.handicap;
    $('welcome').hidden = !first;
    $('btn-new-cancel').hidden = !!first;
    syncNewForm();
    $('dlg-new').showModal();
  }
  function syncNewForm() {
    const f = $('dlg-new').querySelector('form');
    const cpu = f.mode.value === 'cpu';
    f.querySelectorAll('.cpu-only').forEach(el => { el.hidden = !cpu; });
    $('hc-legend').textContent = cpu ? 'ハンデ（CPU の こまを へらす）' : 'ハンデ（くろ の こまを へらす）';
  }

  function fillGuide() {
    const card = t => `<div class="g-item">${pieceSVG(t, 0, false, { guide: true, furi: false })}` +
      `<div class="g-body"><div class="g-head"><b>${P[t].name}</b><small>${P[t].letter || '（なし）'}</small></div><p>${P[t].desc}</p></div>${diagramSVG(t, 0, false)}</div>`;
    $('guide-base').innerHTML = [KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN].map(card).join('');
    const sp = (title, text, fig) => `<div class="g-item">${fig}<div class="g-body"><div class="g-head"><b>${title}</b></div><p>${text}</p></div></div>`;
    $('guide-special').innerHTML = [
      sp('プロモーション', 'ポーンが あいての いちばん おくの だんまで いくと、クイーン・ルーク・ビショップ・ナイトの どれかに かわれるよ。たいてい クイーンが いちばん つよい！', miniFig('promo')),
      sp('キャスリング', 'キングと ルークが まだ いちども うごいて いないとき、キングを ルークの ほうへ 2マス うごかすと、ルークが キングを とびこえて となりに くるよ。キングを まもる ための 1手。チェックされている ときや、とおりみちを ねらわれている ときは できないよ。', miniFig('castle')),
      sp('アンパッサン', 'あいての ポーンが 2マス すすんで、じぶんの ポーンの すぐ よこに きたら、つぎの 1手だけ、ななめうしろに まわって とれるよ（とおりすぎた マスに すすんで とる）。', miniFig('ep')),
    ].join('');
  }

  // とくべつな ルールの 小さな図（3×3 など）
  function miniFig(kind) {
    const sq = (x, y, dark) => `<rect x="${x * 25}" y="${y * 25}" width="25" height="25" class="${dark ? 'mf-dark' : 'mf-light'}"/>`;
    const pc = (t, side, x, y) => `<g class="pc s${side}" transform="translate(${x * 25} ${y * 25}) scale(0.25)">${SHAPES[t]}</g>`;
    let h = '';
    if (kind === 'promo') {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) h += sq(x, y, (x + y) % 2);
      h += pc(PAWN, 0, 1, 1) + `<path class="mf-arrow" d="M37.5,30V16"/>` + `<g opacity="0.55">${pc(QUEEN, 0, 1, 0)}</g>`;
      return `<svg class="minifig" viewBox="0 0 75 50" aria-hidden="true">${h}</svg>`;
    }
    if (kind === 'castle') {
      // うえ：キャスリングの まえ、した：あと
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) h += `<rect x="${x * 25}" y="${y * 31}" width="25" height="25" class="${(x + y) % 2 ? 'mf-dark' : 'mf-light'}"/>`;
      const at = (t, x, y) => `<g class="pc s0" transform="translate(${x * 25} ${y * 31}) scale(0.25)">${SHAPES[t]}</g>`;
      h += at(KING, 0, 0) + at(ROOK, 3, 0) + at(ROOK, 1, 1) + at(KING, 2, 1);
      h += '<path class="mf-arrow" d="M12.5,24 L62.5,33"/><path class="mf-arrow alt" d="M87.5,24 L37.5,33"/>';
      return `<svg class="minifig" viewBox="0 0 100 56" aria-hidden="true">${h}</svg>`;
    }
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) h += sq(x, y, (x + y) % 2);
    h += pc(PAWN, 0, 0, 1) + pc(PAWN, 1, 1, 1) + '<path class="mf-arrow" d="M14,36 L36,16"/>';
    return `<svg class="minifig" viewBox="0 0 50 50" aria-hidden="true">${h}</svg>`;
  }

  function startGame(o, silent) {
    app.token++;
    app.busy = false;
    app.tsume = null;
    document.body.classList.remove('tsume-mode');
    app.mode = o.mode;
    app.level = o.level || 'beginner';
    app.handicap = o.handicap || 'none';
    if (o.mode === 'cpu') {
      app.human = o.order === 'second' ? [false, true] : [true, false];
      app.flip = o.order === 'second';
    } else {
      app.human = [true, true];
      app.flip = false;
    }
    rebuild([]);
    $('kifu').innerHTML = '';
    renderLabels();
    save();
    render();
    if (!silent) proceed();
  }

  function gameOpts() {
    // ハンデは CPU 側（ふたりで遊ぶときは くろ）から駒を減らす
    const hs = app.mode === 'cpu' ? (app.human[0] ? 1 : 0) : 1;
    return { handicap: app.handicap, handicapSide: hs };
  }

  function rebuild(moves) {
    let s = app.mode === 'tsume' ? tsumeStart(app.tsume.idx) : E.newGame(gameOpts());
    app.states = [s];
    app.moves = [];
    for (const m of moves) {
      if (s.winner !== null || !E.legalMoves(s).includes(m)) break;
      s = E.apply(s, m);
      app.states.push(s);
      app.moves.push(m);
    }
    app.G = s;
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(s);
  }

  // ---------- 盤の向き ----------

  function viewToSq(v) { return app.flip ? 63 - v : v; }
  function sqToView(sq) { return app.flip ? 63 - sq : sq; }
  function bottomSide() { return app.flip ? 1 : 0; }
  function isDown(side) { return side !== bottomSide(); }

  function renderLabels() {
    let f = '', r = '';
    for (let v = 0; v < 8; v++) {
      f += `<span>${E.FILES[app.flip ? 7 - v : v]}</span>`;
      r += `<span>${app.flip ? v + 1 : 8 - v}</span>`;
    }
    $('files').innerHTML = f;
    $('ranks').innerHTML = r;
  }

  // ---------- 状態の問い合わせ ----------

  function humanTurn() { return app.G.winner === null && app.human[app.G.turn] && !app.busy; }
  function canResign() { return app.mode !== 'tsume' && app.G.winner === null && app.human[app.G.turn] && !app.busy && app.G.ply > 0; }

  function playerName(side) {
    if (app.mode === 'two') return E.SIDES[side].name;
    if (app.mode === 'tsume') return side === 0 ? 'あなた' : 'くろ';
    return app.human[side] ? 'あなた' : 'CPU';
  }
  function isCapture(G, m) {
    const to = E.mTo(m);
    return !!G.board[to] || (E.typeOf(G.board[E.mFrom(m)]) === PAWN && to === G.ep);
  }

  function computeTargets() {
    app.targets = new Map();
    const sel = app.sel;
    if (!sel || sel.kind !== 'board' || !humanTurn()) return;
    for (const m of app.legal) {
      if (E.mFrom(m) !== sel.sq) continue;
      if (app.mode === 'tsume' && !givesCheck(app.G, m)) continue; // メイト問題は チェックだけ
      const to = E.mTo(m);
      if (!app.targets.has(to)) app.targets.set(to, []);
      app.targets.get(to).push(m);
    }
  }

  const pieceValue = t => (t === KING ? 99999 : AI.VAL[t]);

  // b の sq にいる駒が、相手に取られて損をしそうか（ただ取られる／安い駒と交換になる）
  function inDanger(b, sq) {
    const p = b[sq];
    if (!p) return false;
    const side = E.sideOf(p), t = E.typeOf(p);
    const atk = E.attackers(b, sq, 1 - side);
    if (!atk.length) return false;
    if (t === KING) return true;
    const def = E.attackers(b, sq, side);
    if (!def.length) return true;
    let min = Infinity;
    for (const a of atk) {
      const at = E.typeOf(b[a]);
      if (at !== KING) min = Math.min(min, pieceValue(at));
    }
    return min < pieceValue(t);
  }

  function dangerAfter(m) {
    const pos = E.posOf(app.G);
    E.make(pos, m);
    return inDanger(pos.b, E.mTo(m));
  }

  // ---------- 描画 ----------

  function render() {
    computeTargets();
    renderBoard();
    renderPlayers();
    renderStatus();
    renderInfo();
    renderKifu();
    $('btn-hint').disabled = !humanTurn();
    $('btn-undo').disabled = !canUndo();
  }

  function renderBoard() {
    const G = app.G;
    const sel = app.sel;
    const look = new Set();
    let promoSide = -1;
    if (sel && sel.kind === 'look') for (const sq of E.reachFrom(G, sel.sq)) look.add(sq);
    if (sel && sel.kind === 'board' && humanTurn() && E.typeOf(G.board[sel.sq]) === PAWN) promoSide = G.turn;
    const kingInCheck = G.inCheck ? E.kingSq(G.board, G.turn) : -1;
    const showDanger = app.settings.danger && humanTurn() && app.mode !== 'tsume';
    const hintFrom = app.hint !== null ? E.mFrom(app.hint) : -1;
    const hintTo = app.hint !== null ? E.mTo(app.hint) : -1;
    for (let sq = 0; sq < E.N; sq++) {
      const c = cells[sqToView(sq)];
      const y = sq >> 3;
      const cls = ['cell', E.sqColor(sq) ? 'dark' : 'light'];
      const p = G.board[sq];
      if (G.last && (G.last.from === sq || G.last.to === sq)) cls.push(G.last.to === sq ? 'last-to' : 'last-from');
      if (sel && (sel.kind === 'board' || sel.kind === 'look') && sel.sq === sq) cls.push('sel');
      if (promoSide >= 0 && y === E.promoRow(promoSide)) cls.push('zone');
      if (sq === kingInCheck) cls.push('check');
      if (sq === hintFrom) cls.push('hint-from');
      if (sq === hintTo) cls.push('hint-to');
      let badge = '';
      const tg = app.targets.get(sq);
      if (tg) {
        cls.push(isCapture(G, tg[0]) ? 'tgt cap' : 'tgt');
        if (E.typeOf(G.board[E.mFrom(tg[0])]) === KING && Math.abs(sq - E.mFrom(tg[0])) === 2) {
          cls.push('castle');
          badge = '<span class="badge castle-b">⇄</span>';
        } else if (showDanger && tg.every(dangerAfter)) badge = '<span class="badge warn">!</span>';
      } else if (look.has(sq)) {
        cls.push('look');
      }
      if (!tg && p && showDanger && E.sideOf(p) === G.turn && inDanger(G.board, sq) && E.typeOf(p) !== KING) {
        badge = '<span class="badge hang">!</span>';
      }
      c.className = cls.join(' ');
      c.innerHTML = (p ? pieceSVG(E.typeOf(p), E.sideOf(p), isDown(E.sideOf(p))) : '') + badge;
    }
  }

  // とった駒を数える（盤にない駒 = とられた駒。昇格した分は ポーンが へったと みなす）
  function capturedBy(G) {
    const count = [new Int8Array(7), new Int8Array(7)];
    for (const p of G.board) if (p) count[E.sideOf(p)][E.typeOf(p)]++;
    const start = E.newGame(app.mode === 'tsume' ? {} : gameOpts());
    const full = [new Int8Array(7), new Int8Array(7)];
    for (const p of start.board) if (p) full[E.sideOf(p)][E.typeOf(p)]++;
    const res = [[], []];
    if (app.mode === 'tsume') return res;
    for (const side of [0, 1]) {
      // 昇格で ふえた駒の ぶんだけ、ポーンが へっている
      let extra = 0;
      for (const t of [KNIGHT, BISHOP, ROOK, QUEEN]) extra += Math.max(0, count[side][t] - full[side][t]);
      const lostPawns = full[side][PAWN] - count[side][PAWN] - extra;
      const lost = [];
      for (const t of [QUEEN, ROOK, BISHOP, KNIGHT]) for (let i = 0; i < full[side][t] - count[side][t]; i++) lost.push(t);
      for (let i = 0; i < lostPawns; i++) lost.push(PAWN);
      res[1 - side] = lost; // 相手が とった
    }
    return res;
  }
  function material(G, side) {
    let v = 0;
    for (const p of G.board) if (p && E.typeOf(p) !== KING) v += (E.sideOf(p) === side ? 1 : -1) * AI.VAL[E.typeOf(p)];
    return Math.round(v / 100);
  }

  function renderPlayers() {
    const G = app.G;
    const bs = bottomSide();
    const caps = capturedBy(G);
    for (const [id, side] of [['player-bottom', bs], ['player-top', 1 - bs]]) {
      const el = $(id);
      const active = G.turn === side && G.winner === null;
      el.className = `player s${side}${active ? ' active' : ''}${id === 'player-top' ? ' top' : ''}`;
      let h = `<div class="pname"><b><i class="dot s${side}"></i>${playerName(side)}</b><small>${E.SIDES[side].name}</small></div><div class="hand">`;
      if (app.mode === 'tsume') {
        h += side === 1 ? '<span class="empty">いちばん ながく にげる 手を さすよ</span>' : '<span class="empty">チェックを つづけよう！</span>';
        el.innerHTML = h + '</div>';
        continue;
      }
      const list = caps[side];
      if (!list.length) h += '<span class="empty">とった こま なし</span>';
      for (const t of list) h += `<span class="cap-pc" title="${P[t].name}">${pieceSVG(t, 1 - side, false, { guide: false, furi: false })}</span>`;
      const adv = material(G, side);
      if (adv > 0) h += `<span class="adv">+${adv}</span>`;
      el.innerHTML = h + '</div>';
    }
  }

  function lastLine(G) {
    if (!G.last) return '';
    const prev = app.states[app.states.length - 2];
    const words = prev ? E.moveWords(prev, G.last.move) : G.kifu[G.kifu.length - 1];
    return `<span class="lastmv">${playerName(G.last.side)}：${words}（${G.kifu[G.kifu.length - 1]}）</span>`;
  }

  function renderStatus() {
    const G = app.G;
    const el = $('status');
    let cls = 's' + G.turn, text;
    const who = playerName(G.turn);
    const ts = app.tsume;
    if (ts) {
      const pr = PROBS[ts.idx];
      const left = (pr.moves - G.ply + 1) >> 1;
      if (ts.demo) { cls += ' hint'; text = 'こたえを ならべているよ…'; }
      else if (G.winner === 0) { cls = 'end'; text = `<b>せいかい！</b> ${(pr.moves + 1) >> 1}かいで チェックメイト！`; }
      else if (ts.failed && G.turn === 0) { cls += ' check'; text = '<b>ざんねん！</b> キングに にげられちゃった。「まった」で もどって もういちど！'; }
      else if (!app.human[G.turn]) { cls += ' think'; text = 'くろが にげる ところを さがしているよ<span class="dots"><i></i><i></i><i></i></span>'; }
      else if (app.hint !== null) { cls += ' hint'; text = `ヒント：<b>${E.moveWords(G, app.hint)}</b> ひかっている ところを タッチしてね`; }
      else if (app.sel && app.sel.kind === 'board' && humanTurn()) { text = app.targets.size ? '<span class="lg lg-dot"></span> に うごかすと チェックに なるよ' : 'この こまでは チェックが できないよ'; }
      else { text = `<b>だい${ts.idx + 1}もん（${(pr.moves + 1) >> 1}かいで メイト）</b> のこり ${left}かい。チェックを つづけよう！`; }
      el.className = 'status ' + cls;
      const last = G.last ? lastLine(G) : `<span class="lastmv">「${pr.title}」</span>`;
      el.innerHTML = `<span class="msg">${text}</span>${last}`;
      return;
    }
    if (G.winner !== null) {
      cls = 'end';
      text = G.winner === -1 ? 'ひきわけ' : `${playerName(G.winner)}の かち！`;
      text += '　<small>「メニュー」から あたらしく はじめられるよ</small>';
    } else if (!app.human[G.turn]) {
      cls += ' think';
      text = 'CPU が かんがえ中<span class="dots"><i></i><i></i><i></i></span>';
    } else if (G.inCheck) {
      cls += ' check';
      text = `<b>チェック！</b> ${app.mode === 'two' ? who + 'の ' : ''}キングが ねらわれているよ。まもろう！`;
    } else if (app.hint !== null) {
      cls += ' hint';
      text = `ヒント：<b>${E.moveWords(G, app.hint)}</b> が おすすめ！ ひかっている ところを タッチしてね`;
    } else if (app.sel && app.sel.kind === 'board' && humanTurn()) {
      text = app.targets.size ? '<span class="lg lg-dot"></span> の ところに うごかせるよ' : 'この こまは いま うごかせないよ';
    } else {
      text = app.mode === 'two' ? `<b>${who}</b>の ばんだよ` : '<b>あなたの ばん</b>だよ。うごかす こまを タッチしてね';
    }
    el.className = 'status ' + cls;
    el.innerHTML = `<span class="msg">${text}</span>${lastLine(G)}`;
  }

  function renderInfo() {
    const G = app.G;
    const info = $('info');
    const sel = app.sel;
    let t = 0, side = 0, where = '';
    if (sel && (sel.kind === 'board' || sel.kind === 'look')) {
      const p = G.board[sel.sq];
      if (p) { t = E.typeOf(p); side = E.sideOf(p); where = E.sqName(sel.sq); }
    }
    if (!t) {
      info.innerHTML =
        '<div class="tips"><p class="tip-main">こまを タッチすると、うごける ところが ひかるよ。</p>' +
        '<ul class="legend">' +
        '<li><span class="lg lg-dot"></span> うごける</li>' +
        '<li><span class="lg lg-cap"></span> あいての こまが とれる</li>' +
        `<li><span class="lg lg-warn">!</span> とられちゃうかも</li>` +
        '<li><span class="lg lg-look"></span> あいての こまが いける ところ</li>' +
        '</ul></div>';
      return;
    }
    const pc = P[t];
    const mine = app.human[side] && (app.mode === 'two' ? side === G.turn : true);
    const owner = app.mode === 'two' ? `${playerName(side)}の こま` : (mine ? 'あなたの こま' : (app.mode === 'tsume' ? 'くろの こま' : 'CPU の こま'));
    let extra = '';
    if (sel.kind === 'look' || !mine) extra = '<p class="note look">オレンジの ところに うごけるよ。きを つけて！</p>';
    else if (t === PAWN) extra = '<p class="note">いちばん おくの だん（むらさきの ところ）まで いくと、べつの こまに かわれるよ！</p>';
    else if (t === KING && [...app.targets.keys()].some(to => Math.abs(to - sel.sq) === 2)) extra = '<p class="note">⇄ の マスに うごかすと「キャスリング」。ルークが キングを とびこえて となりに くるよ。</p>';
    if (sel.kind === 'board' && mine && t === PAWN && [...app.targets.values()].some(ms => ms.some(m => E.mTo(m) === G.ep && E.typeOf(G.board[E.mFrom(m)]) === PAWN && !G.board[G.ep]))) {
      extra += '<p class="note">となりに きた ポーンを「アンパッサン」で とれるよ！</p>';
    }
    info.innerHTML =
      `<div class="card s${side}"><div class="card-pc">${pieceSVG(t, side, false, { guide: false, furi: false })}</div>` +
      `<div class="card-body"><div class="card-head"><b>${pc.name}</b>` +
      `<span class="owner s${side}">${owner}</span><span class="where">${where}</span></div>` +
      `<p class="desc">${pc.desc}</p>${extra}</div>` +
      `<div class="card-dg">${diagramSVG(t, side, isDown(side))}</div></div>`;
  }

  function renderKifu() {
    const ol = $('kifu');
    const k = app.G.kifu;
    const rows = Math.ceil(k.length / 2);
    if (ol.children.length > rows) ol.innerHTML = '';
    for (let i = 0; i < rows; i++) {
      const html = `<span class="s0">${k[i * 2]}</span>${k[i * 2 + 1] ? `<span class="s1">${k[i * 2 + 1]}</span>` : ''}`;
      let li = ol.children[i];
      if (!li) { li = document.createElement('li'); ol.appendChild(li); }
      if (li.innerHTML !== html) li.innerHTML = html;
    }
  }

  // ---------- 演出 ----------

  function slide(fromSq, toSq) {
    const toCell = cells[sqToView(toSq)];
    const svg = toCell.querySelector('svg.pc');
    if (!svg) return;
    const from = cells[sqToView(fromSq)].getBoundingClientRect();
    const r = toCell.getBoundingClientRect();
    const dx = from.left - r.left, dy = from.top - r.top;
    svg.style.transition = 'none';
    svg.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
    svg.style.zIndex = 5;
    svg.getBoundingClientRect();
    svg.style.transition = '';
    svg.style.transform = '';
  }

  function animateMove() {
    const a = app.anim;
    app.anim = null;
    if (!a) return;
    slide(a.from, a.to);
    if (a.rookFrom >= 0) slide(a.rookFrom, a.rookTo);
    const toCell = cells[sqToView(a.to)];
    if (a.promote) setTimeout(() => toCell.classList.add('promo-flash'), 260);
    if (a.capture) setTimeout(() => toCell.classList.add('cap-flash'), 200);
  }

  let toastTimer = 0;
  function toast(html, cls) {
    const el = $('toast');
    el.innerHTML = html;
    el.className = 'toast show ' + (cls || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 1800);
  }

  // ---------- 音 ----------
  // スマホのブラウザは「画面をタッチしている最中」にしか音を出す準備（AudioContext の再開）を許さない。
  // CPU の手は タッチの あとで 指されるので、タッチのたびに 準備しておく。
  let actx = null, out = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      // 小さなスピーカーでも聞こえるよう、まとめて音量をそろえる
      const comp = actx.createDynamicsCompressor();
      out = actx.createGain();
      out.gain.value = 1;
      out.connect(comp).connect(actx.destination);
    }
    if (actx.state !== 'running') {
      const p = actx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    return actx;
  }
  function unlockAudio() {
    if (!app.settings.sound) return;
    try {
      // iPhone：マナーモード（消音スイッチ）でも ゲームの音が出るようにする（Safari 17 以降）
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
      const a = audio();
      if (!a || a._unlocked) return;
      // 古い iOS は、タッチ中に 1度 音を鳴らすと 以後 鳴らせるようになる（無音を鳴らす）
      const src = a.createBufferSource();
      src.buffer = a.createBuffer(1, 1, 22050);
      src.connect(a.destination);
      src.start(0);
      a._unlocked = true;
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }
  for (const ev of ['pointerdown', 'touchend', 'mousedown', 'keydown']) {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  }

  function tone(freq, start, dur, type, vol) {
    const t0 = actx.currentTime + 0.01 + start;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return { o, t0 };
  }
  // 駒を置く「コツン」：短い ノイズ ＋ 低い音
  function knock() {
    const t0 = actx.currentTime + 0.01;
    const len = Math.floor(actx.sampleRate * 0.05);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.8;
    const g = actx.createGain();
    g.gain.value = 1.4;
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    const t = tone(320, 0, 0.12, 'triangle', 0.7);
    t.o.frequency.exponentialRampToValueAtTime(110, t.t0 + 0.1);
  }
  function sound(kind) {
    if (!app.settings.sound) return;
    try {
      if (!audio()) return;
      if (kind === 'move') {
        knock();
      } else if (kind === 'check') {
        tone(660, 0.05, 0.15, 'square', 0.18); tone(880, 0.2, 0.2, 'square', 0.18);
      } else if (kind === 'win') {
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3, 'triangle', 0.4));
      } else if (kind === 'lose') {
        [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.35, 'sine', 0.4));
      }
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }

  function confetti() {
    const box = $('confetti');
    box.innerHTML = '';
    const colors = ['#2563eb', '#dc2626', '#f59e0b', '#16a34a', '#a855f7'];
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = Math.random() * 0.6 + 's';
      s.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      box.appendChild(s);
    }
    setTimeout(() => { box.innerHTML = ''; }, 3600);
  }

  // ---------- 操作 ----------

  function onCell(sq) {
    const G = app.G;
    const tg = app.targets.get(sq);
    if (tg && humanTurn()) return tryMove(tg);
    const p = G.board[sq];
    if (!p) {
      app.sel = null;
    } else if (app.sel && app.sel.sq === sq) {
      if (app.hint === null) app.sel = null; // ヒントで選んだ駒は、タッチしても選んだまま
    } else if (humanTurn() && E.sideOf(p) === G.turn) {
      app.sel = { kind: 'board', sq };
    } else {
      app.sel = { kind: 'look', sq };
    }
    render();
  }

  function tryMove(ms) {
    if (ms.length > 1) {
      // 昇格：なにに かわるか えらぶ
      app.pendingPromo = ms;
      const side = app.G.turn;
      const choice = t =>
        `<button type="submit" value="${t}" class="promo-btn${t === QUEEN ? ' primary' : ''}">` +
        `<span class="pp">${pieceSVG(t, side, false, { guide: false, furi: false })}</span>${diagramSVG(t, side, false)}` +
        `<b>${P[t].name}</b>${t === QUEEN ? '<small>いちばん つよい！</small>' : ''}</button>`;
      $('promo-choices').innerHTML = E.PROMO_ORDER.filter(t => ms.some(m => E.mPromo(m) === t)).map(choice).join('');
      $('dlg-promote').showModal();
      return;
    }
    commit(ms[0]);
  }

  function commit(m) {
    const prev = app.G;
    const G = E.apply(prev, m);
    app.states.push(G);
    app.moves.push(m);
    app.G = G;
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(G);
    const L = G.last;
    app.anim = { from: L.from, to: L.to, rookFrom: L.rookFrom, rookTo: L.rookTo, promote: L.promo, capture: L.captured };
    if (app.tsume && prev.turn === 0 && G.winner === null && !app.tsume.demo) {
      // 残りの手数でメイトできるか（できないなら、くろが逃げたあとで「ざんねん」）
      const left = PROBS[app.tsume.idx].moves - G.ply;
      app.tsume.failed = left < 2 || !app.tsume.solver.defend(E.posOf(G), left);
    }
    save();
    render();
    animateMove();
    sound('move');
    if (L.captured) {
      const name = app.human[prev.turn] && app.mode === 'cpu' ? '' : `${playerName(prev.turn)}が `;
      toast(`${name}<b>${P[L.captured].name}</b> を とった！`, 'cap');
    } else if (L.promo) {
      toast(`ポーンが <b>${P[L.promo].name}</b> に なった！`, 'promo');
    } else if (L.castle) {
      toast('キャスリング！', 'promo');
    }
    if (G.winner !== null) return finish();
    if (G.inCheck) {
      setTimeout(() => sound('check'), 120);
      toast('<b>チェック！</b>', 'check');
    }
    proceed();
  }

  function onHint() {
    if (!humanTurn()) return;
    const G = app.G;
    if (app.tsume) {
      const sols = app.tsume.failed ? [] : app.tsume.solver.solutions(E.posOf(G), PROBS[app.tsume.idx].moves - G.ply);
      if (!sols.length) { toast('「まった」で もどってみよう'); return; }
      const m = sols[0];
      app.hint = m;
      app.sel = { kind: 'board', sq: E.mFrom(m) };
      return render();
    }
    const btn = $('btn-hint');
    btn.disabled = true;
    btn.classList.add('busy');
    const tk = app.token;
    think(G, 'hint').then(m => {
      btn.classList.remove('busy');
      if (tk !== app.token || app.G !== G || m === null) { render(); return; }
      app.hint = m;
      app.sel = { kind: 'board', sq: E.mFrom(m) };
      render();
    });
  }

  function canUndo() {
    if (app.G.result === 'resign') return true;
    if (!app.moves.length) return false;
    if (app.mode === 'two') return true;
    return undoTarget() >= 0;
  }
  // まったで戻る先（人が指す番の局面のうち、いまより前で一番新しいもの）
  function undoTarget() {
    const first = app.states[0].turn;
    for (let k = app.moves.length - 1; k >= 0; k--) {
      if (app.human[(first + k) % 2]) return k;
    }
    return -1;
  }

  function onUndo() {
    if (app.G.result === 'resign') {
      // こうさんを取り消して、その局面から続ける
      app.G = app.states[app.states.length - 1];
      app.legal = E.legalMoves(app.G);
      save();
      render();
      return proceed();
    }
    if (!canUndo()) return;
    const k = app.mode === 'two' ? app.moves.length - 1 : undoTarget();
    app.token++;
    app.busy = false;
    app.moves.length = k;
    app.states.length = k + 1;
    app.G = app.states[k];
    if (app.tsume) app.tsume.failed = false;
    app.sel = null;
    app.hint = null;
    app.legal = E.legalMoves(app.G);
    save();
    render();
    toast('1手 もどしたよ');
    proceed();
  }

  function onResign() {
    if (!canResign()) return;
    if (!confirm('こうさん しますか？')) return;
    app.G = E.resign(app.G); // states には積まない（まったで こうさん前に戻れる）
    app.legal = [];
    save();
    render();
    finish();
  }

  // ---------- CPU ----------

  let worker = null, workerOK = typeof Worker !== 'undefined', reqId = 0;
  const pending = new Map();
  function runLocal(job) {
    const G = job.G;
    setTimeout(() => job.resolve(AI.think(G.board, G.turn, G.castle, G.ep, job.level, G.keys)), 30);
  }
  function getWorker() {
    if (!workerOK) return null;
    if (!worker) {
      try {
        worker = new Worker('js/worker.js');
        worker.onmessage = e => {
          const job = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (job) job.resolve(e.data.move);
        };
        worker.onerror = () => {
          // file:// などで Worker が使えないときは画面側で考える
          workerOK = false;
          worker = null;
          for (const job of pending.values()) runLocal(job);
          pending.clear();
        };
      } catch (e) {
        workerOK = false;
        worker = null;
      }
    }
    return worker;
  }
  function think(G, level) {
    return new Promise(resolve => {
      const job = { G, level, resolve };
      const w = getWorker();
      if (!w) return runLocal(job);
      const id = ++reqId;
      pending.set(id, job);
      w.postMessage({ id, board: Array.from(G.board), turn: G.turn, castle: G.castle, ep: G.ep, level, history: G.keys });
    });
  }

  function proceed() {
    const G = app.G;
    if (G.winner !== null || app.human[G.turn]) return;
    app.busy = true;
    render();
    const tk = app.token;
    const t0 = Date.now();
    if (app.tsume) {
      setTimeout(() => {
        if (tk !== app.token || app.G !== G) return;
        const d = app.tsume.solver.bestDefense(E.posOf(G), PROBS[app.tsume.idx].moves);
        app.busy = false;
        commit(d.move);
        if (app.tsume && app.tsume.failed) setTimeout(() => { if (tk === app.token) tsumeResult('fail'); }, 900);
      }, app.tsume.demo ? 700 : 600);
      return;
    }
    think(G, app.level).then(m => {
      if (tk !== app.token || app.G !== G) return;
      setTimeout(() => {
        if (tk !== app.token || app.G !== G) return;
        app.busy = false;
        if (m === null) return render();
        commit(m);
      }, Math.max(0, 700 - (Date.now() - t0)));
    });
  }

  function finish() {
    const G = app.G;
    app.busy = false;
    render();
    if (app.tsume) return app.tsume.demo ? tsumeDemoEnd() : tsumeResult('solved');
    let title, text;
    const solo = app.mode === 'cpu';
    const draw = {
      stalemate: 'チェックされて いないのに、うごける 手が なくなったので ひきわけ（ステイルメイト）だよ。',
      material: 'どちらも こまが たりなくて チェックメイト できないので ひきわけ だよ。',
      repetition: 'おなじ かたちが 3かい でたので ひきわけ だよ。',
      fifty: '50手ずつ ポーンも うごかさず こまも とらなかったので ひきわけ だよ。',
      maxply: 'てすうが おおく なったので ひきわけ だよ。',
    };
    let cls = '';
    if (G.winner === -1) {
      title = 'ひきわけ';
      text = draw[G.result] || '';
    } else if (solo) {
      const won = app.human[G.winner];
      title = won ? 'かったよ！ おめでとう！' : 'まけちゃった…';
      cls = won ? 'win' : 'lose';
      if (won) text = G.result === 'resign' ? 'CPU が こうさん したよ。' : 'チェックメイト！ キングを つかまえたよ！ すごい！';
      else text = G.result === 'resign' ? 'こうさん したよ。また ちょうせん してね！' : 'キングが つかまっちゃった。「まった」で もどって やりなおせるよ！';
      sound(won ? 'win' : 'lose');
      if (won) confetti();
    } else {
      title = `${playerName(G.winner)}の かち！`;
      cls = 'win';
      text = G.result === 'resign' ? `${playerName(1 - G.winner)}が こうさん したよ。` : 'チェックメイト！ キングを つかまえたよ！';
      sound('win');
      confetti();
    }
    $('result-title').textContent = title;
    $('result-title').className = cls;
    $('result-text').textContent = text;
    $('btn-result-undo').hidden = !canUndo();
    setTimeout(() => { if (!document.querySelector('dialog[open]')) $('dlg-result').showModal(); }, 700);
  }

  // ---------- メイト問題 ----------

  function givesCheck(G, m) {
    const pos = E.posOf(G);
    E.make(pos, m);
    return E.inCheck(pos.b, 1 - G.turn);
  }

  function tsumeStart(idx) {
    return E.fromPosition(E.parseFen(PROBS[idx].fen));
  }

  function startTsume(idx, moves) {
    app.token++;
    app.busy = false;
    app.mode = 'tsume';
    app.human = [true, false];
    app.flip = false;
    app.tsume = { idx, solver: new MT.Solver(), failed: false, demo: false };
    document.body.classList.add('tsume-mode');
    rebuild([]);
    for (const m of moves || []) {
      // 保存されていた途中の手を、正解判定つきでもう一度たどる
      if (app.G.winner !== null || !app.legal.includes(m)) break;
      app.G = E.apply(app.G, m);
      app.states.push(app.G);
      app.moves.push(m);
      app.legal = E.legalMoves(app.G);
    }
    if (app.G.turn === 1 && app.G.winner === null) { app.moves.pop(); app.states.pop(); app.G = app.states[app.states.length - 1]; app.legal = E.legalMoves(app.G); }
    $('kifu').innerHTML = '';
    renderLabels();
    save();
    render();
  }

  function openTsumeList() {
    const done = Object.keys(app.tsumeDone).length;
    let h = `<p class="ts-count">クリア <b>${done}</b> / ${PROBS.length}もん</p>`;
    for (const n of [1, 3, 5]) {
      const k = (n + 1) >> 1;
      h += `<h3>${k}かいで メイト（${['', 'まずは ここから', '', 'すこし むずかしい', '', 'チャレンジ'][n]}）</h3><div class="ts-grid">`;
      PROBS.forEach((p, i) => {
        if (p.moves !== n) return;
        const ok = app.tsumeDone[i];
        h += `<button type="submit" value="${i}" class="ts-btn${ok ? ' done' : ''}${app.tsume && app.tsume.idx === i ? ' cur' : ''}">` +
          `<b>${i + 1}</b><small>${p.title}</small>${ok ? '<i>★</i>' : ''}</button>`;
      });
      h += '</div>';
    }
    $('tsume-list').innerHTML = h;
    $('dlg-tsume').showModal();
  }

  function kifuHTML(text) {
    return text.split(' ').map((k, i) => `<span class="s${i % 2}">${k}</span>`).join(' ');
  }

  // kind: 'solved' | 'fail' | 'answer'
  function tsumeResult(kind) {
    const idx = app.tsume.idx, pr = PROBS[idx];
    if (kind === 'solved') {
      app.tsumeDone[idx] = true;
      save();
      sound('win');
      confetti();
    } else if (kind === 'fail') {
      sound('lose');
    }
    const title = { solved: 'せいかい！ おみごと！', fail: 'ざんねん…', answer: `だい${idx + 1}もんの こたえ` }[kind];
    let h = `<h2 class="${kind === 'solved' ? 'win' : kind === 'fail' ? 'lose' : ''}">${title}</h2>`;
    h += `<p class="ts-sub">だい${idx + 1}もん「${pr.title}」（${(pr.moves + 1) >> 1}かいで メイト）</p>`;
    if (kind === 'fail') {
      h += '<p>キングに にげられちゃった。「まった」で もどるか、もういちど はじめから やってみよう。どうしても わからない ときは「こたえを みる」を おしてね。</p>';
    } else {
      h += `<div class="ts-answer">こたえ：${kifuHTML(pr.answer)}</div><p class="ts-text">${pr.text}</p>`;
      if (pr.traps.length) {
        h += '<div class="ts-traps"><b>まちがえやすい 手</b><ul>' +
          pr.traps.map(([a, d]) => `<li><span class="s0">${a}</span> → <span class="s1">${d}</span> で にげられちゃう</li>`).join('') + '</ul></div>';
      }
    }
    const btn = (v, label, cls) => `<button type="submit" value="${v}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;
    let b = '';
    if (kind === 'solved') b = btn('list', 'もんだい いちらん') + (idx + 1 < PROBS.length ? btn('next', 'つぎの もんだい', 'primary') : '');
    else if (kind === 'fail') b = btn('undo', 'まった') + btn('answer', 'こたえを みる') + btn('retry', 'もういちど', 'primary');
    else b = btn('close', 'とじる') + btn('demo', 'こたえを ならべる', 'primary');
    $('tsume-result').innerHTML = h + `<div class="dlg-buttons">${b}</div>`;
    setTimeout(() => {
      if (document.querySelector('dialog[open]')) return;
      $('dlg-tsume-result').showModal();
    }, kind === 'solved' ? 700 : 100);
  }

  function onTsumeResult(v) {
    if (!app.tsume) return;
    const idx = app.tsume.idx;
    if (v === 'next') startTsume(idx + 1, []);
    else if (v === 'list') openTsumeList();
    else if (v === 'retry') startTsume(idx, []);
    else if (v === 'undo') onUndo();
    else if (v === 'answer') tsumeResult('answer');
    else if (v === 'demo') tsumeDemo();
  }

  // こたえを盤に ならべる
  function tsumeDemo() {
    const idx = app.tsume.idx;
    startTsume(idx, []);
    const line = app.tsume.solver.mainLine(E.posOf(app.G), PROBS[idx].moves).line;
    app.tsume.demo = true;
    app.busy = true;
    render();
    const tk = app.token;
    const step = k => {
      if (tk !== app.token) return;
      if (k >= line.length) return;
      app.busy = false;
      app.human = [true, true]; // 両方とも ここで指す
      commit(line[k]);
      app.busy = app.G.winner === null;
      render();
      setTimeout(() => step(k + 1), 1100);
    };
    setTimeout(() => step(0), 600);
  }
  function tsumeDemoEnd() {
    app.tsume.demo = false;
    app.human = [true, false];
    render();
    toast('これで チェックメイト！');
  }

  window.ChessApp = app; // デバッグ用
  document.addEventListener('DOMContentLoaded', init);
})();
