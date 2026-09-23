# 王とゴリラ（(When) Do Gorillas Matter?） — バランス確認用の簡易シミュレーション（v1.0）
# 2〜4人・4役割（商人・預言者・王・ゴリラ）。場は「同じ形・同じ枚数で、同じ色で上げる／同じ数字で色かえ」で重ね、
# パスしたら抜ける。最後に出した人が総取り（役割に関係なく全部点）。得点札はゲームに戻らない。
# 手札は場ごとに8枚まで補充。4局×4つの場。
# 能力: 王=先導 / 預言者=指名して伏せて1枚ずつやりとり（シルバーバックは必ず渡す）＋指名した人が取れば先に1枚
#       商人=取れなかったら先に貨幣の最小1枚、貨幣なら色を問わず上げられる / ゴリラ=色を問わず上げられる、シルバーバックで即決
# opt: edict=王の札には色かえ不可（試した案） / king_reentry=王が一度だけ復帰（試した案） / mer_nojump=商人の貨幣の色かえなし（試した案）
# 使い方: python3 tools/sim_balance.py
import random, statistics as st, itertools
import random, statistics as st, itertools, sys
# ── 組の判定（combos / form）──

M,P,L,K,G=0,1,2,3,4
BAN=-1; GC=-2   # バナナ, ゴリラ札（スートなし）
def role(p,t,off): return (p-t+off)%5
def isban(c): return c[0]==BAN
def isgc(c): return c[0]==GC
def pts(c, wr):  # 得点札としての点
    if isban(c): return 5 if wr==G else 0
    if isgc(c): return 15 if wr==G else 0
    return c[1]
def combos(h, maxn, R):
    real=[c for c in h if c[0]>=0]; bans=[c for c in h if isban(c)]; gcs=[c for c in h if isgc(c)]
    out=[[c] for c in h]
    by={}
    for c in real: by.setdefault((c[0],c[1]),c)
    for (s,r),c in list(by.items()):
        for n in (2,3):
            if n<=maxn and all((s,r+i) in by for i in range(n)): out.append([by[(s,r+i)] for i in range(n)])
    byr={}
    for c in real: byr.setdefault(c[1],[]).append(c)
    for r,cs in byr.items():
        for n in (2,3):
            if n<=maxn and len(cs)>=n:
                for comb in itertools.combinations(cs,n): out.append(list(comb))
    if bans:
        b=bans[0]
        for n in (2,3):
            if n>maxn: continue
            # 同数: n-1枚の同じ数字 + バナナ
            for r,cs in byr.items():
                if len(cs)>=n-1:
                    for comb in itertools.combinations(cs,n-1): out.append(list(comb)+[b])
            # 連番: 同じスートの n-1 枚 + バナナで続き数字になる
            for s in range(4):
                keys=sorted(r for (ss,r) in by if ss==s)
                for comb in itertools.combinations(keys,n-1):
                    lo,hi=min(comb),max(comb)
                    if hi-lo<=n-1 and len(set(comb))==n-1 and (hi-lo==n-1 or hi+1<=R or lo-1>=1):
                        out.append([by[(s,r)] for r in comb]+[b])
    return out
def form(cmb, R):
    real=[c for c in cmb if c[0]>=0]; nb=len(cmb)-len(real)
    if any(isgc(c) for c in cmb): return ('gc',None,len(cmb),99) if len(cmb)==1 else None
    if nb>1: return None
    if len(cmb)==1: return ('single',real[0][0],1,real[0][1]) if real else ('ban',None,1,0)
    if len(set(c[1] for c in real))==1: return ('set',None,len(cmb),real[0][1])
    if len(set(c[0] for c in real))==1:
        rs=sorted(c[1] for c in real)
        if len(set(rs))!=len(rs): return None
        if nb==0:
            if rs[-1]-rs[0]!=len(rs)-1: return None
            return ('run',real[0][0],len(cmb),rs[-1])
        span=rs[-1]-rs[0]
        if span==len(cmb)-1: return ('run',real[0][0],len(cmb),rs[-1])
        if span==len(cmb)-2: return ('run',real[0][0],len(cmb),min(R,rs[-1]+1))
        return None
    return None

