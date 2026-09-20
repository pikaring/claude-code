/* ねこ ならべ（Slide on NEKO）
 *
 * ルール
 *   - となりあう ねこの かおを ドラッグ（または タップ2かい）で いれかえる
 *   - たてか よこに おなじ ねこが MIN_MATCH ひき そろうと、画面の 右へ はしって にげる
 *   - あいた ところには 上から あたらしい ねこが ふってくる（れんさ あり）
 *
 * ねこの 絵の さしかえ
 *   CAT_TYPES の image に 画像の パスを いれるだけ。よみこめた ときだけ 画像に なり、
 *   よみこめない ときは style.css の .cat__body--<key>（ざんていの くろ丸・しろ丸）の ままで あそべる。
 *   絵は「顔だけ」の 正方形。3×3の スプライトシートを つかう ときは sheet: true を つける。
 */
(() => {
  'use strict';

  const COLS = 7;
  const ROWS = 8;
  const MIN_MATCH = 4;

  const SWAP_MS = 170;      // style.css の --swap-ms と そろえる
  const FALL_MS = 260;      // style.css の --fall-ms と そろえる
  const RUN_MS = 900;       // style.css の --run-ms と そろえる（右へ はしりぬける ながさ）
  const RUN_STAGGER = 55;   // ぎょうれつに なって はしりだす ずれ
  const ESCAPE_HOLD = 230;  // はしりだしてから ばんを つめるまで

  const BEST_KEY = 'nekonarabe.best';
  const KIND_KEY = 'nekonarabe.kinds';

  /** ねこの しゅるい。image に 'images/face-kuro.png' のような パスを いれると 画像に なる。
   *  ならびは 前作「ねこの ともだち」の ねこに あわせてある。 */
  const CAT_TYPES = [
    { key: 'kuro',      name: 'くろねこ', image: null },
    { key: 'chashiro',  name: 'ちゃしろ', image: null },
    { key: 'kijitora',  name: 'キジトラ', image: null },
    { key: 'hachiware', name: 'ハチワレ', image: null },
    { key: 'mike',      name: 'みけねこ', image: null },
  ];

  const boardEl    = document.getElementById('board');
  const areaEl     = document.getElementById('boardArea');
  const runwayEl   = document.getElementById('runway');
  const scoreEl    = document.getElementById('score');
  const bestEl     = document.getElementById('best');
  const movesEl    = document.getElementById('moves');
  const messageEl  = document.getElementById('message');
  const bignewsEl  = document.getElementById('bignews');
  const bignewsTxt = document.getElementById('bignewsText');
  const kindSubEl  = document.getElementById('kindSub');
  const kindModal  = document.getElementById('kindModal');
  const kindChoice = document.getElementById('kindChoices');
  const resetBtn   = document.getElementById('btnReset');
  const kindBtn    = document.getElementById('btnKind');
  const closeBtn   = document.getElementById('btnCloseKind');

  /** grid[r][c] = tile | null */
  let grid = [];
  let cell = 56;
  let typeCount = 4;
  let score = 0;
  let moves = 0;
  let best = 0;
  let busy = true;
  let selected = null;
  let uid = 0;
  let bignewsTimer = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (n) => Math.floor(Math.random() * n);

  /* ---------------- 画像の よみこみ（よみこめない ときは 丸の まま） ---------------- */

  function loadImages() {
    CAT_TYPES.forEach((def, type) => {
      def.ready = false;
      if (!def.image) return;
      const img = new Image();
      img.onload = () => {
        def.ready = true;
        eachTile((tile) => { if (tile.type === type) paint(tile); });
      };
      img.src = def.image;
    });
  }

  /* ---------------- レイアウト ---------------- */

  function layout() {
    const availW = (areaEl.clientWidth || 360) - 20;
    const availH = (areaEl.clientHeight || 420) - 20;
    cell = Math.max(30, Math.min(78, Math.floor(Math.min(availW / COLS, availH / ROWS))));

    boardEl.style.setProperty('--cell', cell + 'px');
    boardEl.style.width = COLS * cell + 'px';
    boardEl.style.height = ROWS * cell + 'px';

    eachTile((tile) => moveTo(tile, tile.r, tile.c, true));
  }

  function eachTile(fn) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r] && grid[r][c]) fn(grid[r][c]);
      }
    }
  }

  /* ---------------- ねこ（タイル） ---------------- */

  function createTile(type) {
    const el = document.createElement('div');
    el.className = 'cat';
    const body = document.createElement('div');
    body.className = 'cat__body';
    el.appendChild(body);
    boardEl.appendChild(el);

    const tile = { id: ++uid, type, el, body, r: 0, c: 0 };
    paint(tile);
    return tile;
  }

  /** ねこの みためを つける（丸、または 顔の 画像） */
  function dressBody(body, type) {
    const def = CAT_TYPES[type];
    body.className = 'cat__body cat__body--' + def.key;
    if (def.image && def.ready) {
      body.classList.add('cat__body--image');
      if (def.sheet) body.classList.add('cat__body--sheet');
      body.style.backgroundImage = 'url("' + def.image + '")';
    } else {
      body.style.backgroundImage = '';
    }
  }

  function paint(tile) {
    dressBody(tile.body, tile.type);
    tile.el.setAttribute('aria-label', CAT_TYPES[tile.type].name);
  }

  function moveTo(tile, r, c, instant) {
    tile.r = r;
    tile.c = c;
    const transform = 'translate3d(' + (c * cell) + 'px,' + (r * cell) + 'px,0)';
    if (instant) {
      tile.el.style.transition = 'none';
      tile.el.style.transform = transform;
      void tile.el.offsetWidth; // さいびょうがを はさんで アニメを きる
      tile.el.style.transition = '';
    } else {
      tile.el.style.transform = transform;
    }
  }

  /* ---------------- ばんめんの はんてい ---------------- */

  function typeGrid() {
    return grid.map((row) => row.map((tile) => (tile ? tile.type : -1)));
  }

  /** たて・よこに MIN_MATCH いじょう つながった ならびを かえす */
  function findRuns(tg) {
    const runs = [];

    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const type = tg[r][c];
        let end = c + 1;
        if (type >= 0) {
          while (end < COLS && tg[r][end] === type) end++;
          if (end - c >= MIN_MATCH) runs.push({ dir: 'h', r, c, len: end - c });
        }
        c = Math.max(end, c + 1);
      }
    }

    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const type = tg[r][c];
        let end = r + 1;
        if (type >= 0) {
          while (end < ROWS && tg[end][c] === type) end++;
          if (end - r >= MIN_MATCH) runs.push({ dir: 'v', r, c, len: end - r });
        }
        r = Math.max(end, r + 1);
      }
    }

    return runs;
  }

  /** 1てでも そろえられる いれかえが のこっているか */
  function hasMove(tg) {
    const swapCheck = (r1, c1, r2, c2) => {
      const tmp = tg[r1][c1];
      tg[r1][c1] = tg[r2][c2];
      tg[r2][c2] = tmp;
      const ok = findRuns(tg).length > 0;
      tg[r2][c2] = tg[r1][c1];
      tg[r1][c1] = tmp;
      return ok;
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS && swapCheck(r, c, r, c + 1)) return true;
        if (r + 1 < ROWS && swapCheck(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  /** おいても すぐには そろわない しゅるいを えらぶ */
  function safeType(types, r, c) {
    const pool = [];
    for (let t = 0; t < typeCount; t++) {
      let run = 1;
      for (let k = 1; k < MIN_MATCH && c - k >= 0 && types[r][c - k] === t; k++) run++;
      if (run >= MIN_MATCH) continue;
      run = 1;
      for (let k = 1; k < MIN_MATCH && r - k >= 0 && types[r - k][c] === t; k++) run++;
      if (run >= MIN_MATCH) continue;
      pool.push(t);
    }
    return pool.length ? pool[rand(pool.length)] : rand(typeCount);
  }

  function makeTypes() {
    let types = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      types = [];
      for (let r = 0; r < ROWS; r++) {
        types.push([]);
        for (let c = 0; c < COLS; c++) types[r].push(safeType(types, r, c));
      }
      if (findRuns(types).length === 0 && hasMove(types)) break;
    }
    return types;
  }

  /* ---------------- ゲームの すすみ ---------------- */

  function newGame() {
    busy = true;
    selected = null;
    score = 0;
    moves = 0;
    boardEl.innerHTML = '';
    runwayEl.innerHTML = '';

    const types = makeTypes();
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid.push([]);
      for (let c = 0; c < COLS; c++) {
        const tile = createTile(types[r][c]);
        grid[r].push(tile);
        moveTo(tile, r, c, true);
      }
    }

    layout();
    updateHud();
    say('ねこを すべらせて 4ひき そろえるニャ！');
    busy = false;
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    movesEl.textContent = 'てすう ' + moves;
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ほぞん できなくても つづける */ }
    }
    bestEl.textContent = 'さいこう ' + best;
  }

  function say(text) {
    messageEl.textContent = text;
  }

  function bignews(text) {
    bignewsTxt.textContent = text;
    bignewsEl.hidden = false;
    clearTimeout(bignewsTimer);
    bignewsTimer = setTimeout(() => { bignewsEl.hidden = true; }, 900);
  }

  /** そろった ねこを 画面の 右へ はしらせる。
   *  ばんの そとの レイヤー（runway）に うつしかえるので、
   *  ねこが はしって いる あいだに ばんは どんどん つまって いく。 */
  function escapeRight(tiles) {
    const vw = window.innerWidth;
    // 右の ねこから、すこしずつ ずれて はしりだす（ぎょうれつに みえる）
    const ordered = tiles.slice().sort((a, b) => (b.c - a.c) || (a.r - b.r));

    ordered.forEach((tile, i) => {
      const rect = tile.el.getBoundingClientRect();
      const runner = document.createElement('div');
      runner.className = 'runner';
      runner.style.left = rect.left + 'px';
      runner.style.top = rect.top + 'px';
      runner.style.width = rect.width + 'px';
      runner.style.height = rect.height + 'px';
      runner.style.setProperty('--run', Math.round(vw - rect.left + rect.width) + 'px');
      runner.style.animationDelay = (i * RUN_STAGGER) + 'ms';

      const body = document.createElement('div');
      dressBody(body, tile.type);
      runner.appendChild(body);

      runwayEl.appendChild(runner);
      setTimeout(() => runner.remove(), RUN_MS + i * RUN_STAGGER + 150);
    });
  }

  /** ねこを 下に つめて、あいた ぶんを 上から ふらせる */
  function collapseAndRefill() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const tile = grid[r][c];
        if (!tile) continue;
        if (write !== r) {
          grid[write][c] = tile;
          grid[r][c] = null;
          moveTo(tile, write, c, false);
        }
        write--;
      }
      const missing = write + 1;
      for (let r = write; r >= 0; r--) {
        const tile = createTile(rand(typeCount));
        grid[r][c] = tile;
        moveTo(tile, r - missing, c, true); // ばんの 上（画面の そと）から
        const target = r;
        requestAnimationFrame(() => moveTo(tile, target, c, false));
      }
    }
  }

  /** そろい → にげる → おちる を れんさが とまるまで くりかえす */
  async function resolveBoard() {
    let chain = 0;

    for (;;) {
      const runs = findRuns(typeGrid());
      if (!runs.length) break;
      chain++;

      const doomed = new Set();
      let bonus = 0;
      runs.forEach((run) => {
        bonus += (run.len - MIN_MATCH) * 15;
        for (let i = 0; i < run.len; i++) {
          const r = run.dir === 'h' ? run.r : run.r + i;
          const c = run.dir === 'h' ? run.c + i : run.c;
          if (grid[r][c]) doomed.add(grid[r][c]);
        }
      });

      score += (doomed.size * 10 + bonus) * chain;
      updateHud();
      if (chain >= 2) bignews(chain + 'れんさ！');
      say(doomed.size + 'ひき 右へ にげていった！');

      const tiles = Array.from(doomed);
      escapeRight(tiles);
      tiles.forEach((tile) => {
        grid[tile.r][tile.c] = null;
        tile.el.remove();
      });
      await sleep(ESCAPE_HOLD);

      collapseAndRefill();
      await sleep(FALL_MS + 60);
    }

    if (chain >= 2) say(chain + 'れんさ！ すごいニャ');
    else if (chain === 1) say('にげられたニャ〜');

    if (!hasMove(typeGrid())) await reshuffle();
  }

  /** てづまりに なったら ならびなおす */
  async function reshuffle() {
    say('うごかせる てが ないので ならびなおすニャ');
    const tiles = [];
    eachTile((tile) => tiles.push(tile));

    for (let attempt = 0; attempt < 80; attempt++) {
      const types = tiles.map((tile) => tile.type);
      for (let i = types.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        const tmp = types[i]; types[i] = types[j]; types[j] = tmp;
      }
      const candidate = [];
      for (let r = 0; r < ROWS; r++) candidate.push(types.slice(r * COLS, (r + 1) * COLS));
      if (findRuns(candidate).length === 0 && hasMove(candidate)) {
        tiles.forEach((tile, i) => {
          tile.type = types[i];
          paint(tile);
        });
        break;
      }
    }

    eachTile((tile) => {
      tile.el.animate(
        [{ transform: tile.el.style.transform + ' scale(1)' },
         { transform: tile.el.style.transform + ' scale(.8)' },
         { transform: tile.el.style.transform + ' scale(1)' }],
        { duration: 320, easing: 'ease-in-out' }
      );
    });
    await sleep(340);
  }

  /* ---------------- そうさ ---------------- */

  function selectTile(tile) {
    if (selected) selected.el.classList.remove('is-selected');
    selected = tile || null;
    if (selected) selected.el.classList.add('is-selected');
  }

  function isNeighbor(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  async function trySwap(a, b) {
    if (busy || !a || !b || !isNeighbor(a, b)) return;
    busy = true;
    selectTile(null);

    swapTiles(a, b);
    await sleep(SWAP_MS);

    if (findRuns(typeGrid()).length) {
      moves++;
      updateHud();
      await resolveBoard();
    } else {
      swapTiles(a, b);
      a.el.classList.add('is-nope');
      b.el.classList.add('is-nope');
      say('そろわないから もどったニャ');
      await sleep(Math.max(SWAP_MS, 240));
      a.el.classList.remove('is-nope');
      b.el.classList.remove('is-nope');
    }

    busy = false;
  }

  function swapTiles(a, b) {
    const ar = a.r, ac = a.c, br = b.r, bc = b.c;
    grid[ar][ac] = b;
    grid[br][bc] = a;
    a.el.classList.add('is-swapping');
    b.el.classList.add('is-swapping');
    setTimeout(() => {
      a.el.classList.remove('is-swapping');
      b.el.classList.remove('is-swapping');
    }, SWAP_MS + 20);
    moveTo(a, br, bc, false);
    moveTo(b, ar, ac, false);
  }

  function cellAt(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - boardEl.clientLeft) / cell);
    const r = Math.floor((clientY - rect.top - boardEl.clientTop) / cell);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return grid[r][c];
  }

  /** ドラッグの むきから いれかえ先を きめる。みじかすぎる ときは null。 */
  function swipeTarget(tile, dx, dy) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.4) return null;
    let r = tile.r;
    let c = tile.c;
    if (Math.abs(dx) > Math.abs(dy)) c += dx > 0 ? 1 : -1;
    else r += dy > 0 ? 1 : -1;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return grid[r][c];
  }

  let drag = null;

  boardEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 文字えらびや ネイティブの ドラッグが はじまると イベントが とぎれる ため
    if (busy) return;
    const tile = cellAt(e.clientX, e.clientY);
    if (!tile) return;
    drag = { tile, x: e.clientX, y: e.clientY, moved: false };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* とれなくても そうさは つづく */ }
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.moved || busy) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.4) return;
    drag.moved = true; // ばんの そとむきでも タップあつかいには しない
    const target = swipeTarget(drag.tile, dx, dy);
    if (target) trySwap(drag.tile, target);
  });

  boardEl.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const started = drag;
    drag = null;
    if (started.moved || busy) return;

    // はやい フリックで pointermove が ほとんど とどかなかった ときも ここで ひろう
    const flick = swipeTarget(started.tile, e.clientX - started.x, e.clientY - started.y);
    if (flick) { trySwap(started.tile, flick); return; }

    const tile = cellAt(e.clientX, e.clientY);
    if (!tile) { selectTile(null); return; }
    if (!selected) { selectTile(tile); return; }
    if (selected === tile) { selectTile(null); return; }
    if (isNeighbor(selected, tile)) trySwap(selected, tile);
    else selectTile(tile);
  });

  boardEl.addEventListener('pointercancel', () => { drag = null; });
  boardEl.addEventListener('dragstart', (e) => e.preventDefault());
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------------- ねこの かずを えらぶ がめん ---------------- */

  function buildKindChoices() {
    kindChoice.innerHTML = '';
    [{ n: 4, sub: 'やさしい' }, { n: 5, sub: 'むずかしい' }].forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-choice' + (item.n === typeCount ? ' is-current' : '');

      const sample = document.createElement('span');
      sample.className = 'cat-choice__sample';
      for (let i = 0; i < item.n; i++) {
        const dot = document.createElement('span');
        dressBody(dot, i);
        sample.appendChild(dot);
      }

      const name = document.createElement('span');
      name.textContent = item.n + 'しゅるい';

      const sub = document.createElement('span');
      sub.className = 'cat-choice__sub';
      sub.textContent = item.sub;

      if (item.n === typeCount) {
        const mark = document.createElement('span');
        mark.className = 'cat-choice__mark';
        mark.textContent = '✔';
        btn.appendChild(mark);
      }

      btn.append(sample, name, sub);
      btn.addEventListener('click', () => {
        typeCount = item.n;
        try { localStorage.setItem(KIND_KEY, String(typeCount)); } catch (e) { /* つづける */ }
        kindSubEl.textContent = typeCount + 'しゅるい';
        kindModal.hidden = true;
        newGame();
      });
      kindChoice.appendChild(btn);
    });
  }

  kindBtn.addEventListener('click', () => {
    buildKindChoices();
    kindModal.hidden = false;
  });
  closeBtn.addEventListener('click', () => { kindModal.hidden = true; });
  kindModal.addEventListener('click', (e) => { if (e.target === kindModal) kindModal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') kindModal.hidden = true; });

  resetBtn.addEventListener('click', newGame);
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { best = 0; }
  try { typeCount = Number(localStorage.getItem(KIND_KEY)) === 5 ? 5 : 4; } catch (e) { typeCount = 4; }
  kindSubEl.textContent = typeCount + 'しゅるい';

  loadImages();
  newGame();
})();
