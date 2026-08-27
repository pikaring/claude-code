/*
 * ui.js - 画面描画とプレイヤー操作
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
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  /* --- 牌の描画 -------------------------------------------------------- */
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
      out.push(backHTML(size));
      out.push(tileHTML(meld.tiles[1], size));
      out.push(tileHTML(meld.tiles[2], size));
      out.push(backHTML(size));
    } else {
      meld.tiles.forEach(function (t) {
        var isCalled = meld.calledTile && t.uid === meld.calledTile.uid;
        out.push(tileHTML(t, size + (isCalled ? ' called' : '')));
      });
    }
    out.push('</span>');
    return out.join('');
  }

  function pondHTML(p) {
    return '<div class="pond">' + p.discards.map(function (d) {
      var extra = 'small';
      if (d.riichi) extra += ' riichi-tile';
      if (d.called) extra += ' dim';
      return tileHTML(d.tile, extra);
    }).join('') + '</div>';
  }

  /* --- 各席 ------------------------------------------------------------ */
  function seatHTML(p) {
    var isDealer = p.seat === game.dealer;
    var windName = MJ.HONOR_LABEL[p.seatWind - 27];
    var head = '<div class="seat-head">' +
      '<span class="wind' + (isDealer ? ' dealer' : '') + '">' + windName + (isDealer ? '(親)' : '') + '</span>' +
      '<span class="nm">' + esc(p.name) + '</span>' +
      '<span class="pt">' + p.points + '</span>' +
      (p.riichi ? '<span class="riichi-mark">リーチ</span>' : '') +
      '</div>';
    var backs = '';
    for (var i = 0; i < p.hand.length; i++) backs += backHTML('tiny');
    if (p.drawn) backs += '<span style="display:inline-block;width:5px"></span>' + backHTML('tiny');
    var melds = p.melds.length
      ? '<div class="melds" style="margin-top:4px">' + p.melds.map(function (m) { return meldHTML(m, 'tiny'); }).join('') + '</div>'
      : '';
    return '<div class="seat' + (game.current === p.seat && !game.result ? ' active' : '') + '">' +
      head + '<div class="hand-row">' + backs + '</div>' + melds + pondHTML(p) + '</div>';
  }

  function centerHTML() {
    var dora = game.doraTiles.map(function (t) { return tileHTML(t, 'small'); }).join('');
    var hidden = '';
    for (var i = game.doraTiles.length; i < 5; i++) hidden += backHTML('small');
    return '<div class="center-info">' +
      '<div class="round">東' + (game.kyoku + 1) + '局 ' + game.honba + '本場</div>' +
      '<div class="rows">' +
      '<div>残り <b>' + game.remaining() + '</b> 枚</div>' +
      '<div>供託 ' + game.riichiSticks + '本</div>' +
      '</div>' +
      '<div class="dora-label">ドラ表示牌</div>' +
      '<div>' + dora + hidden + '</div>' +
      '</div>';
  }

  /* --- 自分の手牌 ------------------------------------------------------ */
  function selfHTML() {
    var p = game.players[0];
    var awaiting = game.awaiting && game.awaiting.type === 'turn' && game.awaiting.seat === 0;
    var riichiChoices = riichiMode && game.awaiting && game.awaiting.options.riichiDiscards
      ? game.awaiting.options.riichiDiscards : null;

    var head = '<div class="seat-head">' +
      '<span class="wind' + (game.dealer === 0 ? ' dealer' : '') + '">' +
      MJ.HONOR_LABEL[p.seatWind - 27] + (game.dealer === 0 ? '(親)' : '') + '</span>' +
      '<span class="nm">あなた</span><span class="pt">' + p.points + '</span>' +
      (p.riichi ? '<span class="riichi-mark">リーチ</span>' : '') +
      (showHint ? '<span class="chip">' + hintText(p) + '</span>' : '') +
      '</div>';

    var melds = p.melds.length
      ? '<div class="melds">' + p.melds.map(function (m) { return meldHTML(m, 'small'); }).join('') + '</div>'
      : '';

    var tiles = p.hand.map(function (t, i) {
      var playable = awaiting && (!p.riichi || riichiChoices);
      if (riichiChoices) playable = riichiChoices.indexOf(i) >= 0;
      var cls = playable ? 'playable' : '';
      if (riichiChoices && playable) cls += ' choice';
      if (riichiChoices && !playable) cls += ' dim';
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
      head + melds + pondHTML(p) +
      '<div class="self-hand" id="myhand">' + tiles + '</div>' +
      '</div>';
  }

  function hintText(p) {
    var counts = MJ.toCounts(p.hand.concat(p.drawn ? [p.drawn] : []));
    var melds = p.melds.length;
    var sh = MJ.shanten(counts, melds);
    if (sh === -1) return '和了形';
    if (p.hand.length + melds * 3 === 13 && !p.drawn) {
      var w = MJ.waits(counts, melds);
      if (w.length) return '待ち: ' + w.map(MJ.tileName).join('・');
    }
    if (sh === 0) return 'テンパイ';
    return sh + 'シャンテン';
  }

  /* --- 操作ボタン ------------------------------------------------------ */
  function actionsHTML() {
    var a = game.awaiting;
    if (game.result || game.gameOver) return '<span class="hint">&nbsp;</span>';
    if (!a) return '<span class="hint">CPU 思考中…</span>';

    var out = [];
    if (a.type === 'turn' && a.seat === 0) {
      if (riichiMode) {
        out.push('<span class="hint">リーチする牌を選んでください</span>');
        out.push('<button class="btn" data-act="riichi-cancel">キャンセル</button>');
        return out.join('');
      }
      if (a.options.tsumo) out.push('<button class="btn primary" data-act="tsumo">ツモ</button>');
      if (a.options.riichi) out.push('<button class="btn warn" data-act="riichi">リーチ</button>');
      (a.options.kans || []).forEach(function (k, i) {
        out.push('<button class="btn" data-act="kan" data-kan="' + i + '">' +
          (k.type === 'ankan' ? '暗カン' : '加カン') + ' ' + MJ.tileName(k.tile) + '</button>');
      });
      out.push('<span class="hint">牌をクリックして捨てる</span>');
      return out.join('');
    }
    if (a.type === 'call' && a.seat === 0) {
      out.push('<span class="hint">' + esc(game.players[a.from].name) + ' の ' +
        MJ.tileName(a.tile.t) + (a.chankan ? '（加カン）' : '') + '</span>');
      if (a.options.ron) out.push('<button class="btn primary" data-act="ron">ロン</button>');
      if (a.options.pon) out.push('<button class="btn" data-act="pon">ポン</button>');
      if (a.options.kan) out.push('<button class="btn" data-act="call-kan">カン</button>');
      out.push('<button class="btn" data-act="pass">パス</button>');
      return out.join('');
    }
    return '<span class="hint">CPU 思考中…</span>';
  }

  /* --- 全体描画 -------------------------------------------------------- */
  function render() {
    if (!game) return;
    $('#topinfo').innerHTML =
      '<span class="chip">東' + (game.kyoku + 1) + '局 ' + game.honba + '本場</span>' +
      '<span class="chip">残り ' + game.remaining() + '</span>' +
      '<span class="chip">供託 ' + game.riichiSticks + '</span>';
    $('#board').innerHTML =
      seatHTML(game.players[2]) + centerHTML() + seatHTML(game.players[1]);
    $('#self').innerHTML = selfHTML();
    $('#actions').innerHTML = actionsHTML();
  }

  function renderLog() {
    var el = $('#log');
    el.innerHTML = logLines.slice(-60).map(function (l) {
      return '<div class="' + (l.hl ? 'hl' : '') + '">' + esc(l.text) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  /* --- 結果表示 -------------------------------------------------------- */
  function showResult(info) {
    var sheet = $('#sheet');
    if (info.type === 'draw') {
      sheet.innerHTML =
        '<h2>流局</h2>' +
        '<div class="detail">' + info.detail.map(esc).join('<br>') + '</div>' +
        '<div class="divider"></div>' +
        pointsRowHTML() +
        '<div style="margin-top:12px;text-align:right">' +
        '<button class="btn primary" data-act="next">次の局へ</button></div>';
      $('#overlay').hidden = false;
      return;
    }

    var p = game.players[info.winner];
    var r = info.result;
    var handTiles = p.hand.map(function (t) { return tileHTML(t); }).join('') +
      p.melds.map(function (m) { return '<span style="margin-left:8px">' + meldHTML(m) + '</span>'; }).join('') +
      '<span style="margin-left:12px">' + tileHTML(info.winTile) + '</span>';

    var yakuRows = r.yaku.map(function (y) {
      return '<div>' + esc(y.name) + '</div><div class="han">' +
        (r.yakumanCount ? '役満' : y.han + '翻') + '</div>';
    }).join('');

    var scoreLine = r.yakumanCount
      ? r.limit
      : (r.fu + '符 ' + r.han + '翻' + (r.limit ? ' ' + r.limit : ''));

    var doraRow = '<div style="margin-top:8px;font-size:12px">ドラ表示牌 ' +
      game.doraTiles.map(function (t) { return tileHTML(t, 'small'); }).join('') +
      (info.uraTiles && info.uraTiles.length
        ? '　裏ドラ ' + info.uraTiles.map(function (t) { return tileHTML(t, 'small'); }).join('')
        : '') + '</div>';

    sheet.innerHTML =
      '<h2>' + esc(p.name) + ' ' + (info.type === 'tsumo' ? 'ツモ' : 'ロン') + '</h2>' +
      '<div class="sub">' + (info.type === 'ron' ? esc(game.players[info.from].name) + ' から' : '') + '</div>' +
      '<div class="agari">' + handTiles + '</div>' +
      doraRow +
      '<div class="yaku-list">' + yakuRows + '</div>' +
      '<div class="score">' + scoreLine + '</div>' +
      '<div class="detail">' + info.detail.map(esc).join('<br>') + '</div>' +
      '<div class="divider"></div>' +
      pointsRowHTML() +
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

  /* --- イベント処理 ---------------------------------------------------- */
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
    var act = btn.getAttribute('data-act');
    switch (act) {
      case 'tsumo': game.playerTsumo(); break;
      case 'riichi': riichiMode = true; render(); break;
      case 'riichi-cancel': riichiMode = false; render(); break;
      case 'kan':
        var k = game.awaiting.options.kans[parseInt(btn.getAttribute('data-kan'), 10)];
        riichiMode = false;
        game.playerKan(k);
        break;
      case 'ron': game.respondCall('ron'); break;
      case 'pon': game.respondCall('pon'); break;
      case 'call-kan': game.respondCall('kan'); break;
      case 'pass': game.respondCall('pass'); break;
      case 'next':
        $('#overlay').hidden = true;
        game.nextHand();
        break;
      case 'restart':
        $('#overlay').hidden = true;
        startGame();
        break;
      case 'new-game': startGame(); break;
      case 'hint': showHint = !showHint; btn.textContent = showHint ? 'ヒント: ON' : 'ヒント: OFF'; render(); break;
      case 'speed':
        var speeds = [1100, 650, 300, 60];
        var labels = ['ゆっくり', 'ふつう', 'はやい', '最速'];
        var i = (speeds.indexOf(game.speed) + 1) % speeds.length;
        game.speed = speeds[i];
        btn.textContent = '速度: ' + labels[i];
        break;
    }
  }

  function startGame() {
    if (game) game.stop();
    logLines = [];
    riichiMode = false;
    var speed = game ? game.speed : 650;
    game = new MJ.Game({ speed: speed, onEvent: onEvent });
    global.mjGame = game;
    renderLog();
    game.startGame();
  }

  function init() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('#myhand')) handleHandClick(e);
      handleAction(e);
    });
    startGame();
  }

  global.MJ.ui = { init: init, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