# 役割: 0商人 1預言者 2王 3ゴリラ（スートも 0貨幣 1聖典 2冠 3ゴリラ）
MR,PR,KR,GR=0,1,2,3
ORDER=[KR,PR,MR,GR]
NR=4
def val(c): return 15 if isgc(c) else (0 if isban(c) else c[1])
def legal_next(top, cm, R, role):
    ft=form(top,R); fc=form(cm,R)
    if not fc or fc[0] in ('gc','ban'): return False
    if ft[0]=='gc': return False
    if ft[0]!=fc[0] or ft[2]!=fc[2]: return False
    if ft[0]=='set': return fc[3]>ft[3]
    if ft[0]=='run' and OPT.get('runfree') and fc[3]>ft[3]: return True   # 連番は色を問わず上げられる
    if fc[1]==ft[1] and fc[3]>ft[3]: return True          # 同じ色で上
    if fc[1]!=ft[1] and fc[3]==ft[3] and not EDICT[0]: return True          # 同じ数字で色かえ
    if role==GR and fc[3]>ft[3]: return True               # ゴリラは色を問わず上
    if role==MR and fc[1]==0 and fc[3]>ft[3] and not OPT.get('mer_nojump'): return True  # 商人は貨幣で上なら色かえ
    return False
EDICT=[False]; OPT={}
def game(rng,N,R,opt,HMAX=8,ROUNDS=4,COPIES=2):
    OPT.clear(); OPT.update(opt)
    deck=[(s,r,k) for s in range(4) for r in range(1,R+1) for k in range(COPIES)]
    deck+=[(BAN,0,k) for k in range(4)]+[(GC,15,0)]
    score=[0]*N; byrole=[0]*NR; removed=set(); hands=[[] for _ in range(N)]
    S={'rounds':0,'tricks':0,'cards':0,'short':0,'gcwin':0,'steal':0}
    knows=[None]*N
    def refill():
        pool=[c for c in deck if c not in removed and not any(c in h for h in hands)];rng.shuffle(pool)
        need=HMAX-min(len(h) for h in hands); d=min(need,len(pool)//N)
        if d<need: S['short']+=1
        for i in range(N): hands[i]+=pool[i*d:(i+1)*d]
    for rnd in range(ROUNDS):
        refill()
        if all(len(h)==0 for h in hands): break
        S['rounds']+=1
        for t in range(NR):
            if any(len(h)==0 for h in hands): break
            roles=[(p-t+rnd)%NR for p in range(N)]
            holder={roles[p]:p for p in range(N)}
            order=sorted(range(N),key=lambda q:ORDER.index(roles[q]))
            later=lambda p:{(p-u+rnd)%NR for u in range(t+1,NR)}
            def hold(p,c):
                if isgc(c): return 40 if GR in later(p) else 8
                return c[1]*0.3+(c[1]*0.5 if GR in later(p) else 0)
            # 預言：指名して伏せて1枚ずつ（ゴリラ札は必ず渡す）
            pred=None
            if PR in holder:
                pp=holder[PR]
                name=knows[pp] if knows[pp] not in (None,pp) else rng.choice([q for q in range(N) if q!=pp]) if N>1 else pp
                pred=name
                if name!=pp and hands[name] and hands[pp] and OPT.get('pro_mode','both')!='predict':
                    gcs=[c for c in hands[name] if isgc(c)]
                    c1=gcs[0] if gcs else min(hands[name],key=lambda c:val(c)+hold(name,c))
                    hands[name].remove(c1);hands[pp].append(c1)
                    c2=min([c for c in hands[pp] if not isgc(c) and c is not c1] or [c for c in hands[pp] if c is not c1] or hands[pp],key=lambda c:val(c)+hold(pp,c))
                    hands[pp].remove(c2);hands[name].append(c2)
                    if isgc(c1): S['steal']+=1; knows[name]=pp
            # リード
            p=order[0];h=hands[p];r=roles[p]
            if r==GR and any(isgc(c) for c in h):
                lead=[next(c for c in h if isgc(c))]
            else:
                cands=[cm for cm in combos(h,3,R) if form(cm,R) and form(cm,R)[0] not in ('ban','gc')] or [[h[0]]]
                # 自分が取りやすい強い組ほど良いが、強い札は温存したい
                lead=max(cands,key=lambda cm:(len(cm)*2+form(cm,R)[3]*0.3 if form(cm,R) else -9)-sum(hold(p,c) for c in cm)*0.5+rng.random()*2)
            for c in lead: h.remove(c)
            pile=list(lead); top=lead; last=p; S['tricks']+=1
            if not (isgc(lead[0]) and r==GR):
                inn=[q for q in order if hands[q] or q==p]; reent=[False]
                while True:
                    moved=False
                    for q in list(order[1:]+order[:1]) if False else [x for x in order]:
                        if q==last or q not in inn: continue
                        h=hands[q];n=len(top);rq=roles[q]
                        potv=sum(val(c) for c in pile)
                        if rq==GR and any(isgc(c) for c in h) and potv>=12:
                            gc=next(c for c in h if isgc(c));h.remove(gc);pile.append(gc);last=q;S['gcwin']+=1;inn=[];break
                        EDICT[0]=bool(opt.get('edict') and roles[last]==KR)
                        opts=[cm for cm in (combos(h,n,R) if n>1 else [[c] for c in h]) if len(cm)==n and legal_next(top,cm,R,rq)]
                        want=potv*(1.2 if rq==GR else 1.0)
                        if opts:
                            cm=min(opts,key=lambda cm:form(cm,R)[3]+sum(hold(q,c) for c in cm)*0.5)
                            cost=sum(hold(q,c) for c in cm)
                            if want+sum(val(c) for c in cm)*0.5>cost*1.2 or rng.random()<0.25:
                                for c in cm: h.remove(c)
                                pile+=cm; top=cm; last=q; moved=True; continue
                        if opt.get('king_reentry') and rq==KR and not reent[0]:
                            reent[0]=True; continue
                        inn.remove(q)
                        if not [x for x in inn if x!=last]: break
                    if not inn or not [x for x in inn if x!=last] or not moved: break
            # 能力：勝者より先に抜く
            w=last
            if MR in holder and holder[MR]!=w:
                coins=[c for c in pile if c[0]==0]
                if coins: c=(max if OPT.get('mer_max') else min)(coins,key=lambda c:c[1]);pile.remove(c);score[holder[MR]]+=c[1];byrole[MR]+=c[1];removed.add(c)
            if PR in holder and pred==w and holder[PR]!=w and pile and OPT.get('pro_mode','both')!='steal' and (not OPT.get('pro_suit') or any(c[0]==1 for c in pile)):
                c=max([c for c in pile if c[0]==1] if OPT.get('pro_suit') else pile,key=val);pile.remove(c);score[holder[PR]]+=val(c);byrole[PR]+=val(c);removed.add(c)
            v=sum(val(c) for c in pile);score[w]+=v;byrole[roles[w]]+=v;removed.update(pile);S['cards']+=len(pile)
            refill()
    return score,byrole,S


RANGE={2:9,3:11,4:13}
OPT_V12={'runfree':1,'mer_max':1,'pro_suit':1}
if __name__=="__main__":
    for name,opt in [("v1.1",{'runfree':1}),("v1.2（商人＝貨幣の最大、預言者＝当てたら聖典の最大、返す札は受け取った札以外）",OPT_V12)]:
        print("==",name)
        for N,R in RANGE.items():
            rng=random.Random(5);n=400;SS={};BR=[0]*NR
            for i in range(n):
                sc,b,s_=game(rng,N,R,opt);BR=[x+y for x,y in zip(BR,b)]
                for k,v in s_.items(): SS[k]=SS.get(k,0)+v
            T=sum(BR)
            print(f" N={N}: "+" ".join(f"{a}{x/T:.0%}" for a,x in zip("商預王ゴ",BR))+f" | 奪取{SS['steal']/n:.1f}")
