# 商人・預言者・指導者・ゴリラ — バランス確認用の簡易シミュレーション（v0.4）
# 得点になった札はゲームから抜ける。5局固定。5枚配れない局は配れた枚数だけトリックをする。
# 能力: 商人=仲買 / 預言者=預言（自分も指名可）/ 指導者=動員 / 王=徴税 / ゴリラ=なし
# 使い方: python3 tools/sim_balance.py
import random, statistics as st, sys
M,P,L,K,G=0,1,2,3,4   # 商人 預言者 指導者 王 ゴリラ ; suits 0-3 = roles 0-3
def role(p,t,off): return (p-t+off)%5
PN=1
def game(rng,N,RANKS,HMAX=8,ROUNDS=5,abil=True):
    deck=[(s,r) for s in range(4) for r in range(1,RANKS+1)]
    score=[0]*N; byrole=[0]*5; rounds=0; short=False
    while True:
        H=min(HMAX,len(deck)//N)
        if rounds>=ROUNDS or H==0: break
        TR=min(5,H)   # 5枚配れないときは、配れた枚数だけトリックをする
        short=short or H<5
        rng.shuffle(deck); hands=[deck[i*H:(i+1)*H] for i in range(N)]
        lead=rounds%N; removed=[]
        for t in range(TR):
            roles=[role(p,t,rounds) for p in range(N)]
            holder={roles[p]:p for p in range(N)}
            order=[(lead+k)%N for k in range(N)]
            if False:   # 王は最後に出す（リードでない限り）
                order.remove(holder[K]); order.append(holder[K])
            # 預言者: 予言（ゴリラがいればゴリラ、いなければリードする人）
            pred=None
            if abil and P in holder:
                pp=holder[P]; strong=max(c[1] for c in hands[pp])>=RANKS-3
                pred=pp if strong else holder.get(G,order[0])
            trick=[];who=[]
            def eff(i,led):  # 実効的にリードスートとして勝負できるか
                c=trick[i];p=who[i]
                return c[0]==led or (abil and roles[p]==L and c[0]==L)
            def win_idx(led):
                return max((i for i in range(len(trick)) if eff(i,led)),key=lambda i:trick[i][1])
            for p in order:
                h=hands[p];r=roles[p]
                later={role(p,u,rounds) for u in range(t+1,TR)}
                def hold(c): return (c[1] if c[0] in later else 0)+(c[1]*0.5 if G in later else 0)
                def val(rr,tr): return sum(c[1] for c in tr) if rr==G else sum(c[1] for c in tr if c[0]==rr)
                if not trick:
                    own=[c for c in h if c[0]==r]
                    c=max(own,key=lambda c:c[1]) if own else (max(h,key=lambda c:c[1]) if r==G else min(h,key=lambda c:c[1]+hold(c)))
                else:
                    led=trick[0][0];fol=[c for c in h if c[0]==led];legal=fol or h
                    if abil and r==L and fol: legal=fol+[c for c in h if c[0]==L and c not in fol]
                    bi=win_idx(led);wr=roles[who[bi]];best=None
                    for c in legal:
                        cand=(c[0]==led or (abil and r==L and c[0]==L)) and c[1]>trick[bi][1]
                        if cand: s=val(r,trick+[c])+0.6*(val(wr,trick) if wr!=r else 0)-0.4*hold(c)
                        else: s=-0.8*(c[1] if (wr==G or c[0]==wr) else 0)-0.4*hold(c)
                        if best is None or s>best[0]: best=(s,c)
                    c=best[1]
                h.remove(c);trick.append(c);who.append(p)
            led=trick[0][0];wi=win_idx(led);w=who[wi];wr=roles[w]
            got=list(trick) if wr==G else [c for c in trick if c[0]==wr]
            v=sum(c[1] for c in got);score[w]+=v;byrole[wr]+=v;removed+=got
            left=[c for c in trick if c not in got]
            if abil and wr==K and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[w]+=c[1];byrole[K]+=c[1]
            if abil and M in holder and holder[M]!=w:   # 商人: 仲買（残った貨幣の最小1枚）
                coins=[c for c in left if c[0]==M]
                if coins:
                    c=min(coins,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[M]]+=c[1];byrole[M]+=c[1]
            if abil and pred is not None and pred==w and left:  # 預言者: 的中なら残りから1枚
                for _ in range(PN):
                    if not left: break
                    c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[P]]+=c[1];byrole[P]+=c[1]
            lead=w
        deck=[c for c in deck if c not in removed];rounds+=1
    return short,score,byrole


RANGE={2:12,3:17,4:22,5:26}
if __name__=="__main__":
    for N,R in RANGE.items():
        rng=random.Random(5);SH=0;BR=[0]*5;TOT=[]
        for i in range(5000):
            sh,sc,b=game(rng,N,R);SH+=sh;BR=[x+y for x,y in zip(BR,b)];TOT+=sc
        T=sum(BR)
        print(f"N={N} 1-{R}({4*R}枚): 5局のうち5枚配れない局がある {SH/50:.2f}%  1人合計 平均{st.mean(TOT):.0f}  点の内訳 "+" ".join(f"{n}{x/T:.0%}" for n,x in zip("商預指王ゴ",BR)))
