/*
 * tests.js - ルール・点数計算の自己テスト
 * ブラウザでは tests/test.html を開く。Node では `node tests/run.js`。
 */
(function (global) {
  'use strict';
  var MJ = global.MJ;
  var results = [];

  function ok(name, cond, extra) {
    results.push({ name: name, pass: !!cond, extra: extra || '' });
  }
  function eq(name, actual, expected) {
    ok(name, actual === expected, 'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
  }
  function C(str) { return MJ.toCounts(MJ.parse(str)); }
  function T(str) { return MJ.parse(str)[0]; }

  /* --- 牌 --- */
  eq('使用牌は27種', MJ.KINDS.length, 27);
  eq('山は108枚', MJ.buildWall(MJ.mulberry32(1)).length, 108);
  eq('赤ドラは2枚', MJ.buildWall(MJ.mulberry32(2)).filter(function (t) { return t.red; }).length, 2);
  eq('1m の表記', MJ.tileName(T('1m')), '一萬');
  eq('中 の表記', MJ.tileName(T('7z')), '中');
  eq('ドラ表示 1m -> 9m', MJ.doraFromIndicator(T('1m')), T('9m'));
  eq('ドラ表示 9m -> 1m', MJ.doraFromIndicator(T('9m')), T('1m'));
  eq('ドラ表示 9p -> 1p', MJ.doraFromIndicator(T('9p')), T('1p'));
  eq('ドラ表示 北 -> 東', MJ.doraFromIndicator(T('4z')), T('1z'));
  eq('ドラ表示 中 -> 白', MJ.doraFromIndicator(T('7z')), T('5z'));

  /* --- シャンテン --- */
  eq('和了形は -1', MJ.shanten(C('123456789p111s99m'), 0), -1);
  eq('テンパイは 0', MJ.shanten(C('123456789p11s99m'), 0), 0);
  eq('七対子テンパイ', MJ.shanten(C('1133557799p113s'), 0), 0);
  eq('国士テンパイ', MJ.shanten(C('19m19p19s1234567z'), 0), 0);
  eq('国士13面は和了', MJ.isAgari(C('19m19p19s12345677z'), 0), true);
  eq('七対子は和了', MJ.isAgari(C('1133557799p1133s'), 0), true);
  eq('同種4枚は七対子にならない', MJ.isChiitoi(C('1111335577p1133s')), false);
  eq('3副露でテンパイ', MJ.shanten(C('123p5s'), 3), 0);
  eq('3副露で和了形', MJ.shanten(C('123p55s'), 3), -1);
  eq('バラバラ手のシャンテン', MJ.shanten(C('1m9m147p258s1234z'), 0) > 3, true);
  eq('待ちは2種', MJ.waits(C('123456789p11s99m'), 0).length, 2);
  eq('単騎待ち', MJ.waits(C('111p999p111s999s1z'), 0).join(), String(T('1z')));

  /* --- 役 --- */
  function ev(o) {
    return MJ.evaluate({
      concealed: C(o.hand), melds: o.melds || [], winTile: T(o.win),
      isTsumo: !!o.tsumo, isRiichi: !!o.riichi, isIppatsu: !!o.ippatsu,
      seatWind: o.seat == null ? T('1z') : T(o.seat),
      roundWind: T('1z'),
      doraIndicators: (o.dora || []).map(T), redCount: o.red || 0,
      kitaCount: o.kita || 0
    });
  }
  function hasYaku(r, name) {
    return r.yaku.some(function (y) { return y.name === name; });
  }

  var r;
  r = ev({ hand: '234567p234s678s55p', win: '4s' });
  ok('平和が成立', hasYaku(r, '平和'));
  ok('断幺九が成立', hasYaku(r, '断幺九'));
  eq('平和ロンは30符', r.fu, 30);

  r = ev({ hand: '234567p234s678s55p', win: '4s', tsumo: true });
  eq('平和ツモは20符', r.fu, 20);
  ok('門前清自摸和', hasYaku(r, '門前清自摸和'));

  r = ev({ hand: '1133557799p1133s', win: '3s', riichi: true, tsumo: true });
  eq('七対子は25符', r.fu, 25);
  eq('立直+七対子+ツモ = 4翻', r.han, 4);

  r = ev({ hand: '111p999p111s999s11z', win: '1z', tsumo: true });
  ok('四暗刻単騎はダブル役満', r.yakumanCount === 2, JSON.stringify(r.yaku));
  eq('ダブル役満は16000', r.base, 16000);

  r = ev({ hand: '19m19p19s12345677z', win: '7z' });
  ok('国士無双', hasYaku(r, '国士無双') || hasYaku(r, '国士無双十三面'));

  r = ev({ hand: '119m19p19s1234567z', win: '1m' });
  ok('国士十三面待ち', hasYaku(r, '国士無双十三面'), JSON.stringify(r.yaku));

  r = ev({ hand: '555666777p99p123s', win: '3s' });
  ok('三暗刻', hasYaku(r, '三暗刻'), JSON.stringify(r.yaku));

  r = ev({ hand: '11122233355p999p', win: '5p' });
  ok('四暗刻(清一色との複合は役満優先)', r.yakumanCount === 2, JSON.stringify(r.yaku));

  r = ev({ hand: '123456789p234p55p', win: '4p' });
  ok('清一色', hasYaku(r, '清一色'), JSON.stringify(r.yaku));

  r = ev({ hand: '123456789p123s11z', win: '9p' });
  ok('一気通貫', hasYaku(r, '一気通貫'), JSON.stringify(r.yaku));

  r = ev({ hand: '123789p123789s11z', win: '9s' });
  ok('混全帯幺九', hasYaku(r, '混全帯幺九'), JSON.stringify(r.yaku));

  r = ev({ hand: '123789p123789s11p', win: '9s' });
  ok('純全帯幺九', hasYaku(r, '純全帯幺九'), JSON.stringify(r.yaku));

  r = ev({ hand: '555666777z11p99p', win: '9p' });
  ok('大三元', hasYaku(r, '大三元'), JSON.stringify(r.yaku));

  r = ev({ hand: '111222333z44z55z', win: '5z' });
  ok('字一色', hasYaku(r, '字一色'), JSON.stringify(r.yaku));

  r = ev({ hand: '11m99m111p999p99s', win: '9s' });
  ok('清老頭', hasYaku(r, '清老頭'), JSON.stringify(r.yaku));

  r = ev({ hand: '234234p666s789s99s', win: '9s' });
  ok('一盃口', hasYaku(r, '一盃口'), JSON.stringify(r.yaku));

  r = ev({ hand: '223344p556677s11p', win: '1p' });
  ok('二盃口', hasYaku(r, '二盃口'), JSON.stringify(r.yaku));

  r = ev({ hand: '111p22p', win: '2p', melds: [{ type: 'pon', tile: T('5z') }, { type: 'pon', tile: T('3p') }, { type: 'pon', tile: T('4p') }] });
  ok('副露の役牌 白', hasYaku(r, '役牌 白'), JSON.stringify(r.yaku));
  ok('対々和', hasYaku(r, '対々和'), JSON.stringify(r.yaku));

  r = ev({ hand: '234567p234s678s55p', win: '4s', kita: 2 });
  ok('抜きドラが翻に乗る', hasYaku(r, '抜きドラ'), JSON.stringify(r.yaku));
  eq('抜きドラ2枚で2翻増える', r.han, 4);

  r = ev({ hand: '123567p234678s44z', win: '2p', kita: 4 });
  eq('抜きドラだけでは和了できない', r.valid, false);

  r = ev({ hand: '234567p234s678s55p', win: '4s', dora: ['1p'], red: 1 });
  ok('ドラが乗る', hasYaku(r, 'ドラ'), JSON.stringify(r.yaku));
  ok('赤ドラが乗る', hasYaku(r, '赤ドラ'), JSON.stringify(r.yaku));

  // 役なし（嵌張待ち・北の雀頭・一九牌入り）は和了できない
  r = ev({ hand: '123567p234678s44z', win: '2p' });
  eq('役なしは和了不可', r.valid, false);
  r = ev({ hand: '123567p234678s44z', win: '2p', riichi: true });
  eq('リーチをかければ和了できる', r.valid, true);

  /* --- 点数 --- */
  eq('30符4翻は7700(子ロン)', MJ.payments(MJ.basePoints(4, 30, 0), false, false).ron, 7700);
  eq('30符4翻は11600(親ロン)', MJ.payments(MJ.basePoints(4, 30, 0), true, false).ron, 11600);
  eq('満貫は8000(子ロン)', MJ.payments(MJ.basePoints(5, 30, 0), false, false).ron, 8000);
  eq('満貫は12000(親ロン)', MJ.payments(MJ.basePoints(5, 30, 0), true, false).ron, 12000);
  eq('跳満は12000(子ロン)', MJ.payments(MJ.basePoints(6, 30, 0), false, false).ron, 12000);
  eq('役満は32000(子ロン)', MJ.payments(MJ.basePoints(0, 0, 1), false, false).ron, 32000);
  var t = MJ.payments(MJ.basePoints(5, 30, 0), false, true);
  eq('子の満貫ツモは親4000', t.dealerPay, 4000);
  eq('子の満貫ツモは子2000', t.koPay, 2000);
  eq('子の満貫ツモ合計は6000(ツモ損)', t.total, 6000);
  var t2 = MJ.payments(MJ.basePoints(5, 30, 0), true, true);
  eq('親の満貫ツモは各4000', t2.each, 4000);
  eq('親の満貫ツモ合計は8000(ツモ損)', t2.total, 8000);

  /* --- 結果出力 --- */
  var passed = results.filter(function (x) { return x.pass; }).length;
  var out = { passed: passed, total: results.length, results: results };
  if (typeof document !== 'undefined') {
    document.getElementById('summary').textContent =
      passed + ' / ' + results.length + ' 件成功' + (passed === results.length ? ' ✅' : ' ❌');
    document.getElementById('summary').className = passed === results.length ? 'pass' : 'fail';
    document.getElementById('list').innerHTML = results.map(function (x) {
      return '<div class="' + (x.pass ? 'pass' : 'fail') + '">' +
        (x.pass ? '✔' : '✘') + ' ' + x.name +
        (x.pass ? '' : '<span class="ex"> — ' + x.extra + '</span>') + '</div>';
    }).join('');
  }
  global.MJ_TEST_RESULT = out;
})(typeof window !== 'undefined' ? window : globalThis);
