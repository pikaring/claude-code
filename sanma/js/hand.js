/*
 * hand.js - シャンテン数・和了判定・待ち・受け入れ計算
 *
 * すべて 34 要素のカウント配列（counts）を入力に取る。
 * melds は「副露済みの面子数」（0-4）。
 */
(function (global) {
  'use strict';

  var MJ = global.MJ;
  var KINDS = MJ.KINDS;

  /* --- 一般形のシャンテン数 --------------------------------------------
   * 色ごとに「面子・搭子・対子の取り方」を全列挙してから合成する。
   * 色単位の結果は牌姿をキーにキャッシュされるので、
   * 打牌候補ごとに何度呼んでも実用上のコストはほぼ無い。
   *
   *   シャンテン = 8 - 2*面子 - (搭子+雀頭)   ブロック数は 5 が上限
   *   （雀頭が無い状態で 5 ブロックなら +1）
   * ------------------------------------------------------------------ */

  var MAX_SETS = 5;       // 面子 0-4
  var MAX_PARTS = 6;      // 搭子 0-5
  var OPT_SIZE = MAX_SETS * MAX_PARTS * 2;
  var suitCache = Object.create(null);

  function optIndex(sets, partials, hasPair) {
    return (sets * MAX_PARTS + partials) * 2 + hasPair;
  }

  /** 1 色分の取り方を列挙して 60 要素のビット表に詰める */
  function suitOptions(counts, base, len, isHonor) {
    var key = '';
    for (var k = 0; k < len; k++) key += counts[base + k];
    key += isHonor ? 'z' : 'n';
    var cached = suitCache[key];
    if (cached) return cached;

    var c = counts.slice(base, base + len);
    var table = new Uint8Array(OPT_SIZE);

    function record(sets, partials, pairs) {
      // 対子も「雀頭候補のブロック」として搭子と同じ枠で数え、
      // 雀頭が取れるかどうかだけを別フラグで持つ
      var s = Math.min(4, sets);
      var p = Math.min(MAX_PARTS - 1, partials + pairs);
      table[optIndex(s, p, pairs > 0 ? 1 : 0)] = 1;
    }

    function rec(i, sets, partials, pairs) {
      while (i < len && c[i] <= 0) i++;
      if (i >= len) { record(sets, partials, pairs); return; }
      if (sets + partials + pairs >= 5) { record(sets, partials, pairs); return; }

      if (c[i] >= 3) { c[i] -= 3; rec(i, sets + 1, partials, pairs); c[i] += 3; }
      if (!isHonor && i <= len - 3 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        rec(i, sets + 1, partials, pairs);
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
      if (c[i] >= 2) { c[i] -= 2; rec(i, sets, partials, pairs + 1); c[i] += 2; }
      if (!isHonor && i <= len - 2 && c[i + 1] > 0) {
        c[i]--; c[i + 1]--; rec(i, sets, partials + 1, pairs); c[i]++; c[i + 1]++;
      }
      if (!isHonor && i <= len - 3 && c[i + 2] > 0) {
        c[i]--; c[i + 2]--; rec(i, sets, partials + 1, pairs); c[i]++; c[i + 2]++;
      }
      c[i]--; rec(i, sets, partials, pairs); c[i]++;
    }

    rec(0, 0, 0, 0);

    // 実際に使う組み合わせだけを配列に落としておく
    var list = [];
    for (var idx = 0; idx < OPT_SIZE; idx++) {
      if (!table[idx]) continue;
      var pr = idx % 2;
      var rest = (idx - pr) / 2;
      list.push([Math.floor(rest / MAX_PARTS), rest % MAX_PARTS, pr]);
    }
    suitCache[key] = list;
    return list;
  }

  function mergeOptions(a, b) {
    var table = new Uint8Array(OPT_SIZE);
    var list = [];
    for (var i = 0; i < a.length; i++) {
      for (var j = 0; j < b.length; j++) {
        var sets = Math.min(4, a[i][0] + b[j][0]);
        var hasPair = (a[i][2] || b[j][2]) ? 1 : 0;
        var parts = Math.min(MAX_PARTS - 1, a[i][1] + b[j][1]);
        var idx = optIndex(sets, parts, hasPair);
        if (table[idx]) continue;
        table[idx] = 1;
        list.push([sets, parts, hasPair]);
      }
    }
    return list;
  }

  function shantenStandard(counts, melds) {
    melds = melds || 0;
    var opts = suitOptions(counts, 0, 9, false);
    opts = mergeOptions(opts, suitOptions(counts, 9, 9, false));
    opts = mergeOptions(opts, suitOptions(counts, 18, 9, false));
    opts = mergeOptions(opts, suitOptions(counts, 27, 7, true));

    var best = 8;
    for (var i = 0; i < opts.length; i++) {
      var s = Math.min(4, opts[i][0] + melds);
      var p = Math.min(opts[i][1], 5 - s);
      var sh = 8 - 2 * s - p;
      if (!opts[i][2] && s + p === 5) sh += 1;
      if (sh < best) best = sh;
    }
    return best;
  }

  /** 七対子のシャンテン数（門前限定） */
  function shantenChiitoi(counts) {
    var pairs = 0, kinds = 0;
    for (var i = 0; i < 34; i++) {
      if (counts[i] > 0) kinds++;
      if (counts[i] >= 2) pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  /** 国士無双のシャンテン数（門前限定） */
  function shantenKokushi(counts) {
    var kinds = 0, hasPair = false;
    for (var k = 0; k < KINDS.length; k++) {
      var t = KINDS[k];
      if (!MJ.isYaochu(t)) continue;
      if (counts[t] > 0) kinds++;
      if (counts[t] >= 2) hasPair = true;
    }
    return 13 - kinds - (hasPair ? 1 : 0);
  }

  /** 総合シャンテン数（-1 = 和了） */
  function shanten(counts, melds) {
    melds = melds || 0;
    var best = shantenStandard(counts, melds);
    if (melds === 0) {
      best = Math.min(best, shantenChiitoi(counts), shantenKokushi(counts));
    }
    return best;
  }

  /* --- 和了判定 -------------------------------------------------------- */

  /** 一般形（面子手）で和了しているか */
  function isCompleteStandard(counts, melds) {
    return decompose(counts).length > 0 && countTiles(counts) === (4 - (melds || 0)) * 3 + 2;
  }

  function countTiles(counts) {
    var n = 0;
    for (var i = 0; i < 34; i++) n += counts[i];
    return n;
  }

  function isChiitoi(counts) {
    var pairs = 0;
    for (var i = 0; i < 34; i++) {
      if (counts[i] === 0) continue;
      if (counts[i] !== 2) return false;
      pairs++;
    }
    return pairs === 7;
  }

  function isKokushi(counts) {
    var kinds = 0, pair = 0, total = 0;
    for (var i = 0; i < 34; i++) {
      if (counts[i] === 0) continue;
      if (!MJ.isYaochu(i)) return false;
      kinds++; total += counts[i];
      if (counts[i] === 2) pair++;
      else if (counts[i] !== 1) return false;
    }
    return kinds === 13 && pair === 1 && total === 14;
  }

  function isAgari(counts, melds) {
    melds = melds || 0;
    if (melds === 0 && (isChiitoi(counts) || isKokushi(counts))) return true;
    return decompose(counts).length > 0;
  }

  /* --- 面子分解（点数計算用） ------------------------------------------
   * 返り値: [{ sets: [{type:'run'|'triplet', tile}], pair: tileId }, ...]
   * 手牌（副露を除く）がちょうど n*3+2 枚のときのみ分解が成立する。
   * ------------------------------------------------------------------ */
  function decompose(counts) {
    var c = counts.slice();
    var results = [];
    var sets = [];

    function rec(i, pair) {
      while (i < 34 && c[i] <= 0) i++;
      if (i >= 34) {
        if (pair >= 0) results.push({ sets: sets.slice(), pair: pair });
        return;
      }
      var num = i < 27 ? i % 9 : -1;
      if (pair < 0 && c[i] >= 2) {
        c[i] -= 2; rec(i, i); c[i] += 2;
      }
      if (c[i] >= 3) {
        c[i] -= 3; sets.push({ type: 'triplet', tile: i }); rec(i, pair); sets.pop(); c[i] += 3;
      }
      if (num >= 0 && num <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        sets.push({ type: 'run', tile: i }); rec(i, pair); sets.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }

    var total = countTiles(counts);
    if (total % 3 !== 2) return [];
    rec(0, -1);
    return results;
  }

  /* --- 待ち・受け入れ -------------------------------------------------- */

  /** テンパイ時の和了牌一覧（counts は 13 枚相当、melds は副露面子数） */
  function waits(counts, melds) {
    var out = [];
    for (var k = 0; k < KINDS.length; k++) {
      var t = KINDS[k];
      if (counts[t] >= 4) continue;
      counts[t]++;
      if (isAgari(counts, melds)) out.push(t);
      counts[t]--;
    }
    return out;
  }

  function isTenpai(counts, melds) {
    return shanten(counts, melds) === 0;
  }

  /** シャンテン数が進む牌の一覧 */
  function ukeire(counts, melds) {
    var cur = shanten(counts, melds);
    var out = [];
    for (var k = 0; k < KINDS.length; k++) {
      var t = KINDS[k];
      if (counts[t] >= 4) continue;
      counts[t]++;
      if (shanten(counts, melds) < cur) out.push(t);
      counts[t]--;
    }
    return out;
  }

  MJ.shanten = shanten;
  MJ.shantenStandard = shantenStandard;
  MJ.shantenChiitoi = shantenChiitoi;
  MJ.shantenKokushi = shantenKokushi;
  MJ.isAgari = isAgari;
  MJ.isChiitoi = isChiitoi;
  MJ.isKokushi = isKokushi;
  MJ.isCompleteStandard = isCompleteStandard;
  MJ.decompose = decompose;
  MJ.waits = waits;
  MJ.isTenpai = isTenpai;
  MJ.ukeire = ukeire;
  MJ.countTiles = countTiles;
})(typeof window !== 'undefined' ? window : globalThis);
