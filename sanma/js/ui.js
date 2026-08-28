/*
 * ui.js - 画面描画とプレイヤー操作
 *
 * レイアウトは iPhone Air（CSS 420x912）を基準にした固定配置。
 * 段ごとの高さは CSS 側で牌の寸法から決めてあるので、
 * 捨て牌や副露が増えても他の段はずれない。
 */
(function (global) {
  'use strict';

  var MJ = global.MJ;
  var SUIT_CLASS = ['m', 'p', 's'];
  var HONOR_CLASS = ['', '', '', '', 'z-haku', 'z-hatsu', 'z-chun'];

  var game = null;
  var riichiMode = false;
  var showHint = false;
  var logLines = [];

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /* --- 牌 -------------------------------------------------------------- */
  function tileHTML(tile, extra) {
    var t = typeof tile === 'number' ? tile : tile.t;
    var red = typeof tile === 'object' && tile.red;
    var cls = ['tile'];
    if (t >= 27) {
      cls.push('z');
      if (HONOR_CLASS[t - 27]) cls.push(HONOR_CLASS[t - 27]);
    } else {
      cls.push(SUIT_CLASS[MJ.suitOf(t)]);
    }
    if (red) cls.push('red');
    if (extra) cls.push(extra);
    var inner = t >= 27
      ? '<span class="z">' + MJ.HONOR_LABEL[t - 27] + '</span>'
      : '<span class="n">' + MJ.numOf(t) + '</span><span class="sl">' + MJ.SUIT_LABEL[MJ.suitOf(t)] + '</span>';
    return '<span class="' + cls.join(' ') + '">' + inner + '</span>';
  }

  function backHTML(extra) {
    return '<span class="tile back ' + (extra || '') + '"></span>';
  }

  function meldHTML(meld, size) {
    var out = ['<span class="meld">'];
    if (meld.type === 'ankan') {
      out.push(backHTML(size), tileHTML(meld.tiles[1], size),
        tileHTML(meld.tiles[2], size), backHTML(size));
    } else {
      meld.tiles.forEach(function (t) {
        var called = meld.calledTile && t.uid === meld.calledTile.uid;
        out.push(tileHTML(t, size + (called ? ' called' : '')));
      });
    }
    out.push('</span>');
    return out.join('');
  }

  /** 副露と抜きドラを 1 段にまとめる（高さを一定に保つため） */
  function exposedHTML(p, size) {
    var out = p.melds.map(function (m) { return meldHTML(m, size); });
    if (p.kita && p.kita.length) {
      out.push('<span class="kita"><span class="label">抜</span>' +
        p.kita.map(function (t) { return tileHTML(t, size); }).join('') + '</span>');
    }
    return '<div class="row-exposed">' + out.join('') + '</div>';
  }

  /** 河。高さは CSS で 2 段ぶんに固定してある */
  function pondHTML(p, size) {
    return '<div class="pond-box"><div class="pond">' + p.discards.map(function (d) {
      var extra = size;
      if (d.riichi) extra += ' riichi-tile';
      if (d.called) extra += ' dim';
      return tileHTML(d.tile, extra);
    }).join('') + '</div></div>';
  }

  function headHTML(p, extraChip) {
    var isDealer = p.seat === game.dealer;
    var ch = p.character != null ? MJ.ai.CHARACTERS[p.character] : null;
    return '<div class="seat-head">' +
      '<span class="wind' + (isDealer ? ' dealer' : '') + '">' +
      MJ.HONOR_LABEL[p.seatWind - 27] + (isDealer ? '親' : '') + '</span>' +
      (p.seatLabel ? '<span class="seat-label">' + p.seatLabel + '</span>' : '') +
      '<span class="nm">' + esc(p.name) + '</span>' +
      (ch ? '<span class="tag">' + ch.tag + '</span>' : '') +
      '<span class="pt">' + p.points + '</span>' +
      (p.riichi ? '<span class="riichi-mark">リーチ</span>' : '') +
      (extraChip ? '<span class="chip">' + esc(extraChip) + '</span>' : '') +
      '</div>';
  }

  /* --- 各席 ------------------------------------------------------------ */
  function seatHTML(p) {
    var backs = '';
    for (var i = 0; i < p.hand.length; i++) backs += backHTML('hidden-tile');
    if (p.drawn) backs += '<span style="width:4px"></span>' + backHTML('hidden-tile');
    return '<div class="seat' + (game.current === p.seat && !game.result ? ' active' : '') + '">' +
      headHTML(p) +
      '<div class="row-back">' + backs + '</div>' +
      exposedHTML(p, 'mini') +
      pondHTML(p, 'mini') +
      '</div>';
  }

  function infobarHTML() {
    var dora = game.doraTiles.map(function (t) { return tileHTML(t, 'mini'); }).join('');
    for (var i = game.doraTiles.length; i < 5; i++) dora += backHTML('mini');
    return '<span class="round">東' + (game.kyoku + 1) + '局' + game.honba + '本場</span>' +
      '<span class="stat">残り <b>' + game.remaining() + '</b></span>' +
      '<span class="stat">供託 ' + game.riichiSticks + '</span>' +
      '<span class="dora">' + dora + '</span>';
  }

  /* --- 自分 ------------------------------------------------------------ */
  function selfHTML() {
    var p = game.players[0];
    var awaiting = game.awaiting && game.awaiting.type === 'turn' && game.awaiting.seat === 0;
    var riichiChoices = riichiMode && game.awaiting && game.awaiting.options.riichiDiscards
      ? game.awaiting.options.riichiDiscards : null;

    var tiles = p.hand.map(function (t, i) {
      var playable = awaiting && (!p.riichi || riichiChoices);
      if (riichiChoices) playable = riichiChoices.indexOf(i) >= 0;
      var cls = playable ? 'playable' : '';
      if (riichiChoices) cls += playable ? ' choice' : ' dim';
      return '<span data-index="' + i + '">' + tileHTML(t, cls) + '</span>';
    }).join('');

    if (p.drawn) {
      var playableDrawn = awaiting;
      if (riichiChoices) playableDrawn = riichiChoices.indexOf(-1) >= 0;
      var dcls = 'drawn ' + (playableDrawn ? 'playable' : '');
      if (riichiChoices) dcls += playableDrawn ? ' choice' : ' dim';
      tiles += '<span data-index="' + p.hand.length + '">' + tileHTML(p.drawn, dcls) + '</span>';
    }

    return '<div class="self' + (game.current === 0 && awaiting ? ' active' : '') + '">' +
      headHTML(p, showHint ? hintText(p) : null) +
      pondHTML(p, '') +
      exposedHTML(p, '') +
      '<div class="self-hand" id="myhand">' + tiles + '</div>' +
      '</div>';
  }

  function hintText(p) {
    var melds = p.melds.length;
    var sh = MJ.shanten(MJ.toCounts(p.hand.concat(p.drawn ? [p.drawn] : [])), melds);
    if (sh === -1) return '和了形';

    // 打牌前（13 枚形）の待ちが分かるなら、残り枚数付きで見せる
    if (p.hand.length + melds * 3 === 13) {
      var base = MJ.toCounts(p.hand);
      if (MJ.shanten(base, melds) === 0) {
        var w = MJ.waits(base, melds);
        if (w.length) {
          var unseen = MJ.ai.unseenCounts(game, { seat: 0, hand: p.hand, melds: p.melds });
          var shown = w.slice(0, 4).map(function (t) {
            return MJ.tileName(t) + unseen[t];
          }).join('・');
          return '待ち ' + shown + (w.length > 4 ? '…' : '');
        }
      }
    }
    if (sh === 0) return 'テンパイ';
    return sh + 'シャンテン';
  }

  /* --- コマンド -------------------------------------------------------- */
  function actionsHTML() {
    var a = game.awaiting;
    if (game.result || game.gameOver) return '<span class="hint">&nbsp;</span>';
    if (!a) return '<span class="hint">CPU 思考中…</span>';

    var out = [];
    if (a.type === 'turn' && a.seat === 0) {
      if (a.auto) return '<span class="hint">リーチ中 — 自動でツモ切り（牌を押すと即切り）</span>';
      if (riichiMode) {
        out.push('<span class="hint">リーチする牌を選ぶ</span>');
        out.push('<button class="btn" data-act="riichi-cancel">やめる</button>');
        return out.join('');
      }
      if (a.options.tsumo) out.push('<button class="btn primary" data-act="tsumo">ツモ</button>');
      if (a.options.riichi) out.push('<button class="btn warn" data-act="riichi">リーチ</button>');
      if (a.options.kita) out.push('<button class="btn" data-act="kita">北抜き</button>');
      (a.options.kans || []).forEach(function (k, i) {
        out.push('<button class="btn" data-act="kan" data-kan="' + i + '">' +
          (k.type === 'ankan' ? '暗カン' : '加カン') + MJ.tileName(k.tile) + '</button>');
      });
      if (!out.length) out.push('<span class="hint">牌を押して捨てる</span>');
      return out.join('');
    }
    if (a.type === 'call' && a.seat === 0) {
      out.push('<span class="hint">' + esc(game.players[a.from].name) + ' の ' +
        MJ.tileName(a.tile.t) + (a.kita ? '（北抜き）' : a.chankan ? '（加カン）' : '') + '</span>');
      if (a.options.ron) out.push('<button class="btn primary" data-act="ron">ロン</button>');
      if (a.options.pon) out.push('<button class="btn" data-act="pon">ポン</button>');
      if (a.options.kan) out.push('<button class="btn" data-act="call-kan">カン</button>');
      out.push('<button class="btn" data-act="pass">パス</button>');
      return out.join('');
    }
    return '<span class="hint">CPU 思考中…</span>';
  }

  /* --- 描画 ------------------------------------------------------------ */
  function render() {
    if (!game) return;
    $('#infobar').innerHTML = infobarHTML();
    // 手番は 自分 → 下家 → 上家 → 自分 と回るので、上から 下家 / 上家 の順に並べる
    $('#board').innerHTML = seatHTML(game.players[1]) + seatHTML(game.players[2]);
    $('#self').innerHTML = selfHTML();
    $('#actions').innerHTML = actionsHTML();
    // 河が 2 段に収まりきらない場合でも最新の捨て牌が見えるようにする
    Array.prototype.forEach.call(document.querySelectorAll('.pond-box'), function (el) {
      el.scrollTop = el.scrollHeight;
    });
  }

  function renderLog() {
    var el = $('#log');
    el.innerHTML = logLines.slice(-60).map(function (l) {
      return '<div class="' + (l.hl ? 'hl' : '') + '">' + esc(l.text) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  /* --- 結果 ------------------------------------------------------------ */
  function showResult(info) {
    var sheet = $('#sheet');
    if (info.type === 'draw') {
      sheet.innerHTML =
        '<h2>流局</h2>' +
        '<div class="detail">' + info.detail.map(esc).join('<br>') + '</div>' +
        '<div class="divider"></div>' + pointsRowHTML() +
        '<div style="margin-top:12px;text-align:right">' +
        '<button class="btn primary" data-act="next">次の局へ</button></div>';
      $('#overlay').hidden = false;
      return;
    }

    var p = game.players[info.winner];
    var r = info.result;
    var handTiles = p.hand.map(function (t) { return tileHTML(t); }).join('') +
      p.melds.map(function (m) { return '<span style="margin-left:6px">' + meldHTML(m, '') + '</span>'; }).join('') +
      '<span style="margin-left:10px">' + tileHTML(info.winTile) + '</span>';
    var kitaLine = p.kita.length
      ? '<div style="margin-top:6px;font-size:12px">抜きドラ ' +
        p.kita.map(function (t) { return tileHTML(t, 'mini'); }).join('') + '</div>'
      : '';
    var yakuRows = r.yaku.map(function (y) {
      return '<div>' + esc(y.name) + '</div><div class="han">' +
        (r.yakumanCount ? '役満' : y.han + '翻') + '</div>';
    }).join('');
    var scoreLine = r.yakumanCount ? r.limit
      : (r.fu + '符 ' + r.han + '翻' + (r.limit ? ' ' + r.limit : ''));
    var doraRow = '<div style="margin-top:8px;font-size:12px">ドラ表示牌 ' +
      game.doraTiles.map(function (t) { return tileHTML(t, 'mini'); }).join('') +
      (info.uraTiles && info.uraTiles.length
        ? '　裏ドラ ' + info.uraTiles.map(function (t) { return tileHTML(t, 'mini'); }).join('')
        : '') + '</div>';

    sheet.innerHTML =
      '<h2>' + esc(p.name) + ' ' + (info.type === 'tsumo' ? 'ツモ' : 'ロン') + '</h2>' +
      '<div class="sub">' + (info.type === 'ron' ? esc(game.players[info.from].name) + ' から' : '') + '</div>' +
      '<div class="agari">' + handTiles + '</div>' + kitaLine + doraRow +
      '<div class="yaku-list">' + yakuRows + '</div>' +
      '<div class="score">' + scoreLine + '</div>' +
      '<div class="detail">' + info.detail.map(esc).join('<br>') + '</div>' +
      '<div class="divider"></div>' + pointsRowHTML() +
      '<div style="margin-top:12px;text-align:right">' +
      '<button class="btn primary" data-act="next">次の局へ</button></div>';
    $('#overlay').hidden = false;
  }

  function pointsRowHTML() {
    return '<div class="standings">' + game.players.map(function (p) {
      return '<div class="' + (p.seat === 0 ? 'me' : '') + '">' +
        esc(p.name) + '　' + p.points + '点</div>';
    }).join('') + '</div>';
  }

  function showGameOver(data) {
    var rank = ['1位', '2位', '3位'];
    $('#sheet').innerHTML =
      '<h2>対局終了</h2>' +
      (data.busted ? '<div class="sub">飛びにより終了</div>' : '<div class="sub">東3局終了</div>') +
      '<div class="standings">' + data.standings.map(function (s, i) {
        return '<div class="' + (s.seat === 0 ? 'me' : '') + '">' +
          rank[i] + '　' + esc(s.name) + '　' + s.points + '点</div>';
      }).join('') + '</div>' +
      '<div style="margin-top:12px;text-align:right">' +
      '<button class="btn primary" data-act="restart">もう一度</button></div>';
    $('#overlay').hidden = false;
  }

  /* --- イベント -------------------------------------------------------- */
  function onEvent(type, data) {
    if (type === 'log') {
      logLines.push({ text: data.message, hl: /===|ツモ|ロン|リーチ/.test(data.message) });
      renderLog();
      return;
    }
    if (type === 'update' || type === 'await' || type === 'handStart') {
      if (type === 'handStart') riichiMode = false;
      render();
      return;
    }
    if (type === 'result') { render(); showResult(data); return; }
    if (type === 'gameOver') { showGameOver(data); return; }
  }

  function handleHandClick(e) {
    var holder = e.target.closest('[data-index]');
    if (!holder) return;
    var a = game.awaiting;
    if (!a || a.type !== 'turn' || a.seat !== 0) return;
    var index = parseInt(holder.getAttribute('data-index'), 10);
    var p = game.players[0];
    var normalized = index === p.hand.length ? -1 : index;

    if (riichiMode) {
      if (a.options.riichiDiscards.indexOf(normalized) < 0) return;
      riichiMode = false;
      game.playerDiscard(index, true);
      return;
    }
    if (p.riichi && normalized !== -1) return; // リーチ後はツモ切りのみ
    game.playerDiscard(index, false);
  }

  function handleAction(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.getAttribute('data-act')) {
      case 'tsumo': game.playerTsumo(); break;
      case 'riichi': riichiMode = true; render(); break;
      case 'riichi-cancel': riichiMode = false; render(); break;
      case 'kita': riichiMode = false; game.playerKita(); break;
      case 'kan':
        riichiMode = false;
        game.playerKan(game.awaiting.options.kans[parseInt(btn.getAttribute('data-kan'), 10)]);
        break;
      case 'ron': game.respondCall('ron'); break;
      case 'pon': game.respondCall('pon'); break;
      case 'call-kan': game.respondCall('kan'); break;
      case 'pass': game.respondCall('pass'); break;
      case 'next': $('#overlay').hidden = true; game.nextHand(); break;
      case 'restart': $('#overlay').hidden = true; startGame(); break;
      case 'new-game': startGame(); break;
      case 'hint':
        showHint = !showHint;
        btn.textContent = showHint ? 'ヒントON' : 'ヒント';
        render();
        break;
      case 'difficulty':
        var levels = MJ.ai.LEVELS;
        game.difficulty = ((game.difficulty == null ? 1 : game.difficulty) + 1) % levels.length;
        btn.textContent = '敵:' + levels[game.difficulty].name;
        break;
      case 'speed':
        var speeds = [1100, 650, 300, 60];
        var labels = ['遅', '普', '速', '瞬'];
        var i = (speeds.indexOf(game.speed) + 1) % speeds.length;
        game.speed = speeds[i];
        btn.textContent = '速度:' + labels[i];
        break;
    }
  }

  function startGame() {
    if (game) game.stop();
    logLines = [];
    riichiMode = false;
    var speed = game ? game.speed : 650;
    var difficulty = game ? game.difficulty : 1;
    game = new MJ.Game({ speed: speed, difficulty: difficulty, onEvent: onEvent });
    global.mjGame = game;
    renderLog();
    game.startGame();
  }

  /** ルール画面のキャラクター一覧を書き出す */
  function renderCharacters() {
    var el = document.getElementById('char-list');
    if (!el) return;
    el.innerHTML = MJ.ai.CHARACTERS.map(function (c) {
      return '<div class="char">' +
        '<div class="char-top"><b>' + esc(c.name) + '</b>' +
        '<span class="tag">' + esc(c.tag) + '</span>' +
        '<span class="nums">速 ' + c.speed.toFixed(1) +
        '／打 ' + c.value.toFixed(1) + '／守 ' + c.defense.toFixed(1) + '</span></div>' +
        '<div class="char-desc">' + esc(c.desc) + '</div>' +
        '<div class="char-desc">鳴き: ' + esc(c.call_ja) +
        '　リーチ: ' + esc(c.riichi_ja) + '　オリ: ' + esc(c.fold_ja) + '</div>' +
        '</div>';
    }).join('');
  }

  function init() {
    renderCharacters();
    document.addEventListener('click', function (e) {
      if (e.target.closest('#myhand')) handleHandClick(e);
      handleAction(e);
    });
    startGame();
  }

  global.MJ.ui = { init: init, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
