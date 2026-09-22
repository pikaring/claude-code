# 商人・預言者・指導者・ゴリラ — バランス確認用の簡易シミュレーション（v0.8）
# 得点になった札はゲームから抜ける。手に残った札は次の局へ持ち越し、8枚まで補充。5局固定。
# リードは連番・同数を2〜3枚重ねて出せる。札は各スート同じ数字が2枚ずつ（COPIES）。手札が尽きたら局を終える。
# 能力: 商人=仲買 / 預言者=預言 / 指導者=徴税 / 王=献上と下賜 / ゴリラ=なし
# 使い方: python3 tools/sim_balance.py
import random, statistics as st, itertools
M,P,L,K,G=0,1,2,3,4
def role(p,t,off): return (p-t+off)%5
def combos(h, maxn):
    out=[[c] for c in h]
    bys={}
    for c in h: bys.setdefault((c[0],c[1]),c)
    for (s,r),c in list(bys.items()):
        for n in (2,3):
            if n<=maxn and all((s,r+i) in bys for i in range(n)): out.append([bys[(s,r+i)] for i in range(n)])
    byr={}
    for c in h: byr.setdefault(c[1],[]).append(c)
    for r,cs in byr.items():
        for n in (2,3):
            if n<=maxn and len(cs)>=n:
                for comb in itertools.combinations(cs,n): out.append(list(comb))
    return out
def form(cmb):
    if len(cmb)==1: return ('single',cmb[0][0],1)
    if len(set(c[1] for c in cmb))==1: return ('set',None,len(cmb))
    if len(set(c[0] for c in cmb))==1: return ('run',cmb[0][0],len(cmb))
    return ('set',None,len(cmb))
def top(cmb): return max(c[1] for c in cmb)
def beats(lead_cmb, cmb):
    f=form(lead_cmb); g=form(cmb)
    if f[0]!=g[0] or f[2]!=g[2]: return False
    if f[0] in ('single','run') and g[1]!=f[1]: return False
    return top(cmb)>top(lead_cmb)
