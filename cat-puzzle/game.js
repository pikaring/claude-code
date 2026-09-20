/* ネコおち - 猫の落ちものパズル
 *
 * ルール
 *   - 隣り合う猫をドラッグ（またはタップ2回）で入れかえる
 *   - タテかヨコに同じ猫が MIN_MATCH 匹そろうと、走って画面外へ逃げる
 *   - 空いたところには上から新しい猫が降ってくる（連鎖あり）
 *
 * 猫の絵の差し替え
 *   CAT_TYPES の image に画像パスを入れるだけ。null のあいだは style.css の
 *   .cat__body--<key> で定義した暫定の黒丸・白丸で描画される。
 */
(() => {
  'use strict';

  const COLS = 7;
  const ROWS = 8;
  const MIN_MATCH = 4;

  const SWAP_MS = 170;   // style.css の --swap-ms と合わせる
  const FALL_MS = 260;   // style.css の --fall-ms と合わせる
  const FLEE_MS = 520;   // style.css の --flee-ms と合わせる
  const BEST_KEY = 'nekoochi.best';

  /** 猫の種類。image に 'assets/cat-kuro.png' のようなパスを入れると画像表示になる。 */
  const CAT_TYPES = [
    { key: 'kuro',  name: '黒猫',   image: null },
    { key: 'shiro', name: '白猫',   image: null },
    { key: 'hai',   name: '灰猫',   image: null },
    { key: 'buchi', name: 'ぶち猫', image: null },
    { key: 'tora',  name: 'とら猫', image: null },
  ];

  const boardEl  = document.getElementById('board');
  const scoreEl  = document.getElementById('score');
  const bestEl   = document.getElementById('best');
  const movesEl  = document.getElementById('moves');
  const chainEl  = document.getElementById('chain');
  const statusEl = document.getElementById('status');
  const levelEl  = document.getElementById('level');
  const resetEl  = document.getElementById('reset');

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

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (n) => Math.floor(Math.random() * n);

  /* ---------------- レイアウト ---------------- */

  function layout() {
    const availW = boardEl.parentElement.clientWidth || 360;
    const availH = Math.max(window.innerHeight * 0.58, 260);
    const size = Math.min(availW / COLS, availH / ROWS);
    cell = Math.max(32, Math.min(76, Math.floor(size)));

    boardEl.style.setProperty('--cell', cell + 'px');
    boardEl.style.width = COLS * cell + 'px';
    boardEl.style.height = ROWS * cell + 'px';

    eachTile((tile) => moveTo(tile, tile.r, tile.c, true));
  }

  function eachTile(fn) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c]) fn(grid[r][c]);
      }
    }
  }

  /* ---------------- 猫（タイル） ---------------- */

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

  function paint(tile) {
    const def = CAT_TYPES[tile.type];
    tile.body.className = 'cat__body cat__body--' + def.key;
    if (def.image) {
      tile.body.classList.add('cat__body--image');
      tile.body.style.backgroundImage = 'url("' + def.image + '")';
    } else {
      tile.body.style.backgroundImage = '';
    }
    tile.el.setAttribute('aria-label', def.name);
  }

  function moveTo(tile, r, c, instant) {
    tile.r = r;
    tile.c = c;
    const transform = 'translate3d(' + (c * cell) + 'px,' + (r * cell) + 'px,0)';
    if (instant) {
      tile.el.style.transition = 'none';
      tile.el.style.transform = transform;
      void tile.el.offsetWidth; // 再描画を挟んでトランジションを無効化
      tile.el.style.transition = '';
    } else {
      tile.el.style.transform = transform;
    }
  }

  function destroy(tile) {
    tile.el.remove();
  }

  /* ---------------- 盤面の判定 ---------------- */

  function typeGrid() {
    return grid.map((row) => row.map((tile) => (tile ? tile.type : -1)));
  }

  /** タテヨコに MIN_MATCH 以上つながっている並びを返す */
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

  /** 1手でも 4 そろいを作れる入れかえが残っているか */
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

  /** その場に置いても 4 そろいにならない種類を選ぶ */
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
    for (let attempt = 0; attempt < 60; attempt++) {
      const types = [];
      for (let r = 0; r < ROWS; r++) {
        types.push([]);
        for (let c = 0; c < COLS; c++) types[r].push(safeType(types, r, c));
      }
      if (findRuns(types).length === 0 && hasMove(types)) return types;
    }
    // 保険（ほぼ通らない）
    const types = [];
    for (let r = 0; r < ROWS; r++) {
      types.push([]);
      for (let c = 0; c < COLS; c++) types[r].push(safeType(types, r, c));
    }
    return types;
  }

  /* ---------------- ゲーム進行 ---------------- */

  function newGame() {
    busy = true;
    selected = null;
    score = 0;
    moves = 0;
    typeCount = Number(levelEl.value) || 4;
    boardEl.innerHTML = '';

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
    setStatus('ドラッグ、またはタップ2回で隣の猫と入れかえます。');
    busy = false;
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    movesEl.textContent = String(moves);
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 保存できなくても続行 */ }
    }
    bestEl.textContent = String(best);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showChain(n) {
    chainEl.textContent = n + '連鎖！';
    chainEl.classList.remove('is-on');
    void chainEl.offsetWidth;
    chainEl.classList.add('is-on');
  }

  /** そろった猫を走らせて逃がす */
  function flee(tiles) {
    tiles.forEach((tile) => {
      const toLeft = tile.c < COLS / 2;
      const dist = toLeft ? -(tile.c + 1.4) * cell : (COLS - tile.c + 0.4) * cell;
      tile.body.style.setProperty('--flee', Math.round(dist) + 'px');
      tile.body.style.setProperty('--spin', String(toLeft ? -18 : 18));
      tile.el.classList.add('is-fleeing');
    });
  }

  /** 猫を下に詰めて、空いたぶんを上から降らせる */
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
        moveTo(tile, r - missing, c, true); // 盤の上（画面外）から
        const target = r;
        requestAnimationFrame(() => moveTo(tile, target, c, false));
      }
    }
  }

  /** そろい → 逃走 → 落下 を連鎖が止まるまで繰り返す */
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
      if (chain >= 2) showChain(chain);
      setStatus(doomed.size + '匹が逃げていった！');

      const tiles = Array.from(doomed);
      flee(tiles);
      tiles.forEach((tile) => { grid[tile.r][tile.c] = null; });
      await sleep(FLEE_MS);
      tiles.forEach(destroy);

      collapseAndRefill();
      await sleep(FALL_MS + 60);
    }

    if (chain > 0) setStatus(chain >= 2 ? chain + '連鎖！' : 'にげられた！');

    if (!hasMove(typeGrid())) await reshuffle();
  }

  /** 手詰まりになったら並びかえる */
  async function reshuffle() {
    setStatus('手がなくなったので、猫たちが並びなおしました。');
    const tiles = [];
    eachTile((tile) => tiles.push(tile));

    for (let attempt = 0; attempt < 80; attempt++) {
      const types = tiles.map((tile) => tile.type);
      for (let i = types.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        const tmp = types[i]; types[i] = types[j]; types[j] = tmp;
      }
      const candidate = [];
      for (let r = 0; r < ROWS; r++) {
        candidate.push(types.slice(r * COLS, (r + 1) * COLS));
      }
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

  /* ---------------- 操作 ---------------- */

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

    swapTiles(a, b, true);
    await sleep(SWAP_MS);

    if (findRuns(typeGrid()).length) {
      moves++;
      updateHud();
      await resolveBoard();
    } else {
      swapTiles(a, b, true);
      a.el.classList.add('is-nope');
      b.el.classList.add('is-nope');
      setStatus('そろわないので、猫はもどってしまった。');
      await sleep(Math.max(SWAP_MS, 240));
      a.el.classList.remove('is-nope');
      b.el.classList.remove('is-nope');
    }

    busy = false;
  }

  function swapTiles(a, b, animate) {
    const ar = a.r, ac = a.c, br = b.r, bc = b.c;
    grid[ar][ac] = b;
    grid[br][bc] = a;
    if (animate) {
      a.el.classList.add('is-swapping');
      b.el.classList.add('is-swapping');
      setTimeout(() => {
        a.el.classList.remove('is-swapping');
        b.el.classList.remove('is-swapping');
      }, SWAP_MS + 20);
    }
    moveTo(a, br, bc, false);
    moveTo(b, ar, ac, false);
  }

  function cellAt(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left) / cell);
    const r = Math.floor((clientY - rect.top) / cell);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return grid[r][c];
  }

  let drag = null;

  boardEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // 文字選択やネイティブのドラッグが始まると以降のイベントが途切れるため
    if (busy) return;
    const tile = cellAt(e.clientX, e.clientY);
    if (!tile) return;
    drag = { tile, x: e.clientX, y: e.clientY, moved: false };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても操作は続く */ }
  });

  /** ドラッグ量から入れかえ先を決める。しきい値に満たなければ null。 */
  function swipeTarget(tile, dx, dy) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.4) return null;
    let r = tile.r;
    let c = tile.c;
    if (Math.abs(dx) > Math.abs(dy)) c += dx > 0 ? 1 : -1;
    else r += dy > 0 ? 1 : -1;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return grid[r][c];
  }

  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.moved || busy) return;
    const target = swipeTarget(drag.tile, e.clientX - drag.x, e.clientY - drag.y);
    if (!target && Math.max(Math.abs(e.clientX - drag.x), Math.abs(e.clientY - drag.y)) < cell * 0.4) return;
    drag.moved = true; // しきい値を越えたら、盤外方向でもタップ扱いにはしない
    if (target) trySwap(drag.tile, target);
  });

  boardEl.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const started = drag;
    drag = null;
    if (started.moved || busy) return;

    // 速いフリックで pointermove がほとんど届かなかった場合もここで拾う
    const target = swipeTarget(started.tile, e.clientX - started.x, e.clientY - started.y);
    if (target) { trySwap(started.tile, target); return; }

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

  window.addEventListener('resize', layout);
  resetEl.addEventListener('click', newGame);
  levelEl.addEventListener('change', newGame);

  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { best = 0; }
  newGame();
})();
