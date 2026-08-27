/*
 * ai.js - CPU の思考ルーチン
 *
 * 方針（軽さ優先）:
 *   打牌   ... シャンテン数 -> 受け入れ枚数 -> 手役/ドラ価値 -> 危険度 の順で評価
 *   鳴き   ... シャンテンが進み、かつ役の見込みがある場合のみ
 *   リーチ ... 門前テンパイなら基本的に宣言（終盤の愚形は見送り）
 *
 * 難易度は game.difficulty（0=やさしい / 1=ふつう / 2=つよい）で切り替える。
 * 弱くするときも「和了を見逃す」ような不自然な弱さにはせず、
 * 読みの精度・降りの徹底・リーチ判断といった打ち手の腕にあたる部分を落とす。
 */
(function (global) {
  'use strict';

  var MJ = global.MJ;

  var LEVELS = [
    // useUnseen  : 受け入れを残り枚数で数えるか（false なら種類数だけ＝場を読まない）
    // doraWeight : ドラ・赤をどれだけ重く見るか
    // defendFrom : 他家リーチ時に何シャンテンからベタ降りするか
    // riichiMin  : 待ちが何枚以上ならリーチするか
    // slip/slipTop: この確率で最善手ではなく 2〜slipTop 番手の打牌を選ぶ
    // ponSkip    : 鳴ける場面を見送る確率
    { name: 'やさしい', useUnseen: false, doraWeight: 0, defendFrom: 99, riichiMin: 3, slip: 0.45, slipTop: 3, ponSkip: 0.35 },
    { name: 'ふつう', useUnseen: true, doraWeight: 6, defendFrom: 3, riichiMin: 2, slip: 0.20, slipTop: 2, ponSkip: 0.15 },
    { name: 'つよい', useUnseen: true, doraWeight: 12, defendFrom: 2, riichiMin: 1, slip: 0, slipTop: 1, ponSkip: 0 }
  ];

  function levelOf(game, me) {
    var d = me && me.difficulty != null ? me.difficulty : game.difficulty;
    return LEVELS[d == null ? 1 : Math.max(0, Math.min(2, d))];
  }

  function rand(game) { return (game.rng || Math.random)(); }

  /** 場に見えている牌から残り枚数を数える */
  function unseenCounts(game, me) {
    var c = new Array(34);
    for (var i = 0; i < 34; i++) c[i] = MJ.isUsed(i) ? 4 : 0;
    function sub(t) { if (c[t] > 0) c[t]--; }
    me.hand.forEach(function (t) { sub(t.t); });
    game.players.forEach(function (p) {
      p.discards.forEach(function (d) { sub(d.tile.t); });
      p.melds.forEach(function (m) {
        m.tiles.forEach(function (t) { sub(t.t); });
      });
      (p.kita || []).forEach(function (t) { sub(t.t); });
    });
    game.doraIndicators.forEach(sub);
    return c;
  }

  /** ドラ（赤含む）の枚数 */
  function doraValue(game, tiles) {
    var doras = game.doraIndicators.map(MJ.doraFromIndicator);
    var n = 0;
    tiles.forEach(function (t) {
      if (t.red) n++;
      if (doras.indexOf(t.t) >= 0) n++;
    });
    return n;
  }

  /** 手役の方向性からくる加点 */
  function shapeBonus(counts, seatWind, roundWind) {
    var bonus = 0;
    // 役牌の対子・刻子
    [31, 32, 33, seatWind, roundWind].forEach(function (t) {
      if (counts[t] >= 2) bonus += 6;
      if (counts[t] >= 3) bonus += 8;
    });
    // 染め手の傾向
    var suitCount = [0, 0, 0], honor = 0, total = 0;
    for (var i = 0; i < 34; i++) {
      if (counts[i] === 0) continue;
      total += counts[i];
      if (i >= 27) honor += counts[i];
      else suitCount[Math.floor(i / 9)] += counts[i];
    }
    var max = Math.max.apply(null, suitCount);
    if (total > 0 && (max + honor) / total >= 0.85) bonus += 10;
    return bonus;
  }

  /** リーチ者に対する危険度（0 が安全） */
  function danger(game, me, tile) {
    var risk = 0;
    game.players.forEach(function (p) {
      if (p.seat === me.seat || !p.riichi) return;
      // 現物なら安全
      var genbutsu = p.discards.some(function (d) { return d.tile.t === tile.t; });
      if (genbutsu) return;
      // リーチ後に他家が切って通っている牌も安全
      var passed = game.players.some(function (q) {
        return q !== p && q.discards.some(function (d) {
          return d.tile.t === tile.t && d.turn >= p.riichiTurn;
        });
      });
      if (passed) return;
      risk += MJ.isYaochu(tile.t) ? 6 : 10;
      if (MJ.isHonor(tile.t)) risk -= 3;
      var n = MJ.numOf(tile.t);
      if (!MJ.isHonor(tile.t) && n >= 4 && n <= 6) risk += 3; // 中張牌は危険
    });
    return risk;
  }

  /** 打牌選択: 手牌配列のインデックスを返す */
  function chooseDiscard(game, me) {
    var lv = levelOf(game, me);
    var meldCount = me.melds.length;
    var unseen = unseenCounts(game, me);
    var counts = MJ.toCounts(me.hand);
    var baseShanten = MJ.shanten(counts, meldCount);
    var riichiExists = game.players.some(function (p) { return p.seat !== me.seat && p.riichi; });
    var defensive = riichiExists && baseShanten >= lv.defendFrom;

    // 打牌候補ごとのシャンテン数を先に求め、最小の候補だけ受け入れを厳密に数える
    // （受け入れ計算はコストが高いため）
    var minShanten = 99, cand = [], seen = {};
    for (var i = 0; i < me.hand.length; i++) {
      var key = me.hand[i].t + (me.hand[i].red ? 'r' : '');
      if (seen[key]) continue;
      seen[key] = true;
      counts[me.hand[i].t]--;
      var sh0 = MJ.shanten(counts, meldCount);
      counts[me.hand[i].t]++;
      cand.push({ index: i, shanten: sh0 });
      if (sh0 < minShanten) minShanten = sh0;
    }

    var scored = [];
    for (var ci = 0; ci < cand.length; ci++) {
      var i = cand[ci].index;
      var tile = me.hand[i];
      var sh = cand[ci].shanten;

      counts[tile.t]--;
      var accept = 0;
      if (sh === minShanten || defensive) {
        MJ.ukeire(counts, meldCount).forEach(function (t) {
          accept += lv.useUnseen ? unseen[t] : 1;
        });
        if (!lv.useUnseen) accept *= 4; // 種類数しか見ないぶんの目安
      }
      var rest = me.hand.filter(function (_, k) { return k !== i; });
      var value = doraValue(game, rest) * lv.doraWeight + shapeBonus(counts, me.seatWind, game.roundWind);
      counts[tile.t]++;

      var score;
      if (defensive) {
        score = -danger(game, me, tile) * 20 + accept * 0.5 - sh * 30;
      } else {
        score = -sh * 1000 + accept * 8 + value - danger(game, me, tile) * 2;
        if (tile.red) score -= 40; // 赤は極力抱える
      }
      scored.push({ index: i, score: score });
    }

    if (!scored.length) return me.hand.length - 1;
    scored.sort(function (a, b) { return b.score - a.score; });
    // 難易度が低いほど、ときどき最善手ではなく次善手を選ぶ
    var pick = 0;
    if (lv.slip > 0 && scored.length > 1 && rand(game) < lv.slip) {
      var span = Math.min(lv.slipTop, scored.length) - 1;
      pick = 1 + Math.floor(rand(game) * span);
    }
    return scored[pick].index;
  }

  /** リーチ宣言するか */
  function shouldRiichi(game, me, discardIndex) {
    var lv = levelOf(game, me);
    if (game.wall.length < 4) return false;
    if (me.points < 1000) return false;
    var counts = MJ.toCounts(me.hand);
    counts[me.hand[discardIndex].t]--;
    var w = MJ.waits(counts, me.melds.length);
    if (w.length === 0) return false;
    var unseen = unseenCounts(game, me);
    var live = w.reduce(function (a, t) { return a + unseen[t]; }, 0);
    if (live < lv.riichiMin) return false;
    // 終盤の愚形かつ打点が無いときは見送る
    if (game.wall.length < 8 && live <= 2) return false;
    return true;
  }

  /** ポンするか */
  function shouldPon(game, me, tile) {
    var counts = MJ.toCounts(me.hand);
    if (counts[tile.t] < 2) return false;
    var before = MJ.shanten(counts, me.melds.length);
    counts[tile.t] -= 2;
    var after = MJ.shanten(counts, me.melds.length + 1);
    if (after > before) return false;
    if (after === before && after > 0) return false;

    // 役の見込み
    if (rand(game) < levelOf(game, me).ponSkip) return false;
    var isYakuhai = MJ.isDragon(tile.t) || tile.t === me.seatWind || tile.t === game.roundWind;
    if (isYakuhai) return true;
    if (me.riichi) return false;

    var all = MJ.toCounts(me.hand);
    all[tile.t] += 1;
    // 断幺九が見込めるか
    var tanyao = true;
    for (var i = 0; i < 34; i++) if (all[i] > 0 && MJ.isYaochu(i)) { tanyao = false; break; }
    // 既に役牌を持っているか
    var hasYakuhai = [31, 32, 33, me.seatWind, game.roundWind].some(function (t) {
      return MJ.toCounts(me.hand)[t] >= 2;
    });
    var suitCount = [0, 0, 0], honor = 0, total = 0;
    for (var j = 0; j < 34; j++) {
      if (all[j] === 0) continue;
      total += all[j];
      if (j >= 27) honor += all[j]; else suitCount[Math.floor(j / 9)] += all[j];
    }
    var flush = total > 0 && (Math.max.apply(null, suitCount) + honor) / total >= 0.8;

    if (!(tanyao || flush || hasYakuhai)) return false;
    return after <= 1;
  }

  /** 大明槓するか */
  function shouldMinkan(game, me, tile) {
    if (me.riichi) return false;
    var counts = MJ.toCounts(me.hand);
    if (counts[tile.t] < 3) return false;
    var isYakuhai = MJ.isDragon(tile.t) || tile.t === me.seatWind || tile.t === game.roundWind;
    var before = MJ.shanten(counts, me.melds.length);
    counts[tile.t] -= 3;
    var after = MJ.shanten(counts, me.melds.length + 1);
    if (after > before) return false;
    return isYakuhai || after <= 0;
  }

  /** 北を抜くか。基本は常に抜くが、国士無双が見えているときだけ手牌に残す */
  function shouldKita(game, me) {
    var counts = MJ.toCounts(me.hand);
    if (me.melds.length === 0 && MJ.shantenKokushi(counts) <= 3) return false;
    return true;
  }

  /** 暗槓・加槓するか */
  function shouldKanSelf(game, me, tile, type) {
    if (me.riichi) return false; // 待ちが変わる可能性を避けて見送る
    var counts = MJ.toCounts(me.hand);
    var before = MJ.shanten(counts, me.melds.length);
    if (type === 'ankan') {
      if (counts[tile] < 4) return false;
      counts[tile] -= 4;
      var after = MJ.shanten(counts, me.melds.length + 1);
      return after <= before;
    }
    return true; // 加槓はポン済みなので基本的に得
  }

  MJ.ai = {
    chooseDiscard: chooseDiscard,
    shouldRiichi: shouldRiichi,
    shouldPon: shouldPon,
    shouldMinkan: shouldMinkan,
    shouldKanSelf: shouldKanSelf,
    shouldKita: shouldKita,
    unseenCounts: unseenCounts,
    LEVELS: LEVELS,
    levelOf: levelOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