def game(rng,N,RANKS,combo=True,HMAX=8,ROUNDS=5,COPIES=2):
    deck=[(s,r,k) for s in range(4) for r in range(1,RANKS+1) for k in range(COPIES)]
    score=[0]*N; byrole=[0]*5; keep=[[] for _ in range(N)]; st_={'tricks':0,'short':0,'cards':0,'multi':0}
    for rnd in range(ROUNDS):
        pool=[c for c in deck if not any(c in h for h in keep)];rng.shuffle(pool)
        d=min(HMAX-len(keep[0]),len(pool)//N)
        hands=[keep[i]+pool[i*d:(i+1)*d] for i in range(N)]
        if not hands[0]: break
        lead=rnd%N;removed=[];t=0
        while t<5 and hands[0]:
            roles=[role(p,t,rnd) for p in range(N)];holder={roles[p]:p for p in range(N)}
            order=[(lead+k)%N for k in range(N)]
            def later(p): return {role(p,u,rnd) for u in range(t+1,5)}
            def hold(p,c):
                lt=later(p); return (c[1] if c[0] in lt else 0)+(c[1]*0.5 if G in lt else 0)
            # king exchange (selfish)
            if K in holder:
                k=holder[K];gv=[p for p in range(N) if p!=k and roles[p]!=G]
                for p in gv:
                    c=min(hands[p],key=lambda c:c[1]+hold(p,c));hands[p].remove(c);hands[k].append(c)
                for p in gv:
                    c=min(hands[k],key=lambda c:c[1]+hold(k,c)+(c[1] if c[0]==K else 0));hands[k].remove(c);hands[p].append(c)
            pred=None
            if P in holder:
                pp=holder[P];pred=pp if max(c[1] for c in hands[pp])>=RANKS-3 else next((q for q in order if q!=holder.get(G)),pp)
            def val(rr,tr): return sum(c[1] for c in tr) if rr==G else sum(c[1] for c in tr if c[0]==rr)
            plays={}
            # lead
            p=order[0];h=hands[p];r=roles[p]
            cands=combos(h,3) if combo else [[c] for c in h]
            def lead_score(cm):
                f=form(cm);tp=top(cm)/RANKS
                if r==G: return len(cm)*N*tp*RANKS*0.55 - sum(hold(p,c)*0.3 for c in cm)
                own=sum(c[1] for c in cm if c[0]==r)
                if own: return own*tp*1.3 - sum(hold(p,c)*0.3 for c in cm if c[0]!=r)
                return -sum(c[1] for c in cm)*0.4 - sum(hold(p,c) for c in cm) - (len(cm)-1)*5
            lc=max(cands,key=lambda cm:lead_score(cm)+rng.random()*0.5)
            for c in lc: h.remove(c)
            plays[p]=lc; n=len(lc); lf=form(lc)
            if n>1: st_['multi']+=1
            best_p=p
            for p in order[1:]:
                h=hands[p];r=roles[p]
                cur=plays[best_p];wr=roles[best_p]
                trick=[c for q in plays for c in plays[q]]
                opts=[]
                for cm in (combos(h,n) if n>1 else [[c] for c in h]):
                    if len(cm)==n and beats(cur,cm) and (n>1 or True):
                        opts.append((val(r,trick+cm)+0.6*(val(wr,trick) if wr!=r else 0)-0.4*sum(hold(p,c) for c in cm),cm))
                # discard option: must follow suit (single/run)
                if lf[0] in ('single','run'):
                    fol=sorted([c for c in h if c[0]==lf[1]],key=lambda c:c[1])
                    rest=sorted([c for c in h if c[0]!=lf[1]],key=lambda c:(c[1] if (wr==G or c[0]==wr) else 0)+hold(p,c))
                    if n==1 and fol:
                        # single must follow: only led-suit cards legal
                        opts=[o for o in opts]  # beating singles are led suit
                        dis=[fol[0]]
                    else: dis=(fol[:n]+rest)[:n] if len(fol)<n else fol[:n]
                else:
                    dis=sorted(h,key=lambda c:(c[1] if (wr==G or c[0]==wr) else 0)+hold(p,c))[:n]
                feed=sum(c[1] for c in dis if wr==G or c[0]==wr)
                opts.append((-0.8*feed-0.4*sum(hold(p,c) for c in dis),dis))
                cm=max(opts,key=lambda o:o[0]+rng.random()*0.3)[1]
                for c in cm: h.remove(c)
                plays[p]=cm
                if beats(plays[best_p],cm): best_p=p
            trick=[c for q in plays for c in plays[q]];st_['cards']+=len(trick);st_['tricks']+=1
            w=best_p;wr=roles[w]
            got=list(trick) if wr==G else [c for c in trick if c[0]==wr]
            v=sum(c[1] for c in got);score[w]+=v;byrole[wr]+=v;removed+=got
            left=[c for c in trick if c not in got]
            if wr==L and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[w]+=c[1];byrole[L]+=c[1]
            if M in holder and holder[M]!=w:
                coins=[c for c in left if c[0]==M]
                if coins: c=min(coins,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[M]]+=c[1];byrole[M]+=c[1]
            if pred is not None and pred==w and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[P]]+=c[1];byrole[P]+=c[1]
            lead=w;t+=1
        if t<5: st_['short']+=1
        deck=[c for c in deck if c not in removed];keep=[list(h) for h in hands]
        st_.setdefault('rounds',0);st_['rounds']+=1
    return score,byrole,st_

if __name__=="__main__":
    for label,cfg in [("2枚ずつ",{2:[6,7],3:[9,10],4:[11,12],5:[13,14]})]:
        for N,Rs in cfg.items():
            for R in Rs:
                rng=random.Random(3);BR=[0]*5;S={};n=1500;rounds=[];scs=[]
                for i in range(n):
                    sc,b,s_=game(rng,N,R,True);BR=[x+y for x,y in zip(BR,b)];scs+=sc
                    for k,v in s_.items(): S[k]=S.get(k,0)+v
                    rounds.append(s_['rounds'])
                T=sum(BR)
                print(f"N={N} 1-{R}x2({8*R}枚): "+" ".join(f"{a}{x/T:.0%}" for a,x in zip("商預指王ゴ",BR))+
                  f" | 5局{sum(r==5 for r in rounds)/n:.1%} 早終{S['short']/S['rounds']:.0%} 重ね{S['multi']/S['tricks']:.0%} 1人{st.mean(scs):.0f}点")
