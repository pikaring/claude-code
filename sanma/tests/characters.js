/*
 * characters.js - キャラクターごとの打ち筋を実測する
 *
 * 席0 に各キャラ、席1・2 にデジタルを置いて対局させ、
 * 和了率・放銃率・平均打点・リーチ率・副露率などを比べる。
 *
 *   node tests/characters.js [1キャラあたりの局数]
 */
const path = require('path');
const base = path.join(__dirname, '..', 'js');
['tiles','hand','yaku','ai','game'].forEach(f => require(path.join(base, f + '.js')));
const MJ = globalThis.MJ;

function measure(charIdx, targetHands){
  let hands=0, games=0, wins=0, deals=0, pts=0, hanSum=0, mangan=0, riichi=0, melded=0, folded=0, tenpaiAtDraw=0, draws=0;
  let seed = 500 + charIdx*4111;
  return new Promise(resolve => {
    function runGame(done){
      const g = new MJ.Game({speed:0, seed:seed++, difficulty:2, onEvent:(type,data)=>{
        if(type==='handStart'){
          // 局終了時に副露/リーチしていたか見るため、局頭でフラグを初期化
        }
        if(type==='result'){
          hands++;
          const me = g.players[0];
          if(me.riichi) riichi++;
          if(me.melds.length) melded++;
          if(data.type==='draw'){ draws++; if(data.tenpai[0]) tenpaiAtDraw++; }
          else {
            if(data.winner===0){ wins++; hanSum += data.result.base*4; if(data.result.base>=2000) mangan++; }
            if(data.type==='ron' && data.from===0) deals++;
          }
          setImmediate(()=>g.nextHand());
        }
        if(type==='gameOver'){ games++; pts += g.players[0].points; done(); }
      }});
      g.players.forEach(p=>p.isAI=true);
      g.assignCharacters = function(){
        this.players[0].character = charIdx;
        this.players[1].character = 0;
        this.players[2].character = 0;
        this.players.forEach(p=>{ p.name = MJ.ai.CHARACTERS[p.character].name; });
      };
      g.startGame();
    }
    (function loop(){
      if(hands>=targetHands){ resolve({hands,games,wins,deals,pts,hanSum,mangan,riichi,melded,draws,tenpaiAtDraw}); return; }
      runGame(()=>setImmediate(loop));
    })();
  });
}

const HANDS = parseInt(process.argv[2] || '600', 10);

(async () => {
  const pad = (s,n)=>String(s)+' '.repeat(Math.max(0,n-[...String(s)].reduce((a,c)=>a+(c.charCodeAt(0)>255?2:1),0)));
  console.log('席0 に各キャラ、席1・2 にデジタルを置いた結果（各' + HANDS + '局・難易度つよい）\n');
  console.log(pad('キャラ',10)+pad('和了率',8)+pad('放銃率',8)+pad('平均打点',10)+pad('満貫率',8)+pad('リーチ率',10)+pad('副露率',8)+pad('流局時テンパイ',16)+'平均最終点');
  for(let c=0;c<5;c++){
    const r = await measure(c, HANDS);
    const name = MJ.ai.CHARACTERS[c].name;
    console.log(
      pad(name,10) +
      pad((100*r.wins/r.hands).toFixed(1)+'%',8) +
      pad((100*r.deals/r.hands).toFixed(1)+'%',8) +
      pad(r.wins? Math.round(r.hanSum/r.wins) : '-',10) + pad(r.wins? (100*r.mangan/r.wins).toFixed(0)+'%' : '-',8) +
      pad((100*r.riichi/r.hands).toFixed(0)+'%',10) +
      pad((100*r.melded/r.hands).toFixed(0)+'%',8) +
      pad(r.draws? (100*r.tenpaiAtDraw/r.draws).toFixed(0)+'%' : '-',16) +
      Math.round(r.pts/r.games));
  }
})();
