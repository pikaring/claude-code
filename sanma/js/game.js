/*
 * game.js - 三人麻雀のゲームエンジン
 *
 * ルール（東風戦・サンマ）:
 *   - 使用牌 108 枚（萬子は 1 と 9 のみ）、赤五筒・赤五索を各 1 枚
 *   - 東1〜東3局、親の連荘あり、持ち点 35000 点
 *   - チーなし、ポン・カン・リーチ・ロン・ツモあり
 *   - ツモ損あり（子のツモは 親 2 : 子 1 の 3 倍取り）
 *   - 北は抜きドラ。自分の番に抜いて嶺上牌をツモり、1枚1翻のドラになる
 *     （抜かずに手牌で使ってもよいが、その場合は客風なので役にはならない）
 *   - ダブロンなし（頭ハネ）
 */
(function (global) {
  'use strict';

  var MJ = global.MJ;
  var SEAT_NAMES = ['あなた', '下家CPU', '上家CPU'];
  var KITA = 30; // 北

  function Game(opts) {
    opts = opts || {};
    this.onEvent = opts.onEvent || function () {};
    this.speed = opts.speed == null ? 650 : opts.speed;
    this.seed = opts.seed;
    this.maxKyoku = opts.maxKyoku || 3;
    this.startPoints = opts.startPoints || 35000;
    this.roundWind = 27; // 東場のみ
    this.players = [0, 1, 2].map(function (i) {
      return {
        seat: i,
        name: SEAT_NAMES[i],
        isAI: i !== 0,
        points: 0,
        hand: [], drawn: null, melds: [], discards: [], kita: [],
        riichi: false, doubleRiichi: false, ippatsu: false, riichiTurn: -1,
        tempFuriten: false, seatWind: 27, menzen: true, drawnFromDeadWall: false
      };
    });
    this.timer = null;
  }

  /* --- 進行制御 -------------------------------------------------------- */

  Game.prototype.emit = function (type, data) {
    this.onEvent(type, data || {});
  };

  Game.prototype.log = function (msg) {
    this.emit('log', { message: msg });
  };

  Game.prototype.schedule = function (fn) {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { fn.call(self); }, this.speed);
  };

  Game.prototype.stop = function () { clearTimeout(this.timer); };

  /* --- 局の開始 -------------------------------------------------------- */

  Game.prototype.startGame = function () {
    var self = this;
    this.rng = this.seed != null ? MJ.mulberry32(this.seed) : Math.random;
    this.players.forEach(function (p) { p.points = self.startPoints; });
    this.kyoku = 0;
    this.honba = 0;
    this.riichiSticks = 0;
    this.gameOver = false;
    this.startHand();
  };

  Game.prototype.startHand = function () {
    var self = this;
    this.dealer = this.kyoku % 3;
    this.wall = MJ.buildWall(this.rng);
    this.deadWall = this.wall.splice(this.wall.length - 14, 14);
    this.rinshanIndex = 0;
    this.kanCount = 0;
    this.turnCount = 0;
    this.firstGoAround = true;
    this.callHappened = false;
    this.awaiting = null;
    this.result = null;

    this.doraIndicators = [this.deadWall[4].t];
    this.doraTiles = [this.deadWall[4]];

    this.players.forEach(function (p, i) {
      p.hand = self.wall.splice(0, 13);
      MJ.sortTiles(p.hand);
      p.drawn = null;
      p.melds = [];
      p.discards = [];
      p.kita = [];
      p.riichi = false; p.doubleRiichi = false; p.ippatsu = false; p.riichiTurn = -1;
      p.tempFuriten = false;
      p.seatWind = 27 + ((i - self.dealer + 3) % 3);
    });

    this.log('=== 東' + (this.kyoku + 1) + '局 ' + this.honba + '本場 / 親: ' +
      this.players[this.dealer].name + ' ===');
    this.emit('handStart', {});
    this.emit('update', {});
    this.schedule(function () { this.beginTurn(this.dealer); });
  };

  /* --- ツモ番 ---------------------------------------------------------- */

  /** replacement: false（通常のツモ）/ 'kan'（嶺上牌）/ 'kita'（北抜き後の補充） */
  Game.prototype.beginTurn = function (seat, replacement) {
    if (this.gameOver || this.result) return;
    var p = this.players[seat];
    this.current = seat;

    if (!replacement && this.wall.length === 0) { this.exhaustiveDraw(); return; }

    var tile;
    if (replacement) {
      // 王牌を 14 枚に保つため、先に生牌山の末尾を王牌へ送ってから嶺上牌を取る。
      // 5 回目以降は補充した牌（index 14 以降）から取るので、
      // ドラ表示牌（4-8）と裏ドラ（9-13）には手を付けない。
      if (this.wall.length > 0) this.deadWall.push(this.wall.pop());
      var idx = this.rinshanIndex < 4 ? this.rinshanIndex : this.rinshanIndex + 10;
      tile = this.deadWall[idx];
      this.deadWall[idx] = null; // 取った嶺上牌は王牌から外す（表示牌の位置はずらさない）
      this.rinshanIndex++;
      if (!tile) { this.exhaustiveDraw(); return; }
    } else {
      tile = this.wall.shift();
    }
    p.drawn = tile;
    p.drawnFromDeadWall = replacement || false;
    if (!p.riichi) p.tempFuriten = false;

    this.emit('update', {});
    this.evaluateTurnOptions(p);
  };

  Game.prototype.evaluateTurnOptions = function (p) {
    var self = this;
    var options = { tsumo: false, riichi: false, kans: [], kita: false };

    // ツモ和了
    var res = this.scoreFor(p, p.drawn, true);
    if (res && res.valid) options.tsumo = res;

    // カン
    if (this.kanCount < 4 && this.wall.length > 0) {
      options.kans = this.kanOptions(p);
    }

    // 北抜き（リーチ後はツモってきた北のみ抜ける）
    if (this.wall.length > 0) {
      options.kita = p.riichi
        ? !!(p.drawn && p.drawn.t === KITA)
        : p.hand.concat(p.drawn ? [p.drawn] : []).some(function (t) { return t.t === KITA; });
    }

    // リーチ
    if (!p.riichi && MJ.isMenzen(p.melds) && p.points >= 1000 && this.wall.length >= 4) {
      options.riichiDiscards = this.riichiDiscardOptions(p);
      options.riichi = options.riichiDiscards.length > 0;
    }

    if (p.isAI) {
      this.aiTurn(p, options);
    } else {
      this.awaiting = { type: 'turn', seat: p.seat, options: options };
      this.emit('await', this.awaiting);
      this.emit('update', {});
    }
  };

  /** リーチ可能な打牌（手牌インデックス、-1 はツモ切り）の一覧 */
  Game.prototype.riichiDiscardOptions = function (p) {
    var tiles = p.hand.concat(p.drawn ? [p.drawn] : []);
    var counts = MJ.toCounts(tiles);
    var out = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i].t;
      counts[t]--;
      if (MJ.shanten(counts, p.melds.length) === 0) {
        out.push(i === p.hand.length ? -1 : i);
      }
      counts[t]++;
    }
    return out;
  };

  Game.prototype.kanOptions = function (p) {
    var out = [];
    var tiles = p.hand.concat(p.drawn ? [p.drawn] : []);
    var counts = MJ.toCounts(tiles);
    for (var t = 0; t < 34; t++) {
      if (counts[t] === 4) {
        if (p.riichi) {
          // リーチ後は待ちが変わらない暗槓のみ許可
          if (!this.ankanKeepsWait(p, t)) continue;
        }
        out.push({ type: 'ankan', tile: t });
      }
    }
    // 加槓
    p.melds.forEach(function (m, idx) {
      if (m.type !== 'pon') return;
      if (counts[m.tile] >= 1) out.push({ type: 'kakan', tile: m.tile, meldIndex: idx });
    });
    return out;
  };

  Game.prototype.ankanKeepsWait = function (p, t) {
    var tiles = p.hand.concat(p.drawn ? [p.drawn] : []);
    var counts = MJ.toCounts(tiles);
    counts[t]--; // 13 枚形
    var before = MJ.waits(counts, p.melds.length).join(',');
    counts[t] -= 3;
    var after = MJ.waits(counts, p.melds.length + 1).join(',');
    return before === after && after !== '';
  };

  /* --- CPU の手番 ------------------------------------------------------ */

  Game.prototype.aiTurn = function (p, options) {
    var self = this;
    this.schedule(function () {
      if (options.tsumo) { self.declareTsumo(p); return; }

      var full = { seat: p.seat, hand: p.hand.concat(p.drawn ? [p.drawn] : []),
        melds: p.melds, seatWind: p.seatWind, riichi: p.riichi, discards: p.discards };

      // 北抜き
      if (options.kita && MJ.ai.shouldKita(self, full)) { self.doKita(p); return; }

      // カン
      for (var i = 0; i < options.kans.length; i++) {
        var k = options.kans[i];
        if (MJ.ai.shouldKanSelf(self, full, k.tile, k.type)) {
          self.doSelfKan(p, k);
          return;
        }
      }

      // リーチ中はツモ切り
      if (p.riichi) { self.discard(p, -1, false); return; }

      var tiles = p.hand.concat([p.drawn]);
      var tmp = { seat: p.seat, hand: tiles, melds: p.melds, seatWind: p.seatWind, discards: p.discards, riichi: p.riichi };
      var idx = MJ.ai.chooseDiscard(self, tmp);
      var declare = false;
      if (options.riichi) {
        var allowed = options.riichiDiscards;
        var mapped = idx === p.hand.length ? -1 : idx;
        if (MJ.ai.shouldRiichi(self, tmp, idx)) {
          if (allowed.indexOf(mapped) >= 0) declare = true;
          else if (allowed.length > 0) { mapped = allowed[0]; declare = true; }
        }
        idx = mapped === -1 ? p.hand.length : mapped;
      }
      self.discard(p, idx === p.hand.length ? -1 : idx, declare);
    });
  };

  /* --- 打牌 ------------------------------------------------------------ */

  /** index: 手牌のインデックス。-1 はツモ切り */
  Game.prototype.discard = function (p, index, declareRiichi) {
    var tile;
    if (index === -1 || index === p.hand.length) {
      tile = p.drawn;
      p.drawn = null;
    } else {
      tile = p.hand[index];
      p.hand.splice(index, 1);
      if (p.drawn) { p.hand.push(p.drawn); p.drawn = null; }
      MJ.sortTiles(p.hand);
    }

    if (declareRiichi) {
      p.riichi = true;
      p.ippatsu = true;
      p.riichiTurn = this.turnCount;
      p.doubleRiichi = this.firstGoAround && !this.callHappened;
      p.points -= 1000;
      this.riichiSticks++;
      this.log(p.name + ' リーチ！' + (p.doubleRiichi ? '（ダブルリーチ）' : ''));
    }

    p.discards.push({
      tile: tile, turn: this.turnCount, riichi: !!declareRiichi,
      tsumogiri: index === -1, called: false
    });
    // 一発は「リーチ宣言者が次に打牌するまで」有効
    if (p.ippatsu && !declareRiichi) p.ippatsu = false;

    this.turnCount++;
    this.firstGoAround = this.turnCount < 3;
    this.awaiting = null;
    this.emit('discard', { seat: p.seat, tile: tile });
    this.emit('update', {});

    this.checkClaims(p, tile);
  };

  /* --- 他家の反応 ------------------------------------------------------ */

  Game.prototype.checkClaims = function (from, tile) {
    var self = this;
    var aiClaims = [];
    var humanOptions = null;
    var houtei = this.wall.length === 0;

    for (var off = 1; off <= 2; off++) {
      var seat = (from.seat + off) % 3;
      var q = this.players[seat];
      var opts = { ron: false, pon: false, kan: false, offset: off };

      var ron = this.canRon(q, tile, from, { isHoutei: houtei });
      if (ron) opts.ron = ron;

      if (!q.riichi && !houtei) {
        var counts = MJ.toCounts(q.hand);
        if (counts[tile.t] >= 2) opts.pon = true;
        if (counts[tile.t] >= 3 && this.kanCount < 4 && this.wall.length > 0) opts.kan = true;
      }

      if (q.isAI) {
        if (opts.ron) aiClaims.push({ seat: seat, type: 'ron', offset: off, result: opts.ron });
        else {
          var tmp = { seat: q.seat, hand: q.hand, melds: q.melds, seatWind: q.seatWind, riichi: q.riichi, discards: q.discards };
          if (opts.kan && MJ.ai.shouldMinkan(this, tmp, tile)) {
            aiClaims.push({ seat: seat, type: 'kan', offset: off });
          } else if (opts.pon && MJ.ai.shouldPon(this, tmp, tile)) {
            aiClaims.push({ seat: seat, type: 'pon', offset: off });
          }
        }
      } else if (opts.ron || opts.pon || opts.kan) {
        humanOptions = opts;
      }
    }

    if (humanOptions) {
      this.awaiting = {
        type: 'call', seat: 0, from: from.seat, tile: tile,
        options: humanOptions, aiClaims: aiClaims
      };
      this.emit('await', this.awaiting);
      this.emit('update', {});
      return;
    }
    this.resolveClaims(aiClaims, from, tile);
  };

  /** プレイヤーの応答（'ron' | 'pon' | 'kan' | 'pass'） */
  Game.prototype.respondCall = function (action) {
    if (!this.awaiting || this.awaiting.type !== 'call') return;
    var a = this.awaiting;
    var claims = a.aiClaims.slice();
    var me = this.players[0];
    if (action === 'ron' && a.options.ron) {
      claims.push({ seat: 0, type: 'ron', offset: a.options.offset, result: a.options.ron });
    } else if (action === 'pon' && a.options.pon) {
      claims.push({ seat: 0, type: 'pon', offset: a.options.offset });
    } else if (action === 'kan' && a.options.kan) {
      claims.push({ seat: 0, type: 'kan', offset: a.options.offset });
    } else if (a.options.ron) {
      me.tempFuriten = true; // ロンを見逃したら同巡内フリテン
    }
    this.awaiting = null;
    this.resolveClaims(claims, this.players[a.from], a.tile);
  };

  Game.prototype.resolveClaims = function (claims, from, tile) {
    var self = this;
    var rons = claims.filter(function (c) { return c.type === 'ron'; });
    if (rons.length > 0) {
      rons.sort(function (a, b) { return a.offset - b.offset; }); // 頭ハネ
      var c = rons[0];
      this.schedule(function () {
        self.applyRon(self.players[c.seat], from, tile, c.result);
      });
      return;
    }
    var call = claims.filter(function (c) { return c.type === 'pon' || c.type === 'kan'; })
      .sort(function (a, b) { return a.offset - b.offset; })[0];
    if (call) {
      this.schedule(function () {
        self.applyCall(self.players[call.seat], from, tile, call.type);
      });
      return;
    }

    if (this.wall.length === 0) { this.exhaustiveDraw(); return; }
    var next = (from.seat + 1) % 3;
    this.schedule(function () { self.beginTurn(next); });
  };

  /* --- 副露 ------------------------------------------------------------ */

  Game.prototype.applyCall = function (p, from, tile, type) {
    var self = this;
    var need = type === 'pon' ? 2 : 3;
    var taken = [];
    for (var i = p.hand.length - 1; i >= 0 && taken.length < need; i--) {
      if (p.hand[i].t === tile.t) taken.push(p.hand.splice(i, 1)[0]);
    }
    p.melds.push({
      type: type === 'pon' ? 'pon' : 'minkan',
      tile: tile.t,
      tiles: taken.concat([tile]),
      from: from.seat,
      calledTile: tile
    });
    from.discards[from.discards.length - 1].called = true;
    this.callHappened = true;
    this.players.forEach(function (q) { q.ippatsu = false; });
    this.log(p.name + ' ' + (type === 'pon' ? 'ポン' : 'カン') + '（' + MJ.tileName(tile.t) + '）');
    this.emit('update', {});

    if (type === 'kan') {
      this.kanCount++;
      this.revealKanDora();
      this.schedule(function () { self.beginTurn(p.seat, 'kan'); });
      return;
    }

    this.current = p.seat;
    if (p.isAI) {
      this.schedule(function () {
        var tmp = { seat: p.seat, hand: p.hand, melds: p.melds, seatWind: p.seatWind, riichi: p.riichi, discards: p.discards };
        var idx = MJ.ai.chooseDiscard(self, tmp);
        self.discard(p, idx, false);
      });
    } else {
      this.awaiting = { type: 'turn', seat: 0, options: { tsumo: false, riichi: false, kans: [] } };
      this.emit('await', this.awaiting);
      this.emit('update', {});
    }
  };

  /* --- 暗槓・加槓 ------------------------------------------------------ */

  Game.prototype.doSelfKan = function (p, k) {
    var self = this;
    var tiles = p.hand.concat(p.drawn ? [p.drawn] : []);

    if (k.type === 'ankan') {
      var taken = [];
      var rest = [];
      tiles.forEach(function (t) {
        if (t.t === k.tile && taken.length < 4) taken.push(t); else rest.push(t);
      });
      p.hand = MJ.sortTiles(rest);
      p.drawn = null;
      p.melds.push({ type: 'ankan', tile: k.tile, tiles: taken, from: p.seat });
      this.kanCount++;
      this.log(p.name + ' 暗カン（' + MJ.tileName(k.tile) + '）');
      this.players.forEach(function (q) { q.ippatsu = false; });
      this.revealKanDora();
      this.emit('update', {});
      this.schedule(function () { self.beginTurn(p.seat, 'kan'); });
      return;
    }

    // 加槓: 槍槓の確認が必要
    var idx = -1;
    for (var i = 0; i < tiles.length; i++) if (tiles[i].t === k.tile) { idx = i; break; }
    var added = tiles.splice(idx, 1)[0];
    p.hand = MJ.sortTiles(tiles);
    p.drawn = null;
    var meld = p.melds[k.meldIndex];
    meld.type = 'kakan';
    meld.tiles.push(added);
    this.kanCount++;
    this.log(p.name + ' 加カン（' + MJ.tileName(k.tile) + '）');
    this.players.forEach(function (q) { q.ippatsu = false; });
    this.emit('update', {});
    this.checkChankan(p, added);
  };

  /* --- 北抜き ---------------------------------------------------------- */

  Game.prototype.doKita = function (p) {
    var tile = null;
    if (p.drawn && p.drawn.t === KITA) {
      tile = p.drawn;
      p.drawn = null;
    } else {
      for (var i = 0; i < p.hand.length; i++) {
        if (p.hand[i].t === KITA) { tile = p.hand.splice(i, 1)[0]; break; }
      }
      if (!tile) return;
      // 手牌から抜いた場合はツモ牌を手牌に入れてから嶺上牌を引く
      if (p.drawn) { p.hand.push(p.drawn); p.drawn = null; MJ.sortTiles(p.hand); }
    }
    p.kita.push(tile);
    this.awaiting = null;
    this.log(p.name + ' 北抜き（' + p.kita.length + '枚目）');
    this.emit('update', {});
    // 抜いた北は搶槓の対象
    this.checkChankan(p, tile, { kita: true });
  };

  Game.prototype.checkChankan = function (from, tile, opts) {
    var self = this;
    var aiClaims = [];
    var humanOptions = null;
    for (var off = 1; off <= 2; off++) {
      var seat = (from.seat + off) % 3;
      var q = this.players[seat];
      var ron = this.canRon(q, tile, from, { isChankan: true });
      if (!ron) continue;
      if (q.isAI) aiClaims.push({ seat: seat, type: 'ron', offset: off, result: ron });
      else humanOptions = { ron: ron, pon: false, kan: false, offset: off };
    }
    if (humanOptions) {
      this.awaiting = {
        type: 'call', seat: 0, from: from.seat, tile: tile, chankan: true,
        kita: !!(opts && opts.kita), options: humanOptions, aiClaims: aiClaims
      };
      this.emit('await', this.awaiting);
      this.emit('update', {});
      return;
    }
    if (aiClaims.length > 0) {
      aiClaims.sort(function (a, b) { return a.offset - b.offset; });
      var c = aiClaims[0];
      this.schedule(function () {
        self.applyRon(self.players[c.seat], from, tile, c.result);
      });
      return;
    }
    if (opts && opts.kita) {
      // 北抜きではドラは増えない
      this.schedule(function () { self.beginTurn(from.seat, 'kita'); });
      return;
    }
    this.revealKanDora();
    this.schedule(function () { self.beginTurn(from.seat, 'kan'); });
  };

  Game.prototype.revealKanDora = function () {
    var idx = 4 + this.doraIndicators.length;
    if (idx <= 8) {
      this.doraIndicators.push(this.deadWall[idx].t);
      this.doraTiles.push(this.deadWall[idx]);
      this.log('新ドラ表示牌: ' + MJ.tileName(this.deadWall[idx].t));
    }
    this.emit('update', {});
  };

  /* --- 和了判定 -------------------------------------------------------- */

  /** ツモ/ロンの点数計算結果を返す（役なしなら valid:false） */
  Game.prototype.scoreFor = function (p, winTile, isTsumo, extra) {
    if (!winTile) return null;
    extra = extra || {};
    var tiles = p.hand.slice();
    if (isTsumo) tiles.push(winTile);
    var counts = MJ.toCounts(tiles);
    if (!isTsumo) counts[winTile.t]++;
    if (!MJ.isAgari(counts, p.melds.length)) return null;

    var redCount = 0;
    tiles.forEach(function (t) { if (t.red) redCount++; });
    if (!isTsumo && winTile.red) redCount++;
    p.melds.forEach(function (m) {
      m.tiles.forEach(function (t) { if (t.red) redCount++; });
    });

    var isFirst = this.turnCount < 3 && !this.callHappened;
    var ctx = {
      concealed: counts,
      melds: p.melds.map(function (m) { return { type: m.type, tile: m.tile }; }),
      winTile: winTile.t,
      isTsumo: isTsumo,
      isRiichi: p.riichi,
      isDoubleRiichi: p.doubleRiichi,
      isIppatsu: p.ippatsu,
      isRinshan: !!(isTsumo && p.drawnFromDeadWall === 'kan'),
      isChankan: !!extra.isChankan,
      isHaitei: !!(isTsumo && this.wall.length === 0 && !p.drawnFromDeadWall),
      kitaCount: p.kita.length,
      isHoutei: !!(!isTsumo && extra.isHoutei),
      isTenhou: !!(isTsumo && isFirst && p.seat === this.dealer && p.discards.length === 0),
      isChiihou: !!(isTsumo && isFirst && p.seat !== this.dealer && p.discards.length === 0),
      seatWind: p.seatWind,
      roundWind: this.roundWind,
      doraIndicators: this.doraIndicators,
      uraIndicators: p.riichi ? this.uraIndicatorsFor() : [],
      redCount: redCount
    };
    return MJ.evaluate(ctx);
  };

  Game.prototype.uraIndicatorsFor = function () {
    var out = [];
    for (var i = 0; i < this.doraIndicators.length; i++) {
      var t = this.deadWall[9 + i];
      if (t) out.push(t.t);
    }
    return out;
  };

  Game.prototype.uraTiles = function () {
    var out = [];
    for (var i = 0; i < this.doraIndicators.length; i++) {
      if (this.deadWall[9 + i]) out.push(this.deadWall[9 + i]);
    }
    return out;
  };

  /** ロン可能かを判定して結果を返す（不可なら null） */
  Game.prototype.canRon = function (p, tile, from, extra) {
    if (p.seat === from.seat) return null;
    var counts = MJ.toCounts(p.hand);
    counts[tile.t]++;
    if (!MJ.isAgari(counts, p.melds.length)) return null;
    counts[tile.t]--;

    // フリテン
    var w = MJ.waits(counts, p.melds.length);
    var furiten = p.discards.some(function (d) { return w.indexOf(d.tile.t) >= 0; });
    if (furiten || p.tempFuriten) return null;

    var res = this.scoreFor(p, tile, false, extra);
    return res && res.valid ? res : null;
  };

  /* --- 和了処理 -------------------------------------------------------- */

  Game.prototype.declareTsumo = function (p) {
    var res = this.scoreFor(p, p.drawn, true);
    if (!res || !res.valid) return;
    var isDealer = p.seat === this.dealer;
    var pay = MJ.payments(res.base, isDealer, true);
    var self = this;
    var detail = [];

    this.players.forEach(function (q) {
      if (q === p) return;
      var amount = isDealer ? pay.each : (q.seat === self.dealer ? pay.dealerPay : pay.koPay);
      amount += 100 * self.honba;
      q.points -= amount;
      p.points += amount;
      detail.push(q.name + ' -' + amount);
    });
    p.points += this.riichiSticks * 1000;

    this.finishHand({
      type: 'tsumo', winner: p.seat, result: res,
      winTile: p.drawn, detail: detail,
      dealerContinue: isDealer
    });
  };

  Game.prototype.applyRon = function (p, from, tile, res) {
    var isDealer = p.seat === this.dealer;
    var pay = MJ.payments(res.base, isDealer, false);
    var amount = pay.ron + 300 * this.honba;
    from.points -= amount;
    p.points += amount + this.riichiSticks * 1000;
    if (from.discards.length) from.discards[from.discards.length - 1].called = true;

    this.finishHand({
      type: 'ron', winner: p.seat, from: from.seat, result: res,
      winTile: tile, detail: [from.name + ' -' + amount],
      dealerContinue: isDealer
    });
  };

  Game.prototype.finishHand = function (info) {
    this.riichiSticks = 0;
    this.awaiting = null;
    this.result = info;
    info.uraTiles = this.players[info.winner].riichi ? this.uraTiles() : [];
    var p = this.players[info.winner];
    this.log(p.name + ' ' + (info.type === 'tsumo' ? 'ツモ' : 'ロン') + '！ ' +
      info.result.yaku.map(function (y) { return y.name + (y.han ? ' ' + y.han : ''); }).join('・'));
    this.emit('update', {});
    this.emit('result', info);
  };

  /* --- 流局 ------------------------------------------------------------ */

  Game.prototype.exhaustiveDraw = function () {
    var self = this;
    var tenpai = this.players.map(function (p) {
      return MJ.shanten(MJ.toCounts(p.hand), p.melds.length) === 0;
    });
    var n = tenpai.filter(Boolean).length;
    var detail = [];
    if (n === 1 || n === 2) {
      var pot = 3000;
      var gain = Math.floor(pot / n);
      var pay = Math.floor(pot / (3 - n));
      this.players.forEach(function (p, i) {
        if (tenpai[i]) { p.points += gain; detail.push(p.name + ' テンパイ +' + gain); }
        else { p.points -= pay; detail.push(p.name + ' ノーテン -' + pay); }
      });
    } else {
      this.players.forEach(function (p, i) {
        detail.push(p.name + (tenpai[i] ? ' テンパイ' : ' ノーテン'));
      });
    }
    this.awaiting = null;
    this.result = {
      type: 'draw', tenpai: tenpai, detail: detail,
      dealerContinue: tenpai[this.dealer]
    };
    this.log('流局（テンパイ ' + n + '人）');
    this.emit('update', {});
    this.emit('result', this.result);
  };

  /* --- 次局へ ---------------------------------------------------------- */

  Game.prototype.nextHand = function () {
    var info = this.result;
    if (!info) return;
    var busted = this.players.some(function (p) { return p.points < 0; });

    if (info.dealerContinue) {
      this.honba++;
    } else {
      this.kyoku++;
      this.honba = info.type === 'draw' ? this.honba + 1 : 0;
    }

    if (busted || this.kyoku >= this.maxKyoku) {
      this.gameOver = true;
      this.result = null;
      this.emit('gameOver', {
        standings: this.players.map(function (p) {
          return { name: p.name, points: p.points, seat: p.seat };
        }).sort(function (a, b) { return b.points - a.points; }),
        busted: busted
      });
      return;
    }
    this.result = null;
    this.startHand();
  };

  /* --- プレイヤー操作 API ---------------------------------------------- */

  Game.prototype.playerDiscard = function (index, declareRiichi) {
    if (!this.awaiting || this.awaiting.type !== 'turn' || this.awaiting.seat !== 0) return false;
    var p = this.players[0];
    if (p.riichi && !declareRiichi) {
      // リーチ後はツモ切りのみ
      if (index !== -1 && index !== p.hand.length) return false;
    }
    this.awaiting = null;
    this.discard(p, index === p.hand.length ? -1 : index, !!declareRiichi);
    return true;
  };

  Game.prototype.playerTsumo = function () {
    if (!this.awaiting || this.awaiting.type !== 'turn') return false;
    if (!this.awaiting.options.tsumo) return false;
    this.awaiting = null;
    this.declareTsumo(this.players[0]);
    return true;
  };

  Game.prototype.playerKan = function (k) {
    if (!this.awaiting || this.awaiting.type !== 'turn') return false;
    this.awaiting = null;
    this.doSelfKan(this.players[0], k);
    return true;
  };

  Game.prototype.playerKita = function () {
    if (!this.awaiting || this.awaiting.type !== 'turn') return false;
    if (!this.awaiting.options.kita) return false;
    this.awaiting = null;
    this.doKita(this.players[0]);
    return true;
  };

  Game.prototype.remaining = function () { return this.wall.length; };

  global.MJ.Game = Game;
  global.MJ.SEAT_NAMES = SEAT_NAMES;
})(typeof window !== 'undefined' ? window : globalThis);
