# 商人・預言者・指導者・ゴリラ — バランス確認用の簡易シミュレーション
# 得点になった札はゲームから抜ける。配れる枚数が5枚を切ったら終了。
# 使い方: python3 tools/sim_balance.py
import random, statistics as st
G=4
def role(p,t,off): return (p-t+off)%5
def game(rng,N,RANKS,HMAX,HMIN=5,TR=5,maxr=99):
    deck=[(s,r) for s in range(4) for r in range(1,RANKS+1)]
    score=[0]*N; rounds=0; gpts=0; tot=0
    while True:
        H=min(HMAX,len(deck)//N)
        if H<HMIN or rounds>=maxr: break
        rng.shuffle(deck); hands=[deck[i*H:(i+1)*H] for i in range(N)]; rest=deck[N*H:]
        lead=rounds%N; removed=[]
        for t in range(TR):
            roles=[role(p,t,rounds) for p in range(N)]
            trick=[];who=[]
            for k in range(N):
                p=(lead+k)%N;h=hands[p];r=roles[p]
                later={role(p,u,rounds) for u in range(t+1,TR)}
                def hold(c): return (c[1] if c[0] in later else 0)+(c[1]*0.5 if G in later else 0)
                def val(rr,tr): return sum(c[1] for c in tr) if rr==G else sum(c[1] for c in tr if c[0]==rr)
                if not trick:
                    own=[c for c in h if c[0]==r]
                    c=max(own,key=lambda c:c[1]) if own else (max(h,key=lambda c:c[1]) if r==G else min(h,key=lambda c:c[1]+hold(c)))
                else:
                    led=trick[0][0];fol=[c for c in h if c[0]==led];legal=fol or h
                    bi=max((i for i in range(len(trick)) if trick[i][0]==led),key=lambda i:trick[i][1])
                    wr=roles[who[bi]]
                    best=None
                    for c in legal:
                        win=c[0]==led and c[1]>trick[bi][1]
                        if win: s=val(r,trick+[c])+0.6*(val(wr,trick) if wr!=r else 0)-0.4*hold(c)
                        else:
                            feed=c[1] if (wr==G or c[0]==wr) else 0
                            s=-0.8*feed-0.4*hold(c)
                        if best is None or s>best[0]: best=(s,c)
                    c=best[1]
                h.remove(c);trick.append(c);who.append(p)
            led=trick[0][0]
            wi=max((i for i in range(N) if trick[i][0]==led),key=lambda i:trick[i][1]);w=who[wi];wr=roles[w]
            got=trick if wr==G else [c for c in trick if c[0]==wr]
            v=sum(c[1] for c in got);score[w]+=v;tot+=v
            if wr==G:gpts+=v
            removed+=got
        deck=[c for c in deck if c not in removed]
        rounds+=1
    return rounds,score,gpts,tot,len(deck)
for RANKS in [10,13]:
  for N in [2,3,4,5]:
    rng=random.Random(3);R=[];GP=0;T=0;left=[];sp=[]
    for i in range(3000):
        r,s,g,t,l=game(rng,N,RANKS,8);R.append(r);GP+=g;T+=t;left.append(l);sp.append(max(s)-min(s))
    print(f"{RANKS*4}枚 N={N}: 局数 平均{st.mean(R):.1f} (最小{min(R)} 最大{max(R)}) 残り札{st.mean(left):.1f} ゴリラ点比率{GP/T:.0%} 1人合計{T/3000/N:.0f}")
