# 商人・預言者・指導者・ゴリラ — バランス確認用の簡易シミュレーション（v0.6）
# 得点になった札はゲームから抜ける。手に残った札は次の局へ持ち越し、8枚まで山札から補充。5局固定。
# 能力: 商人=仲買 / 預言者=預言（自分も指名可）/ 指導者=徴税 / 王=献上と下賜 / ゴリラ=なし
# 包囲: ゴリラが勝つとき、ゴリラ以外2人以上のリードスートの札の合計がゴリラの札の2倍を超えたらゴリラの負け
# opt: ltax=指導者が徴税 / kex='selfish'|'coalition' 王の交換の配り方 / siege=包囲の倍率
# 使い方: python3 tools/sim_balance.py
import random, statistics as st
M,P,L,K,G=0,1,2,3,4
def role(p,t,off): return (p-t+off)%5
def game(rng,N,RANKS,opt,HMAX=8,ROUNDS=5):
    deck=[(s,r) for s in range(4) for r in range(1,RANKS+1)]
    score=[0]*N; byrole=[0]*5; keep=[[] for _ in range(N)]; stats={'ex':0,'siege':0,'gtr':0,'gwin':0}
    for rounds in range(ROUNDS):
        pool=[c for c in deck if not any(c in h for h in keep)];rng.shuffle(pool)
        d=min(HMAX-len(keep[0]),len(pool)//N)
        hands=[keep[i]+pool[i*d:(i+1)*d] for i in range(N)];H=len(hands[0])
        if H==0: break
        TR=min(5,H);lead=rounds%N;removed=[]
        for t in range(TR):
            roles=[role(p,t,rounds) for p in range(N)];holder={roles[p]:p for p in range(N)}
            order=[(lead+k)%N for k in range(N)]
            def later(p): return {role(p,u,rounds) for u in range(t+1,TR)}
            def holdv(p,c):
                lt=later(p); return (c[1] if c[0] in lt else 0)+(c[1]*0.5 if G in lt else 0)+(c[1] if c[0]==roles[p] else 0)
            # 王: 献上と下賜
            if opt.get('kex') and K in holder:
                k=holder[K];givers=[p for p in range(N) if p!=k and roles[p]!=G]
                for p in givers:
                    c=min(hands[p],key=lambda c:c[1]+holdv(p,c));hands[p].remove(c);hands[k].append(c);stats['ex']+=1
                for p in givers:
                    if opt['kex']=='coalition' and G in holder:
                        # ゴリラより後に出す人には強い札を渡す
                        gi=order.index(holder[G]);after=order.index(p)>gi
                        if after:
                            c=max(hands[k],key=lambda c:c[1]-holdv(k,c)*0.5)
                        else: c=min(hands[k],key=lambda c:c[1]+holdv(k,c))
                    else: c=min(hands[k],key=lambda c:c[1]+holdv(k,c))
                    hands[k].remove(c);hands[p].append(c)
            pred=None
            if P in holder:
                pp=holder[P];pred=pp if max(c[1] for c in hands[pp])>=RANKS-3 else holder.get(G,order[0])
            trick=[];who=[]
            def win_idx(led): return max((i for i in range(len(trick)) if trick[i][0]==led),key=lambda i:trick[i][1])
            def val(rr,tr): return sum(c[1] for c in tr) if rr==G else sum(c[1] for c in tr if c[0]==rr)
            for p in order:
                h=hands[p];r=roles[p]
                if not trick:
                    own=[c for c in h if c[0]==r]
                    c=max(own,key=lambda c:c[1]) if own else (max(h,key=lambda c:c[1]) if r==G else min(h,key=lambda c:c[1]+holdv(p,c)))
                else:
                    led=trick[0][0];fol=[c for c in h if c[0]==led];legal=fol or h
                    bi=win_idx(led);wr=roles[who[bi]];best=None
                    for c in legal:
                        win=c[0]==led and c[1]>trick[bi][1]
                        if win: s=val(r,trick+[c])+0.6*(val(wr,trick) if wr!=r else 0)-0.4*holdv(p,c)*(0 if c[0]==r else 1)
                        else:
                            s=-0.8*(c[1] if (wr==G or c[0]==wr) else 0)-0.4*holdv(p,c)
                            if opt.get('siege') and wr==G and r!=G and c[0]==led: s=0.3*val(G,trick)*c[1]/max(1,trick[bi][1])-0.2*holdv(p,c)
                        if best is None or s>best[0]: best=(s,c)
                    c=best[1]
                h.remove(c);trick.append(c);who.append(p)
            led=trick[0][0];wi=win_idx(led);w=who[wi];wr=roles[w]
            if G in holder: stats['gtr']+=1
            if opt.get('siege') and wr==G:
                allies=[i for i in range(N) if roles[who[i]]!=G and trick[i][0]==led]
                if len(allies)>=2 and sum(trick[i][1] for i in allies)>opt['siege']*trick[wi][1]:
                    wi=max(allies,key=lambda i:trick[i][1]);w=who[wi];wr=roles[w];stats['siege']+=1
            if wr==G: stats['gwin']+=1
            got=list(trick) if wr==G else [c for c in trick if c[0]==wr]
            v=sum(c[1] for c in got);score[w]+=v;byrole[wr]+=v;removed+=got
            left=[c for c in trick if c not in got]
            taxer=L if opt.get('ltax') else K
            if wr==taxer and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[w]+=c[1];byrole[wr]+=c[1]
            if M in holder and holder[M]!=w:
                coins=[c for c in left if c[0]==M]
                if coins: c=min(coins,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[M]]+=c[1];byrole[M]+=c[1]
            if pred is not None and pred==w and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[P]]+=c[1];byrole[P]+=c[1]
            lead=w
        deck=[c for c in deck if c not in removed];keep=[list(h) for h in hands]
    return score,byrole,stats

OPT={'ltax':1,'kex':'selfish','siege':2.0}
RANGE={2:12,3:17,4:22,5:26}
if __name__=="__main__":
    for N,R in RANGE.items():
        rng=random.Random(5);BR=[0]*5;S={'ex':0,'siege':0,'gtr':0,'gwin':0};n=3000
        for i in range(n):
            sc,b,s=game(rng,N,R,OPT);BR=[x+y for x,y in zip(BR,b)];S={k:S[k]+s[k] for k in S}
        T=sum(BR)
        print(f"N={N} 1-{R}: "+" ".join(f"{a}{x/T:.0%}" for a,x in zip("商預指王ゴ",BR))+f"  ゴリラ勝率{S['gwin']/max(1,S['gtr']):.0%} 包囲成立{S['siege']/max(1,S['gtr']):.0%} 王への献上/局{S['ex']/n/5:.1f}枚")
