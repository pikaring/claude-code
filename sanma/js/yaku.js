/*
 * yaku.js - 役判定・符計算・点数計算
 *
 * evaluate(ctx) を呼ぶと、最も高得点になる面子分解を選んで結果を返す。
 *
 * ctx = {
 *   concealed:  34要素カウント配列（和了牌を含む純手牌）
 *   melds:      [{type:'pon'|'minkan'|'kakan'|'ankan', tile}]
 *   winTile:    和了牌 ID
 *   isTsumo, isRiichi, isDoubleRiichi, isIppatsu,
 *   isRinshan, isChankan, isHaitei, isHoutei, isTenhou, isChiihou,
 *   seatWind:   自風の牌 ID (27-29)
 *   roundWind:  場風の牌 ID (27-)
 *   doraIndicators: [牌ID], uraIndicators: [牌ID], redCount: 赤ドラ枚数
 *   kitaCount:  抜いた北の枚数（1枚1翻のドラ）
 * }
 */
(function (global) {
  'use strict';

  var MJ = global.MJ;

  function isMenzen(melds) {
    for (var i = 0; i < melds.length; i++) {
      if (melds[i].type !== 'ankan') return false;
    }
    return true;
  }

  /** 副露を含めた全体のカウント配列 */
  function fullCounts(ctx) {
    var c = ctx.concealed.slice();
    ctx.melds.forEach(function (m) {
      var n = m.type === 'pon' ? 3 : 4;
      if (m.type === 'pon') { c[m.tile] += 3; }
      else if (m.type === 'run') { c[m.tile]++; c[m.tile + 1]++; c[m.tile + 2]++; }
      else { c[m.tile] += 4; }
      return n;
    });
    return c;
  }

  /* --- 役満 ------------------------------------------------------------ */
  function checkYakuman(ctx, all) {
    var out = [];
    var menzen = isMenzen(ctx.melds);
    var concealed = ctx.concealed;

    if (menzen && MJ.isKokushi(concealed)) {
      // 13面待ちなら和了前が全種 1 枚ずつ
      var pre = concealed.slice(); pre[ctx.winTile]--;
      var thirteen = true;
      for (var i = 0; i < 34; i++) if (pre[i] > 1) thirteen = false;
      out.push({ name: thirteen ? '国士無双十三面' : '国士無双', han: thirteen ? 26 : 13, yakuman: thirteen ? 2 : 1 });
      return out;
    }

    var dragons = [31, 32, 33].filter(function (t) { return all[t] >= 3; }).length;
    if (dragons === 3) out.push({ name: '大三元', han: 13, yakuman: 1 });

    var winds = [27, 28, 29, 30];
    var windTriplets = winds.filter(function (t) { return all[t] >= 3; }).length;
    var windPairs = winds.filter(function (t) { return all[t] === 2; }).length;
    if (windTriplets === 4) out.push({ name: '大四喜', han: 26, yakuman: 2 });
    else if (windTriplets === 3 && windPairs === 1) out.push({ name: '小四喜', han: 13, yakuman: 1 });

    var allHonor = true, allTerminal = true, allGreen = true;
    var GREEN = { 19: 1, 20: 1, 21: 1, 23: 1, 25: 1, 32: 1 }; // 2s3s4s6s8s發
    for (var t = 0; t < 34; t++) {
      if (all[t] === 0) continue;
      if (!MJ.isHonor(t)) allHonor = false;
      if (!MJ.isTerminal(t)) allTerminal = false;
      if (!GREEN[t]) allGreen = false;
    }
    if (allHonor) out.push({ name: '字一色', han: 13, yakuman: 1 });
    if (allTerminal) out.push({ name: '清老頭', han: 13, yakuman: 1 });
    if (allGreen) out.push({ name: '緑一色', han: 13, yakuman: 1 });

    var kans = ctx.melds.filter(function (m) { return m.type !== 'pon'; }).length;
    if (kans === 4) out.push({ name: '四槓子', han: 13, yakuman: 1 });

    // 四暗刻（暗刻 4 つ。ロンで完成した刻子は明刻扱い）
    var ankanCount = ctx.melds.filter(function (m) { return m.type === 'ankan'; }).length;
    var decs = MJ.decompose(concealed);
    for (var d = 0; d < decs.length; d++) {
      var dec = decs[d];
      var ankou = ankanCount;
      var isTanki = dec.pair === ctx.winTile;
      var ok = true;
      for (var s = 0; s < dec.sets.length; s++) {
        var set = dec.sets[s];
        if (set.type !== 'triplet') { ok = false; break; }
        if (!ctx.isTsumo && set.tile === ctx.winTile && !isTanki) continue; // 明刻
        ankou++;
      }
      if (ok && menzen && ankou === 4) {
        if (isTanki) out.push({ name: '四暗刻単騎', han: 26, yakuman: 2 });
        else out.push({ name: '四暗刻', han: 13, yakuman: 1 });
        break;
      }
    }

    if (ctx.isTenhou) out.push({ name: '天和', han: 13, yakuman: 1 });
    if (ctx.isChiihou) out.push({ name: '地和', han: 13, yakuman: 1 });

    return out;
  }

  /* --- 待ちの形 -------------------------------------------------------- */
  function waitKinds(dec, winTile) {
    var out = [];
    if (dec.pair === winTile) out.push({ kind: 'tanki', block: -1 });
    for (var i = 0; i < dec.sets.length; i++) {
      var s = dec.sets[i];
      if (s.type === 'triplet') {
        if (s.tile === winTile) out.push({ kind: 'shanpon', block: i });
      } else {
        var n = winTile - s.tile;
        if (n < 0 || n > 2) continue;
        if (n === 1) out.push({ kind: 'kanchan', block: i });
        else {
          var num = s.tile % 9 + 1; // 順子の開始数字
          var penchan = (num === 1 && n === 2) || (num === 7 && n === 0);
          out.push({ kind: penchan ? 'penchan' : 'ryanmen', block: i });
        }
      }
    }
    if (out.length === 0) out.push({ kind: 'tanki', block: -1 });
    return out;
  }

  /* --- 符計算 ---------------------------------------------------------- */
  function calcFu(ctx, dec, wait, hasPinfu) {
    var menzen = isMenzen(ctx.melds);
    if (hasPinfu) return ctx.isTsumo ? 20 : 30;

    var fu = 20;
    if (menzen && !ctx.isTsumo) fu += 10;
    if (ctx.isTsumo) fu += 2;

    dec.sets.forEach(function (s, i) {
      if (s.type !== 'triplet') return;
      var open = !ctx.isTsumo && wait.kind === 'shanpon' && wait.block === i;
      var base = MJ.isYaochu(s.tile) ? 8 : 4;
      fu += open ? base / 2 : base;
    });

    ctx.melds.forEach(function (m) {
      var yaochu = MJ.isYaochu(m.tile);
      if (m.type === 'pon') fu += yaochu ? 4 : 2;
      else if (m.type === 'ankan') fu += yaochu ? 32 : 16;
      else fu += yaochu ? 16 : 8; // 明槓・加槓
    });

    // 雀頭（役牌）
    var p = dec.pair;
    if (MJ.isDragon(p)) fu += 2;
    if (p === ctx.seatWind) fu += 2;
    if (p === ctx.roundWind) fu += 2;

    if (wait.kind === 'kanchan' || wait.kind === 'penchan' || wait.kind === 'tanki') fu += 2;

    // 食い平和形は 30 符
    if (!menzen && fu === 20) fu = 30;

    return Math.ceil(fu / 10) * 10;
  }

  /* --- 通常役 ---------------------------------------------------------- */
  function checkYaku(ctx, dec, wait, all) {
    var menzen = isMenzen(ctx.melds);
    var yaku = [];
    var add = function (name, han) { yaku.push({ name: name, han: han }); };

    // 全ブロック（副露込み）を一覧化
    var blocks = dec.sets.map(function (s) {
      return { type: s.type, tile: s.tile, open: false, kan: false };
    });
    ctx.melds.forEach(function (m) {
      blocks.push({
        type: 'triplet', tile: m.tile,
        open: m.type !== 'ankan', kan: m.type !== 'pon'
      });
    });

    if (ctx.isRiichi) add(ctx.isDoubleRiichi ? 'ダブル立直' : '立直', ctx.isDoubleRiichi ? 2 : 1);
    if (ctx.isIppatsu) add('一発', 1);
    if (ctx.isTsumo && menzen) add('門前清自摸和', 1);
    if (ctx.isRinshan) add('嶺上開花', 1);
    if (ctx.isChankan) add('槍槓', 1);
    if (ctx.isHaitei) add('海底摸月', 1);
    if (ctx.isHoutei) add('河底撈魚', 1);

    // 平和
    var allRuns = blocks.every(function (b) { return b.type === 'run'; });
    var pairYakuhai = MJ.isDragon(dec.pair) || dec.pair === ctx.seatWind || dec.pair === ctx.roundWind;
    var pinfu = menzen && allRuns && !pairYakuhai && wait.kind === 'ryanmen';
    if (pinfu) add('平和', 1);

    // 断幺九
    var tanyao = true;
    for (var t = 0; t < 34; t++) if (all[t] > 0 && MJ.isYaochu(t)) { tanyao = false; break; }
    if (tanyao) add('断幺九', 1);

    // 役牌
    [31, 32, 33].forEach(function (d) {
      if (all[d] >= 3) add({ 31: '役牌 白', 32: '役牌 發', 33: '役牌 中' }[d], 1);
    });
    if (all[ctx.seatWind] >= 3) add('自風 ' + MJ.tileName(ctx.seatWind), 1);
    if (all[ctx.roundWind] >= 3) add('場風 ' + MJ.tileName(ctx.roundWind), 1);

    // 一盃口・二盃口
    if (menzen) {
      var runCount = {};
      dec.sets.forEach(function (s) {
        if (s.type === 'run') runCount[s.tile] = (runCount[s.tile] || 0) + 1;
      });
      var iipeiko = 0;
      Object.keys(runCount).forEach(function (k) { iipeiko += Math.floor(runCount[k] / 2); });
      if (iipeiko >= 2) add('二盃口', 3);
      else if (iipeiko === 1) add('一盃口', 1);
    }

    // 三色同順（三麻では萬子の 2-8 が無いため実質成立しない）
    var runStarts = {};
    blocks.forEach(function (b) {
      if (b.type !== 'run') return;
      var n = b.tile % 9, s = Math.floor(b.tile / 9);
      (runStarts[n] = runStarts[n] || {})[s] = true;
    });
    var sanshoku = Object.keys(runStarts).some(function (n) {
      return runStarts[n][0] && runStarts[n][1] && runStarts[n][2];
    });
    if (sanshoku) add('三色同順', menzen ? 2 : 1);

    // 三色同刻
    var tripNums = {};
    blocks.forEach(function (b) {
      if (b.type !== 'triplet' || b.tile >= 27) return;
      var n = b.tile % 9, s = Math.floor(b.tile / 9);
      (tripNums[n] = tripNums[n] || {})[s] = true;
    });
    if (Object.keys(tripNums).some(function (n) {
      return tripNums[n][0] && tripNums[n][1] && tripNums[n][2];
    })) add('三色同刻', 2);

    // 一気通貫
    for (var suit = 0; suit < 3; suit++) {
      var base = suit * 9;
      var has = [0, 3, 6].every(function (off) {
        return blocks.some(function (b) { return b.type === 'run' && b.tile === base + off; });
      });
      if (has) { add('一気通貫', menzen ? 2 : 1); break; }
    }

    // 対々和・三暗刻・三槓子
    var allTriplets = blocks.every(function (b) { return b.type === 'triplet'; });
    if (allTriplets) add('対々和', 2);

    var ankou = 0;
    dec.sets.forEach(function (s, i) {
      if (s.type !== 'triplet') return;
      if (!ctx.isTsumo && wait.kind === 'shanpon' && wait.block === i) return;
      ankou++;
    });
    ctx.melds.forEach(function (m) { if (m.type === 'ankan') ankou++; });
    if (ankou >= 3) add('三暗刻', 2);

    var kanCount = ctx.melds.filter(function (m) { return m.type !== 'pon'; }).length;
    if (kanCount === 3) add('三槓子', 2);

    // 小三元
    var dragonTriplets = [31, 32, 33].filter(function (d) { return all[d] >= 3; }).length;
    if (dragonTriplets === 2 && [31, 32, 33].some(function (d) { return all[d] === 2; })) {
      add('小三元', 2);
    }

    // 混老頭・混全帯幺九・純全帯幺九
    var allYaochuTiles = true;
    for (var y = 0; y < 34; y++) if (all[y] > 0 && !MJ.isYaochu(y)) { allYaochuTiles = false; break; }
    if (allYaochuTiles) {
      add('混老頭', 2);
    } else {
      var chantaOK = blocks.every(function (b) {
        if (b.type === 'triplet') return MJ.isYaochu(b.tile);
        var n = b.tile % 9;
        return n === 0 || n === 6;
      }) && MJ.isYaochu(dec.pair);
      if (chantaOK) {
        var hasHonor = blocks.some(function (b) { return b.tile >= 27; }) || dec.pair >= 27;
        if (hasHonor) add('混全帯幺九', menzen ? 2 : 1);
        else add('純全帯幺九', menzen ? 3 : 2);
      }
    }

    // 混一色・清一色
    var suits = {}, honor = false;
    for (var z = 0; z < 34; z++) {
      if (all[z] === 0) continue;
      if (z >= 27) honor = true; else suits[Math.floor(z / 9)] = true;
    }
    var suitCount = Object.keys(suits).length;
    if (suitCount === 1 && !honor) add('清一色', menzen ? 6 : 5);
    else if (suitCount === 1 && honor) add('混一色', menzen ? 3 : 2);
    else if (suitCount === 0 && honor) add('混一色', menzen ? 3 : 2);

    return { yaku: yaku, pinfu: pinfu };
  }

  /* --- ドラ ------------------------------------------------------------ */
  function countDora(ctx, all) {
    var out = [];
    var n = 0;
    (ctx.doraIndicators || []).forEach(function (ind) {
      n += all[MJ.doraFromIndicator(ind)];
    });
    if (n > 0) out.push({ name: 'ドラ', han: n, isDora: true });
    if (ctx.redCount > 0) out.push({ name: '赤ドラ', han: ctx.redCount, isDora: true });
    if (ctx.kitaCount > 0) out.push({ name: '抜きドラ', han: ctx.kitaCount, isDora: true });
    if (ctx.isRiichi) {
      var u = 0;
      (ctx.uraIndicators || []).forEach(function (ind) {
        u += all[MJ.doraFromIndicator(ind)];
      });
      if (u > 0) out.push({ name: '裏ドラ', han: u, isDora: true });
    }
    return out;
  }

  /* --- 点数 ------------------------------------------------------------ */
  function basePoints(han, fu, yakumanCount) {
    if (yakumanCount > 0) return 8000 * yakumanCount;
    if (han >= 13) return 8000;   // 数え役満
    if (han >= 11) return 6000;   // 三倍満
    if (han >= 8) return 4000;    // 倍満
    if (han >= 6) return 3000;    // 跳満
    if (han >= 5) return 2000;    // 満貫
    return Math.min(2000, fu * Math.pow(2, 2 + han));
  }

  function limitName(han, fu, yakumanCount) {
    if (yakumanCount >= 2) return yakumanCount + '倍役満';
    if (yakumanCount === 1) return '役満';
    if (han >= 13) return '数え役満';
    if (han >= 11) return '三倍満';
    if (han >= 8) return '倍満';
    if (han >= 6) return '跳満';
    if (han >= 5) return '満貫';
    if (fu * Math.pow(2, 2 + han) >= 2000) return '満貫';
    return '';
  }

  /** メイン: 最も高い点数になる解釈を返す */
  function evaluate(ctx) {
    ctx.melds = ctx.melds || [];
    ctx.doraIndicators = ctx.doraIndicators || [];
    ctx.uraIndicators = ctx.uraIndicators || [];
    ctx.redCount = ctx.redCount || 0;
    ctx.kitaCount = ctx.kitaCount || 0;

    var all = fullCounts(ctx);
    var menzen = isMenzen(ctx.melds);
    var doraYaku = countDora(ctx, all);

    // 役満
    var ym = checkYakuman(ctx, all);
    if (ym.length > 0) {
      var count = ym.reduce(function (a, y) { return a + (y.yakuman || 1); }, 0);
      return {
        valid: true, yaku: ym, han: count * 13, fu: 0,
        base: basePoints(0, 0, count), yakumanCount: count,
        limit: limitName(0, 0, count)
      };
    }

    var candidates = [];

    // 七対子
    if (menzen && MJ.isChiitoi(ctx.concealed)) {
      var cy = [{ name: '七対子', han: 2 }];
      if (ctx.isRiichi) cy.unshift({ name: ctx.isDoubleRiichi ? 'ダブル立直' : '立直', han: ctx.isDoubleRiichi ? 2 : 1 });
      if (ctx.isIppatsu) cy.push({ name: '一発', han: 1 });
      if (ctx.isTsumo) cy.push({ name: '門前清自摸和', han: 1 });
      if (ctx.isHaitei) cy.push({ name: '海底摸月', han: 1 });
      if (ctx.isHoutei) cy.push({ name: '河底撈魚', han: 1 });
      var tanyao7 = true, suits7 = {}, honor7 = false;
      for (var i7 = 0; i7 < 34; i7++) {
        if (all[i7] === 0) continue;
        if (MJ.isYaochu(i7)) tanyao7 = false;
        if (i7 >= 27) honor7 = true; else suits7[Math.floor(i7 / 9)] = true;
      }
      if (tanyao7) cy.push({ name: '断幺九', han: 1 });
      var sc7 = Object.keys(suits7).length;
      if (sc7 === 1 && !honor7) cy.push({ name: '清一色', han: 6 });
      else if (sc7 <= 1 && honor7) cy.push({ name: '混一色', han: 3 });
      var allY7 = true;
      for (var j7 = 0; j7 < 34; j7++) if (all[j7] > 0 && !MJ.isYaochu(j7)) { allY7 = false; break; }
      if (allY7) cy.push({ name: '混老頭', han: 2 });
      candidates.push(makeResult(cy, doraYaku, 25));
    }

    // 一般形
    var decs = MJ.decompose(ctx.concealed);
    decs.forEach(function (dec) {
      waitKinds(dec, ctx.winTile).forEach(function (wait) {
        var r = checkYaku(ctx, dec, wait, all);
        var fu = calcFu(ctx, dec, wait, r.pinfu);
        candidates.push(makeResult(r.yaku, doraYaku, fu));
      });
    });

    if (candidates.length === 0) {
      return { valid: false, yaku: [], han: 0, fu: 0, base: 0, yakumanCount: 0, limit: '' };
    }

    candidates.sort(function (a, b) {
      if (b.base !== a.base) return b.base - a.base;
      if (b.han !== a.han) return b.han - a.han;
      return b.fu - a.fu;
    });
    return candidates[0];
  }

  function makeResult(yakuList, doraYaku, fu) {
    var hasRealYaku = yakuList.length > 0;
    var yaku = yakuList.concat(doraYaku);
    var han = yaku.reduce(function (a, y) { return a + y.han; }, 0);
    return {
      valid: hasRealYaku,
      yaku: yaku,
      han: han,
      fu: fu,
      base: hasRealYaku ? basePoints(han, fu, 0) : 0,
      yakumanCount: 0,
      limit: hasRealYaku ? limitName(han, fu, 0) : ''
    };
  }

  /** 和了点の支払い計算（三人麻雀・ツモ損あり）
   *  isDealer: 和了者が親か
   *  戻り値: {total, fromEach:{dealer, ko}, fromRon}
   */
  function payments(base, isDealer, isTsumo) {
    if (isTsumo) {
      if (isDealer) {
        var each = ceil100(base * 2);
        return { total: each * 2, each: each, dealerPay: each, koPay: each };
      }
      var dealerPay = ceil100(base * 2), koPay = ceil100(base);
      return { total: dealerPay + koPay, dealerPay: dealerPay, koPay: koPay };
    }
    var ron = ceil100(base * (isDealer ? 6 : 4));
    return { total: ron, ron: ron };
  }

  function ceil100(n) { return Math.ceil(n / 100) * 100; }

  MJ.evaluate = evaluate;
  MJ.basePoints = basePoints;
  MJ.payments = payments;
  MJ.isMenzen = isMenzen;
  MJ.fullCounts = fullCounts;
})(typeof window !== 'undefined' ? window : globalThis);
