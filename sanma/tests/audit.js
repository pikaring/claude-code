/*
 * CPU がイカサマしていないかの監査。
 * AI の思考関数を呼んでいる間だけ
 *   - 他家の手牌 (hand / drawn)
 *   - 山・王牌の中身（length 以外）
 *   - 裏ドラ
 * にアクセスしたら例外を投げるようにして対局を回す。
 * 1 度でも触っていれば violations に記録される。
 *
 *   node tests/audit.js [局数]
 */
const path = require('path');
const base = path.join(__dirname, '..', 'js');
['tiles','hand','yaku','ai','game'].forEach(f => require(path.join(base, f + '.js')));
const MJ = globalThis.MJ;

const violations = [];

function guardWall(arr, label){
  return new Proxy(arr, {
    get(t, k){
      if (typeof k === 'string' && /^\d+$/.test(k)) {
        violations.push(label + '[' + k + '] を覗いた');
      }
      if (k === 'pop' || k === 'shift' || k === 'splice') {
        violations.push(label + '.' + k + '() を呼んだ');
      }
      return t[k];
    }
  });
}

function guardPlayer(p){
  return new Proxy(p, {
    get(t, k){
      if (k === 'hand' || k === 'drawn') violations.push('席' + t.seat + ' の ' + k + ' を覗いた');
      return t[k];
    }
  });
}

['chooseDiscard','shouldRiichi','shouldPon','shouldMinkan','shouldKanSelf','shouldKita','unseenCounts']
.forEach(name => {
  const orig = MJ.ai[name];
  MJ.ai[name] = function(game, me){
    const args = Array.prototype.slice.call(arguments);
    const realPlayers = game.players, realWall = game.wall, realDead = game.deadWall;
    const realUra = game.uraIndicatorsFor, realUraTiles = game.uraTiles;
    game.players = realPlayers.map(p => (me && p.seat === me.seat) ? p : guardPlayer(p));
    game.wall = guardWall(realWall, '山');
    game.deadWall = guardWall(realDead, '王牌');
    game.uraIndicatorsFor = function(){ violations.push('裏ドラを見た'); return realUra.apply(this, arguments); };
    game.uraTiles = function(){ violations.push('裏ドラを見た'); return realUraTiles.apply(this, arguments); };
    try { return orig.apply(this, args); }
    finally {
      game.players = realPlayers; game.wall = realWall; game.deadWall = realDead;
      game.uraIndicatorsFor = realUra; game.uraTiles = realUraTiles;
    }
  };
});

// 席ごとの成績も数える（3人とも同じ AI なので偏らないはず）
const wins = [0,0,0], deals = [0,0,0], finalPts = [0,0,0];
let hands = 0, games = 0, aiCalls = 0;
const origChoose = MJ.ai.chooseDiscard;
MJ.ai.chooseDiscard = function(){ aiCalls++; return origChoose.apply(this, arguments); };

const TARGET = parseInt(process.argv[2] || '300', 10);
let seed = 1;

function runGame(done){
  const g = new MJ.Game({ speed: 0, seed: seed++, onEvent: (type, data) => {
    if (type === 'result') {
      hands++;
      if (data.type === 'tsumo' || data.type === 'ron') {
        wins[data.winner]++;
        if (data.type === 'ron') deals[data.from]++;
      }
      setImmediate(() => g.nextHand());
    }
    if (type === 'gameOver') { games++; g.players.forEach((p,i)=>finalPts[i]+=p.points); done(); }
  }});
  g.players.forEach(p => p.isAI = true);
  g.startGame();
}

function loop(){
  if (hands >= TARGET) { report(); return; }
  runGame(() => setImmediate(loop));
}
function report(){
  console.log('局数:', hands, '/ 半荘:', games, '/ AI 打牌判断:', aiCalls);
  console.log('席別 和了数 :', wins.map((w,i)=>'席'+i+' '+w+' ('+(100*w/hands).toFixed(1)+'%)').join('  '));
  console.log('席別 放銃数 :', deals.map((d,i)=>'席'+i+' '+d).join('  '));
  console.log('席別 平均点 :', finalPts.map((p,i)=>'席'+i+' '+Math.round(p/games)).join('  '));
  console.log('');
  console.log(violations.length === 0
    ? '✅ 覗き見なし: 他家の手牌・山・王牌・裏ドラへのアクセスは 0 件'
    : '❌ 違反 ' + violations.length + ' 件: ' + [...new Set(violations)].slice(0,5).join(', '));
}
process.on('uncaughtException', e => { console.error('EXCEPTION', e); process.exit(1); });
loop();
