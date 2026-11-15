'use strict';
/* ============================================================
   SIXES — the table.

   One screen draws three different games: against the computer, pass
   and play on one device, and online against a real person. They differ
   only in where the position comes from, so everything below reads the
   same two variables — G for the position and viewer for whose side of
   the table we are sitting on — and never asks which kind of game it is
   except where it genuinely matters.

   The board is unbounded in the rules and has to be finite on a screen,
   so what is drawn is the played area plus one empty ring around it:
   every square you could legally reach, and no more.
   ============================================================ */

/* ---------- little helpers ---------- */
function $(sel) { return document.querySelector(sel); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- settings that outlive the session ---------- */
const SET_KEY = 'wands.settings';
const S = {
  game: 'sixes', mode: 'ai', diff: 'steady', target: 0,
  skin: 'felt', dark: false, sound: true,
  names: ['You', 'Opponent']
};
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
    for (const k of Object.keys(S)) if (raw[k] !== undefined) S[k] = raw[k];
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch (e) {}
}

/* ---------- sound ----------
   Three short noises made on the spot, so there are no files to load and
   nothing to go missing offline. */
const sfx = (function () {
  let ac = null;
  function ctx() {
    if (!S.sound) return null;
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    return ac;
  }
  function blip(freq, ms, gain) {
    const a = ctx();
    if (!a) return;
    try {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.value = gain === undefined ? 0.05 : gain;
      o.connect(g); g.connect(a.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
      o.stop(a.currentTime + ms / 1000 + 0.02);
    } catch (e) {}
  }
  return {
    tap: function () { blip(520, 70); },
    place: function () { blip(380, 80); },
    score: function () { blip(660, 120, .06); setTimeout(function () { blip(880, 140, .05); }, 90); },
    bad: function () { blip(180, 160, .05); }
  };
})();

/* ---------- the position ---------- */
let G = null;            // a SixesGame when offline, a served view when online
let LIVE = null;         // the real game object when offline, else null
let viewer = 0;          // which seat this screen is sitting at
let bot = null;          // the computer opponent, when there is one
let botTimer = null;
let picked = null;       // the tile id lifted out of the hand
let swapping = null;     // a Set of tile ids while choosing what to swap

function isOnline() { return ONLINE === true; }
function isBot(p) { return !isOnline() && S.mode === 'ai' && p === 1; }
function nameOf(p) {
  if (G && G.names) return G.names[p] || ('Player ' + (p + 1));
  return S.names[p] || ('Player ' + (p + 1));
}
function youLabel(p) { return p === viewer ? 'You' : nameOf(p); }

/* ---------- starting a game ---------- */
function startLocalGame() {
  S.names = [
    ($('#n0').value || 'You').trim().slice(0, 14) || 'You',
    S.mode === 'ai' ? 'Computer' : (($('#n1').value || 'Opponent').trim().slice(0, 14) || 'Opponent')
  ];
  saveSettings();
  LIVE = new SixesGame({ target: S.target, first: 0 });
  LIVE.names = S.names.slice();
  G = LIVE;
  viewer = 0;
  bot = isBot(1) ? new SixesAI(S.diff) : null;
  picked = null; swapping = null; lastWin = null;
  showScreen('sixes');
  render();
  maybeBot();
}

/* An online game arrives as a redacted snapshot rather than an object, so
   the few places that call methods go through the live game only. */
function sxApplyServerState(v) {
  G = v;
  LIVE = null;
  bot = null;
  viewer = v.you;
  if (picked && !v.hands[viewer].some(function (t) { return t.id === picked; })) picked = null;
  showScreen('sixes');
  render();
}

/* ---------- which squares are on screen ----------
   The played area plus a one-square margin: that is exactly the set of
   squares a tile could legally be placed on, so the window never shows
   somewhere you cannot reach, and never hides somewhere you can. */
function boardWindow() {
  const tiles = boardTiles();
  if (!tiles.length) return { r0: -1, r1: 1, c0: -1, c1: 1 };
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (const t of tiles) {
    r0 = Math.min(r0, t.r); r1 = Math.max(r1, t.r);
    c0 = Math.min(c0, t.c); c1 = Math.max(c1, t.c);
  }
  return { r0: r0 - 1, r1: r1 + 1, c0: c0 - 1, c1: c1 + 1 };
}

/* Everything on the table: committed tiles plus the ones laid this turn. */
function boardTiles() {
  const out = [];
  if (LIVE) {
    for (const k of Object.keys(LIVE.board)) {
      const b = k.split(',');
      const t = LIVE.board[k];
      out.push({ r: +b[0], c: +b[1], col: t.c, s: t.s, id: t.id });
    }
    for (const p of LIVE.placed) out.push({ r: p.r, c: p.c, col: p.tile.c, s: p.tile.s, id: p.tile.id, fresh: true });
  } else if (G) {
    for (const t of G.board) out.push({ r: t.r, c: t.c, col: t.col, s: t.s, id: t.r + ',' + t.c });
    for (const t of G.placed) out.push({ r: t.r, c: t.c, col: t.col, s: t.s, id: t.id, fresh: true });
  }
  return out;
}

function myHand() { return G ? (G.hands[viewer] || []) : []; }
function myTurn() { return G && G.turn === viewer && G.phase === 'play'; }
function placedCount() { return LIVE ? LIVE.placed.length : (G ? G.placed.length : 0); }
function pendingScore() { return LIVE ? LIVE.turnScore() : (G ? G.pending : 0); }
function bagCount() { return LIVE ? LIVE.bag.length : (G ? G.bagCount : 0); }

/* ---------- drawing ---------- */
function tileNode(col, shape) {
  const n = el('div', 'tile');
  n.dataset.col = col;
  n.dataset.shape = shape;
  n.appendChild(el('span', 'mark'));
  n.setAttribute('aria-label', (window.COLOR_NAME ? COLOR_NAME[col] : col) + ' ' + shape);
  return n;
}

function render() {
  if (!G) return;
  renderScore();
  renderOpp();
  renderBoard();
  renderHand();
  renderActions();
  renderMsg();
  requestAnimationFrame(function () { fitBoard(); showSomewhereLegal(); });
}

function renderScore() {
  const box = $('#sxScore');
  if (!box) return;
  const gs = G.gameScores || [0, 0];
  const lead = gs[0] === gs[1] ? -1 : (gs[0] > gs[1] ? 0 : 1);
  box.innerHTML = '';
  for (const p of [0, 1]) {
    const side = el('span', 'side' + (lead === p ? ' lead' : ''));
    side.innerHTML = esc(youLabel(p)) + ' <b>' + gs[p] + '</b>';
    box.appendChild(side);
    if (p === 0) box.appendChild(el('span', 'vs', 'vs'));
  }
  if (G.target) {
    const t = el('span', 'target', 'to ' + G.target);
    box.appendChild(t);
  }
}

function renderOpp() {
  const them = 1 - viewer;
  const seat = $('#sxOppSeat');
  if (seat) {
    const n = (G.handCounts ? G.handCounts[them] : (G.hands[them] || []).length);
    let note = '';
    if (G.lastTurn && G.lastTurn.who === them) {
      note = G.lastTurn.kind === 'swapped'
        ? ' · swapped ' + G.lastTurn.count
        : ' · scored ' + G.lastTurn.score;
    }
    seat.textContent = nameOf(them) + ' · ' + n + ' tile' + (n === 1 ? '' : 's') + note;
  }
  const hand = $('#sxOppHand');
  if (hand) {
    hand.innerHTML = '';
    const n = (G.handCounts ? G.handCounts[them] : (G.hands[them] || []).length);
    for (let i = 0; i < n; i++) hand.appendChild(el('div', 'back'));
  }
}

let lastWin = null;

function tileStep() {
  const b = $('#sxBoard');
  if (!b) return 49;
  return (parseFloat(getComputedStyle(b).getPropertyValue('--tile')) || 46) + 3;
}

function renderBoard() {
  const board = $('#sxBoard');
  if (!board) return;
  const scroll = $('#sxScroll');
  /* The board is rebuilt on every repaint, which resets the scroll. Worse,
     a tile played above or to the left of everything shifts the whole grid
     along, so even a restored scroll would show a different place. Both are
     corrected by remembering where the window was and moving the scroll by
     however far the grid moved underneath it. */
  const prevWin = lastWin;
  const prevLeft = scroll ? scroll.scrollLeft : 0;
  const prevTop = scroll ? scroll.scrollTop : 0;
  const w = boardWindow();
  const rows = w.r1 - w.r0 + 1, cols = w.c1 - w.c0 + 1;
  const tiles = boardTiles();
  const byKey = {};
  for (const t of tiles) byKey[t.r + ',' + t.c] = t;

  board.style.gridTemplateColumns = 'repeat(' + cols + ', var(--tile))';
  board.style.gridTemplateRows = 'repeat(' + rows + ', var(--tile))';
  board.innerHTML = '';
  board.dataset.rows = rows;
  board.dataset.cols = cols;

  for (let r = w.r0; r <= w.r1; r++) {
    for (let c = w.c0; c <= w.c1; c++) {
      const t = byKey[r + ',' + c];
      if (t) {
        const n = tileNode(t.col, t.s);
        if (t.fresh) {
          n.classList.add('fresh');
          n.title = 'Tap to take this tile back';
          n.onclick = function () { takeBack(t.id); };
        }
        board.appendChild(n);
      } else {
        const cell = el('div', 'cell');
        const legal = picked && myTurn() && canDrop(picked, r, c);
        if (legal) cell.classList.add('open');
        cell.onclick = function () { dropAt(r, c); };
        board.appendChild(cell);
      }
    }
  }

  if (scroll && prevWin) {
    const step = tileStep();
    scroll.scrollLeft = Math.max(0, prevLeft + (prevWin.c0 - w.c0) * step);
    scroll.scrollTop = Math.max(0, prevTop + (prevWin.r0 - w.r0) * step);
  }
  lastWin = w;
}

/* With a tile in hand and every legal square off the edge of the view, the
   game looks as though it has no move. Nudge the nearest one into sight —
   but only then, so the board does not wander about while you are reading
   it. */
function showSomewhereLegal() {
  const scroll = $('#sxScroll');
  if (!scroll || !picked) return;
  const open = Array.from(document.querySelectorAll('#sxBoard .cell.open'));
  if (!open.length) return;
  const box = scroll.getBoundingClientRect();
  const visible = open.some(function (c) {
    const r = c.getBoundingClientRect();
    return r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
  });
  if (visible) return;
  try { open[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
  catch (e) { open[0].scrollIntoView(); }
}

/* Would this tile go here? Offline the rules can answer directly; online
   the client guesses and the server decides, which is the right way round
   — a wrong guess costs a refused move, never a wrong board. */
function canDrop(tileId, r, c) {
  if (!LIVE) return true;
  return LIVE.canPlace(viewer, tileId, r, c).ok;
}

function renderHand() {
  const box = $('#sxHand');
  if (!box) return;
  box.innerHTML = '';
  for (const t of myHand()) {
    const n = tileNode(t.c, t.s);
    n.dataset.id = t.id;
    if (picked === t.id) n.classList.add('picked');
    if (swapping && swapping.has(t.id)) n.classList.add('swapping');
    n.onclick = function () { tapHandTile(t.id); };
    box.appendChild(n);
  }
  const bag = $('#sxBag');
  if (bag) bag.innerHTML = 'Bag <b>' + bagCount() + '</b>';
  const pend = $('#sxPending');
  if (pend) {
    const n = placedCount() ? pendingScore() : 0;
    pend.hidden = !n;
    pend.innerHTML = 'This turn <b>' + n + '</b>';
  }
}

function renderActions() {
  const box = $('#sxActions');
  if (!box) return;
  box.innerHTML = '';
  const add = function (label, fn, cls) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.onclick = fn;
    box.appendChild(b);
    return b;
  };

  if (G.phase === 'ended') {
    if (G.matchOver) {
      add('Play again', function () { againFromStart(); }, 'primary');
    } else {
      add('Next game', function () { act({ do: 'next' }); }, 'primary');
    }
    add('Leave', leaveTable);
    return;
  }

  if (!myTurn()) return;

  if (swapping) {
    add('Swap these ' + swapping.size, function () { doSwap(); }, swapping.size ? 'primary' : '');
    add('Cancel', function () { swapping = null; render(); });
    return;
  }

  if (placedCount()) {
    add('Finish turn — ' + pendingScore(), function () { commitTurn(); }, 'primary');
    add('Take back', function () { takeBackAll(); });
    return;
  }

  if (bagCount()) add('Swap tiles', function () { swapping = new Set(); render(); });
}

function renderMsg() {
  const box = $('#sxMsg');
  if (!box) return;
  let main = '';

  if (G.phase === 'ended') {
    const e = G.ended || {};
    if (e.level) main = 'A tie — ' + (G.gameScores || [])[0] + ' each';
    else main = (e.winner === viewer ? 'You win' : nameOf(e.winner) + ' wins') +
      ', ' + (G.gameScores || [])[e.winner] + ' to ' + (G.gameScores || [])[1 - e.winner];
    if (G.matchOver && G.target) main += ' — and the match';
  } else if (isOnline() && G.turn !== viewer) {
    main = PEER_HERE ? 'Waiting for ' + nameOf(1 - viewer) : nameOf(1 - viewer) + ' has dropped out';
  } else if (G.turn !== viewer) {
    main = nameOf(1 - viewer) + ' is thinking…';
  } else if (swapping) {
    main = swapping.size ? 'Swapping ' + swapping.size : 'Tap the tiles you want to swap';
  } else if (picked) {
    main = 'Tap a square to put it down';
  } else if (placedCount()) {
    main = 'Add another, or finish your turn';
  } else {
    main = 'Your turn — tap a tile';
  }
  box.textContent = main;
}

/* ---------- the board has to fit the screen ----------
   The tile size is worked out from the room left over once the fixed
   furniture has taken its share, and the furniture is measured rather
   than assumed: a status line that wraps is a change in the furniture. */
function fitBoard() {
  const screen = $('#screen-sixes');
  if (!screen || screen.hidden) return;
  const board = $('#sxBoard');
  const scroll = $('#sxScroll');
  if (!board || !scroll) return;

  const h = function (sel) { const e = screen.querySelector(sel); return e ? e.offsetHeight : 0; };
  const rows = parseInt(board.dataset.rows || '3', 10);
  const cols = parseInt(board.dataset.cols || '3', 10);

  const CHROME = 58;    // the padding either side of the board area, and a
                        // little slack so the last row is never half shown
  const room = screen.clientHeight - h('.topbar') - h('.oppzone') - h('.handmeta') -
    h('.hand') - h('.actions') - Math.max(20, h('#sxMsg')) - CHROME;
  const wide = scroll.clientWidth - 14;

  const gap = 3;
  const byHeight = (Math.max(140, room) - (rows + 1) * gap) / rows;
  const byWidth = (wide - (cols + 1) * gap) / cols;

  /* Shrinking to fit is right up to a point, and then it is wrong: past it
     the tiles stop being readable and the game turns into confetti. So
     there is a floor, and below it the board stops shrinking and the area
     scrolls instead — a bigger board you pan around beats a whole board you
     cannot see. The floor is lower on a phone only because the screen is. */
  const floor = window.innerWidth < 700 ? 40 : 48;
  const size = Math.max(floor, Math.min(62, Math.floor(Math.min(byHeight, byWidth))));
  board.style.setProperty('--tile', size + 'px');
}
window.addEventListener('resize', function () { requestAnimationFrame(fitBoard); });

/* ---------- playing ---------- */
function tapHandTile(id) {
  if (!myTurn()) return;
  if (swapping) {
    if (swapping.has(id)) swapping.delete(id); else swapping.add(id);
    sfx.tap();
    render();
    return;
  }
  picked = (picked === id) ? null : id;
  sfx.tap();
  render();
}

function dropAt(r, c) {
  if (!myTurn() || !picked) return;
  const id = picked;
  if (LIVE) {
    const v = LIVE.canPlace(viewer, id, r, c);
    if (!v.ok) { sfx.bad(); flashMsg(v.why); return; }
    LIVE.place(viewer, id, r, c);
    picked = null;
    sfx.place();
    render();
  } else {
    picked = null;
    act({ do: 'place', tileId: id, r: r, c: c });
  }
}

function takeBack(id) {
  if (!myTurn()) return;
  if (LIVE) { LIVE.unplace(viewer, id); sfx.tap(); render(); }
  else act({ do: 'unplace', tileId: id });
}
function takeBackAll() {
  if (!myTurn()) return;
  if (LIVE) { LIVE.takeBackAll(viewer); sfx.tap(); render(); }
  else act({ do: 'clear' });
}

function commitTurn() {
  if (!myTurn() || !placedCount()) return;
  if (LIVE) {
    const gained = LIVE.commit(viewer);
    if (gained >= 6) sfx.score(); else sfx.place();
    picked = null;
    render();
    maybeBot();
  } else {
    act({ do: 'commit' });
  }
}

function doSwap() {
  if (!swapping || !swapping.size) { flashMsg('Tap the tiles you want to swap first.'); return; }
  const ids = Array.from(swapping);
  swapping = null;
  if (LIVE) {
    try { LIVE.swap(viewer, ids); } catch (e) { sfx.bad(); flashMsg(e.message); render(); return; }
    render();
    maybeBot();
  } else {
    act({ do: 'swap', ids: ids });
  }
}

function act(a) {
  if (isOnline()) { NET.act(a); return; }
  /* Pass and play has no server, so "next game" is handled here. */
  if (a.do === 'next' && LIVE) { LIVE.nextGame(); render(); maybeBot(); }
}

function flashMsg(text) {
  const box = $('#sxMsg');
  if (!box) return;
  box.textContent = text;
  box.classList.add('warn');
  setTimeout(function () { box.classList.remove('warn'); render(); }, 2200);
}

/* ---------- the computer's turn ----------
   Slow enough to watch. A turn that appeared complete in one frame would
   leave you wondering what had just happened to the board. */
function maybeBot() {
  clearTimeout(botTimer);
  if (!LIVE || !bot) return;
  if (LIVE.phase !== 'play' || LIVE.turn !== 1) return;
  botTimer = setTimeout(playBotTurn, 900);
}

function playBotTurn() {
  if (!LIVE || !bot || LIVE.turn !== 1 || LIVE.phase !== 'play') return;
  const d = bot.decide(LIVE, 1);

  if (d.kind === 'swap') {
    try { LIVE.swap(1, d.ids); } catch (e) {}
    render();
    maybeBot();
    return;
  }
  if (d.kind !== 'play') { render(); return; }

  /* Lay the tiles down one at a time so the line builds in front of you. */
  let i = 0;
  (function step() {
    if (!LIVE || LIVE.turn !== 1) return;
    if (i < d.tiles.length) {
      const m = d.tiles[i++];
      try { LIVE.place(1, m.id, m.r, m.c); } catch (e) {}
      sfx.place();
      render();
      botTimer = setTimeout(step, 420);
      return;
    }
    const gained = LIVE.commit(1);
    if (gained >= 6) sfx.score();
    render();
    maybeBot();
  })();
}

/* ---------- screens ---------- */
function showScreen(which) {
  for (const id of ['lobby', 'room', 'sixes']) {
    const s = $('#screen-' + id);
    if (s) s.hidden = (id !== which);
  }
  if (which === 'sixes') requestAnimationFrame(fitBoard);
}

function leaveTable() {
  clearTimeout(botTimer);
  if (isOnline()) { NET.leave(); ONLINE = false; }
  LIVE = null; G = null; picked = null; swapping = null;
  showScreen('lobby');
}

function againFromStart() {
  if (isOnline()) { NET.rematch(); return; }
  startLocalGame();
}

/* ---------- the lobby ---------- */
function paintLobby() {
  applySkin();
  $('#n0').value = S.names[0] === 'You' ? '' : S.names[0];
  $('#n1').value = (S.names[1] === 'Opponent' || S.names[1] === 'Computer') ? '' : S.names[1];
  segPaint('#modeSeg', S.mode);
  segPaint('#diffSeg', S.diff);
  segPaint('#targetSeg', String(S.target));
  const d = $('#diffField');
  if (d) d.hidden = S.mode !== 'ai';
  const n1 = $('#n1');
  if (n1) n1.hidden = S.mode === 'ai';
  if (typeof paintOnlineLobby === 'function') paintOnlineLobby();
}

function segPaint(sel, value) {
  const seg = $(sel);
  if (!seg) return;
  for (const b of seg.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.v === value ? 'true' : 'false');
  }
}
function segWire(sel, onPick) {
  const seg = $(sel);
  if (!seg) return;
  for (const b of seg.querySelectorAll('button')) {
    b.onclick = function () {
      segPaint(sel, b.dataset.v);
      onPick(b.dataset.v);
      saveSettings();
      paintLobby();
    };
  }
}

function applySkin() {
  document.documentElement.setAttribute('data-skin', S.skin);
  document.documentElement.setAttribute('data-dark', S.dark ? 'yes' : 'no');
}

/* ---------- the overlays: rules and settings ---------- */
function openOverlay(html) {
  const host = $('#overlays');
  host.innerHTML = '';
  const back = el('div', 'overlay');
  const sheet = el('div', 'sheet');
  sheet.innerHTML = html;
  const close = el('button', 'btn', 'Close');
  close.onclick = closeOverlay;
  sheet.appendChild(close);
  back.appendChild(sheet);
  back.onclick = function (e) { if (e.target === back) closeOverlay(); };
  host.appendChild(back);
  return sheet;
}
function closeOverlay() { $('#overlays').innerHTML = ''; }

function showRules() {
  openOverlay(
    '<h2>Sixes</h2>' +
    '<p>Every tile has a <b>colour</b> and a <b>shape</b>. There are six of each, and three copies of every combination — 108 tiles in the bag. You hold six.</p>' +
    '<section><h3>Your turn</h3>' +
    '<p>Put down as many tiles as you like, as long as they all go in <b>one straight line</b>. Tap a tile in your hand, then tap the square you want it on. Tap a tile you have just put down to take it back — nothing counts until you press <b>Finish turn</b>.</p></section>' +
    '<section><h3>What makes a line</h3>' +
    '<p>Every line on the board must be either <b>all one colour with no shape repeated</b>, or <b>all one shape with no colour repeated</b>. A line stops at six, because six is all the colours, or all the shapes.</p>' +
    '<p>Your tiles have to join on to what is already there — nothing floats on its own.</p></section>' +
    '<section><h3>Scoring</h3>' +
    '<p>You score <b>one point per tile</b> in every line you built or added to. A tile that lands where a row and a column meet scores in <b>both</b>, which is where the big turns come from.</p>' +
    '<p>Complete a line of six and you score its six tiles <b>plus six more</b>.</p></section>' +
    '<section><h3>Swapping, and the end</h3>' +
    '<p>Instead of playing you can swap any number of tiles back into the bag — that uses your whole turn.</p>' +
    '<p>When the bag is empty and somebody plays their last tile, the game ends and they score <b>six more</b>. Highest score wins.</p></section>'
  );
}

function showSettings() {
  const sheet = openOverlay(
    '<h2>Look &amp; sound</h2>' +
    '<div class="setrow"><span>Table</span><div class="seg" id="skinSeg">' +
    '<button data-v="felt" aria-pressed="' + (S.skin === 'felt') + '">Felt</button>' +
    '<button data-v="slate" aria-pressed="' + (S.skin === 'slate') + '">Slate</button></div></div>' +
    '<div class="setrow"><span>Night colours</span><div class="seg" id="darkSeg">' +
    '<button data-v="no" aria-pressed="' + (!S.dark) + '">Off</button>' +
    '<button data-v="yes" aria-pressed="' + (!!S.dark) + '">On</button></div></div>' +
    '<div class="setrow"><span>Sound</span><div class="seg" id="soundSeg">' +
    '<button data-v="off" aria-pressed="' + (!S.sound) + '">Off</button>' +
    '<button data-v="on" aria-pressed="' + (!!S.sound) + '">On</button></div></div>' +
    '<p class="hint">Version <span id="verNow">' +
    esc(document.documentElement.getAttribute('data-app-version') || '?') + '</span></p>'
  );
  const wire = function (sel, fn) {
    for (const b of sheet.querySelectorAll(sel + ' button')) {
      b.onclick = function () {
        for (const o of sheet.querySelectorAll(sel + ' button')) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        fn(b.dataset.v);
        saveSettings();
        applySkin();
      };
    }
  };
  wire('#skinSeg', function (v) { S.skin = v; });
  wire('#darkSeg', function (v) { S.dark = v === 'yes'; });
  wire('#soundSeg', function (v) { S.sound = v === 'on'; });
}

/* ---------- wiring the lobby up ---------- */
function initTable() {
  loadSettings();
  applySkin();

  segWire('#modeSeg', function (v) { S.mode = v; });
  segWire('#diffSeg', function (v) { S.diff = v; });
  segWire('#targetSeg', function (v) { S.target = parseInt(v, 10) || 0; });

  $('#startBtn').onclick = startLocalGame;
  $('#sxBack').onclick = leaveTable;
  $('#sxRules').onclick = showRules;
  $('#sxSettings').onclick = showSettings;
  $('#lobbyRules').onclick = showRules;
  $('#lobbySettings').onclick = showSettings;

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeOverlay(); if (swapping) { swapping = null; render(); } }
  });
}

/* A window onto the state for the tests to read, so they can check the
   position rather than guess at it from pixels. */
window.sixesState = function () {
  if (!G) return null;
  return {
    turn: G.turn, viewer: viewer, phase: G.phase,
    hand: myHand().length, bag: bagCount(),
    placed: placedCount(), pending: pendingScore(),
    scores: (G.gameScores || []).slice(),
    tiles: boardTiles().length,
    online: isOnline()
  };
};

initTable();
