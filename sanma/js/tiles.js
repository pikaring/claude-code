/*
 * tiles.js - 牌の定義とユーティリティ
 *
 * 牌は 0-33 の整数 ID で表す（標準的な 34 種インデックス）。
 *   0- 8 : 一萬〜九萬
 *   9-17 : 一筒〜九筒
 *  18-26 : 一索〜九索
 *  27-33 : 東 南 西 北 白 發 中
 *
 * 三人麻雀では二萬〜八萬（ID 1-7）を使わないため、使用する種類は 27 種 108 枚。
 */
(function (global) {
  'use strict';

  var MJ = global.MJ || (global.MJ = {});

  var MAN = 0, PIN = 1, SOU = 2, HONOR = 3;

  // 三麻で使用する牌種（萬子は 1 と 9 のみ）
  var KINDS = [];
  KINDS.push(0, 8);
  for (var i = 9; i <= 26; i++) KINDS.push(i);
  for (var j = 27; j <= 33; j++) KINDS.push(j);

  var KIND_SET = {};
  KINDS.forEach(function (t) { KIND_SET[t] = true; });

  var HONOR_LABEL = ['東', '南', '西', '北', '白', '發', '中'];
  var SUIT_LABEL = ['萬', '筒', '索'];
  var NUM_LABEL = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function suitOf(t) { return t >= 27 ? HONOR : Math.floor(t / 9); }
  function numOf(t) { return t >= 27 ? t - 26 : (t % 9) + 1; }
  function isHonor(t) { return t >= 27; }
  function isWind(t) { return t >= 27 && t <= 30; }
  function isDragon(t) { return t >= 31 && t <= 33; }
  function isTerminal(t) { return t < 27 && (t % 9 === 0 || t % 9 === 8); }
  function isYaochu(t) { return isHonor(t) || isTerminal(t); }
  function isSimple(t) { return !isYaochu(t); }
  function isUsed(t) { return KIND_SET[t] === true; }

  /** 「1p」形式の短縮表記 */
  function tileCode(t) {
    if (isHonor(t)) return (t - 26) + 'z';
    return numOf(t) + ['m', 'p', 's'][suitOf(t)];
  }

  /** 「一筒」形式の日本語表記 */
  function tileName(t) {
    if (isHonor(t)) return HONOR_LABEL[t - 27];
    return NUM_LABEL[numOf(t) - 1] + SUIT_LABEL[suitOf(t)];
  }

  /** ドラ表示牌 -> ドラ。三麻では萬子は 1 <-> 9 で循環する。 */
  function doraFromIndicator(t) {
    if (t === 0) return 8;
    if (t === 8) return 0;
    if (t < 27) {
      var base = Math.floor(t / 9) * 9;
      return base + ((t - base + 1) % 9);
    }
    if (t <= 30) return 27 + ((t - 27 + 1) % 4); // 東南西北
    return 31 + ((t - 31 + 1) % 3);              // 白發中
  }

  /* ---- 牌インスタンス ---------------------------------------------------
   * 赤ドラを区別する必要があるので、山や手牌では {t, red, uid} を扱う。
   * 点数計算やシャンテン計算は t だけを見る。
   * -------------------------------------------------------------------- */
  var uidSeq = 0;

  function makeTile(t, red) {
    return { t: t, red: !!red, uid: ++uidSeq };
  }

  /** 108 枚の山を作る（赤五筒・赤五索を各 1 枚） */
  function buildWall(rng) {
    var wall = [];
    KINDS.forEach(function (t) {
      for (var n = 0; n < 4; n++) {
        var red = (n === 0) && (t === 13 || t === 22); // 5p / 5s の 1 枚目を赤に
        wall.push(makeTile(t, red));
      }
    });
    shuffle(wall, rng);
    return wall;
  }

  function shuffle(arr, rng) {
    var rand = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /** 再現性のある乱数（テスト用にシードを固定できる） */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 牌配列 -> 34 要素のカウント配列 */
  function toCounts(tiles) {
    var c = new Array(34);
    for (var i = 0; i < 34; i++) c[i] = 0;
    for (var k = 0; k < tiles.length; k++) {
      c[typeof tiles[k] === 'number' ? tiles[k] : tiles[k].t]++;
    }
    return c;
  }

  /** 手牌のソート順（萬 -> 筒 -> 索 -> 字、赤は同じ数字の中で先） */
  function sortTiles(tiles) {
    tiles.sort(function (a, b) {
      if (a.t !== b.t) return a.t - b.t;
      return (b.red ? 1 : 0) - (a.red ? 1 : 0);
    });
    return tiles;
  }

  /** 「123p 55s 東東」のような文字列から牌 ID 配列を作る（テスト・デバッグ用） */
  function parse(str) {
    var out = [], buf = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch >= '1' && ch <= '9') { buf.push(+ch); continue; }
      var suit = 'mpsz'.indexOf(ch);
      if (suit < 0) { buf = buf.length ? buf : []; continue; }
      for (var k = 0; k < buf.length; k++) {
        out.push(suit === 3 ? 26 + buf[k] : suit * 9 + buf[k] - 1);
      }
      buf = [];
    }
    return out;
  }

  MJ.MAN = MAN; MJ.PIN = PIN; MJ.SOU = SOU; MJ.HONOR = HONOR;
  MJ.KINDS = KINDS;
  MJ.HONOR_LABEL = HONOR_LABEL;
  MJ.SUIT_LABEL = SUIT_LABEL;
  MJ.NUM_LABEL = NUM_LABEL;
  MJ.suitOf = suitOf;
  MJ.numOf = numOf;
  MJ.isHonor = isHonor;
  MJ.isWind = isWind;
  MJ.isDragon = isDragon;
  MJ.isTerminal = isTerminal;
  MJ.isYaochu = isYaochu;
  MJ.isSimple = isSimple;
  MJ.isUsed = isUsed;
  MJ.tileCode = tileCode;
  MJ.tileName = tileName;
  MJ.doraFromIndicator = doraFromIndicator;
  MJ.makeTile = makeTile;
  MJ.buildWall = buildWall;
  MJ.shuffle = shuffle;
  MJ.mulberry32 = mulberry32;
  MJ.toCounts = toCounts;
  MJ.sortTiles = sortTiles;
  MJ.parse = parse;
})(typeof window !== 'undefined' ? window : globalThis);
