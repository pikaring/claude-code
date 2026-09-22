# 商人・預言者・指導者・ゴリラ — バランス確認用の簡易シミュレーション
# mode: "sum" = ゴリラは取った札の数字合計 / 整数k = ゴリラは札1枚につきk点
# 使い方: python3 sim_balance.py
import random
S=4;R=10;HAND=8;TR=5;G=4  # roles 0-3 suits, 4 gorilla
def role(p,t): return (p-t)%5          # player p at trick t
def val(r,trick,mode):
    if r==G: return sum(c[1] for c in trick) if mode=='sum' else mode*len(trick)
    return sum(c[1] for c in trick if c[0]==r)
def future_need(p,t,hand):
    # suits I'll own in later tricks -> keep those cards
    return {role(p,u) for u in range(t+1,TR)}
def rnd(rng,N,mode,start):
    deck=[(s,r) for s in range(S) for r in range(1,R+1)];rng.shuffle(deck)
    hands=[deck[i*HAND:(i+1)*HAND] for i in range(N)]
    sc=[0]*N;gw=0;lead=start;gpts=0
    for t in range(TR):
        roles=[role(p,t) for p in range(N)]
        trick=[];who=[]
        for k in range(N):
            p=(lead+k)%N;h=hands[p];r=roles[p];keep=future_need(p,t,h)
            def hold(c): return (c[1] if c[0] in keep else 0)+(3 if G in keep and c[1]>=8 else 0)
            if not trick:
                own=[c for c in h if c[0]==r]
                c=max(own,key=lambda c:c[1]) if own else (max(h,key=lambda c:c[1]) if r==G else min(h,key=lambda c:c[1]+hold(c)))
            else:
                led=trick[0][0];fol=[c for c in h if c[0]==led];legal=fol or h
                bi=max((i for i in range(len(trick)) if trick[i][0]==led),key=lambda i:trick[i][1])
                wr=roles[who[bi]]
                wins=[c for c in fol if c[1]>trick[bi][1]]
                def gain(c): return val(r,trick+[c],mode)
                deny=lambda c: (val(wr,trick,mode) if wr!=r else 0)
                opts=[]
                for c in legal:
                    if c in wins: s=gain(c)+0.5*deny(c)-0.4*hold(c)
                    else:
                        feed=(c[1] if (wr==G and mode=='sum') else (mode if wr==G else (c[1] if c[0]==wr else 0)))
                        s=-feed*0.7-0.4*hold(c)
                    opts.append((s,-c[1],c))
                c=max(opts)[2]
            h.remove(c);trick.append(c);who.append(p)
        led=trick[0][0]
        w=who[max((i for i in range(N) if trick[i][0]==led),key=lambda i:trick[i][1])]
        v=val(roles[w],trick,mode);sc[w]+=v
        if roles[w]==G: gw+=1;gpts+=v
        lead=w
    return sc,gw,gpts
for N in [2,3,4,5]:
    for mode in ['sum',2,3]:
        rng=random.Random(7);n=20000;tot=0;gw=0;gp=0;spread=0;gtricks=0
        for i in range(n):
            s,g,p=rnd(rng,N,mode,i%N);tot+=sum(s);gw+=g;gp+=p;spread+=max(s)-min(s)
        gtr=min(N,5)  # tricks with a gorilla present
        print(f"N={N} mode={mode}: 平均合計/局={tot/n:.1f} 1人平均={tot/n/N:.1f} ゴリラ勝率={gw/n/gtr:.0%} ゴリラ点比率={gp/tot:.0%} 最大最小差={spread/n:.1f}")
