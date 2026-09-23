# 王とゴリラ（(When) Do Gorillas Matter?） — バランス確認用の簡易シミュレーション（v0.9）
# 得点札はゲームから抜ける。手札は持ち越して8枚まで補充。5局固定。リードは連番・同数を重ねて出せる。
# 札は各スート同じ数字2枚ずつ＋バナナ4枚（組の何でも札）＋ゴリラ札1枚（ゴリラ役が出せば必勝）。
# 能力: 商人=仲買 / 預言者=指名して伏せて1枚やりとり（ゴリラ札は必ず渡す）＋指名した人が取れば1枚 / 指導者=徴税 / 王=先導（王がリード）
# opt: king="lead"|"exchange"|"none", prophetA / predict / steal, bananas, gc
# 使い方: python3 tools/sim_balance.py
import random, statistics as st, itertools
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
def game(rng,N,RANKS,opt,HMAX=8,ROUNDS=5,COPIES=2):
    deck=[(s,r,k) for s in range(4) for r in range(1,RANKS+1) for k in range(COPIES)]
    deck+=[(BAN,0,k) for k in range(opt.get('bananas',4))]
    if opt.get('gc'): deck.append((GC,15,0))
    score=[0]*N; byrole=[0]*5; keep=[[] for _ in range(N)]
    S={'rounds':0,'short':0,'steal_try':0,'steal_hit':0,'gc_play_g':0,'gc_waste':0,'ban_combo':0,'tricks':0,'pro_pts':0}
    knows=[None]*N  # 各自が知っているゴリラ札の持ち主
    for rnd in range(ROUNDS):
        pool=[c for c in deck if not any(c in h for h in keep)];rng.shuffle(pool)
        d=min(HMAX-len(keep[0]),len(pool)//N)
        hands=[keep[i]+pool[i*d:(i+1)*d] for i in range(N)]
        if not hands[0]: break
        S['rounds']+=1
        lead=rnd%N;removed=[];t=0
        while t<5 and hands[0]:
            roles=[role(p,t,rnd) for p in range(N)];holder={roles[p]:p for p in range(N)}
            if K in holder and opt.get('king')=='lead': lead=holder[K]
            order=[(lead+k)%N for k in range(N)]
            if opt.get('roleorder'):   # 王→指導者→預言者→商人→ゴリラ（空席は飛ばす）
                order=sorted(range(N),key=lambda q:[K,L,P,M,G].index(roles[q]))
            def later(p): return {role(p,u,rnd) for u in range(t+1,5)}
            def hold(p,c):
                if isgc(c): return 40 if G in later(p) else (8 if rnd<ROUNDS-1 else -5)
                if isban(c): return 3
                lt=later(p); return (c[1] if c[0] in lt else 0)+(c[1]*0.5 if G in lt else 0)
            if K in holder and opt.get('king','exchange')=='exchange':
                k=holder[K];gv=[p for p in range(N) if p!=k and roles[p]!=G]
                for p in gv:
                    c=min(hands[p],key=lambda c:(c[1] if c[0]>=0 else 0)+hold(p,c));hands[p].remove(c);hands[k].append(c)
                    if isgc(c): knows[p]=k
                for p in gv:
                    c=min(hands[k],key=lambda c:(c[1] if c[0]>=0 else 0)+hold(k,c)+(c[1] if c[0]==K else 0));hands[k].remove(c);hands[p].append(c)
                    if isgc(c): knows[k]=p
            pred=None
            if P in holder:
                pp=holder[P]
                if opt.get('prophetA'):
                    strong=max((c[1] for c in hands[pp] if c[0]>=0),default=0)>=RANKS-2
                    if knows[pp] not in (None,pp): name=knows[pp]
                    elif strong: name=pp
                    else: name=next((q for q in order if q!=holder.get(G) and q!=pp),pp)
                    pred=name
                    if name!=pp:
                        S['steal_try']+=1
                        gcs=[c for c in hands[name] if isgc(c)]
                        if gcs: S['steal_hit']+=1; c1=gcs[0]
                        else: c1=min(hands[name],key=lambda c:(c[1] if c[0]>=0 else 0)+hold(name,c))
                        hands[name].remove(c1);hands[pp].append(c1)
                        c2=min([c for c in hands[pp] if not isgc(c)],key=lambda c:(c[1] if c[0]>=0 else 0)+hold(pp,c))
                        hands[pp].remove(c2);hands[name].append(c2)
                        if isgc(c1): knows[name]=pp; knows[pp]=None
                if opt.get('steal'):
                    if not any(isgc(c) for c in hands[pp]):
                        guess=knows[pp] if knows[pp] not in (None,pp) else rng.choice([q for q in range(N) if q!=pp])
                        S['steal_try']+=1
                        if any(isgc(c) for c in hands[guess]):
                            S['steal_hit']+=1
                            gc=next(c for c in hands[guess] if isgc(c));hands[guess].remove(gc)
                            give=min(hands[pp],key=lambda c:(c[1] if c[0]>=0 else 0)+hold(pp,c));hands[pp].remove(give)
                            hands[pp].append(gc);hands[guess].append(give);knows[guess]=pp
                if opt.get('predict'):
                    pred=pp if max((c[1] for c in hands[pp] if c[0]>=0),default=0)>=RANKS-2 else next((q for q in order if q!=holder.get(G)),pp)
            def val(rr,tr):
                if rr==G: return sum(pts(c,G) for c in tr)
                return sum(c[1] for c in tr if c[0]==rr)
            plays={}
            p=order[0];h=hands[p];r=roles[p]
            cands=combos(h,3,RANKS)
            def lead_score(cm):
                f=form(cm,RANKS)
                if not f: return -1e9
                if f[0]=='gc': return 60 if r==G else -40
                if f[0]=='ban': return -30
                tp=f[3]/RANKS
                if r==G: return len(cm)*N*tp*RANKS*0.55 - sum(hold(p,c)*0.3 for c in cm)
                own=sum(c[1] for c in cm if c[0]==r)
                if own: return own*tp*1.3 - sum(hold(p,c)*0.3 for c in cm if c[0]!=r)
                return -sum(max(c[1],0) for c in cm)*0.4 - sum(hold(p,c) for c in cm) - (len(cm)-1)*5
            lc=max(cands,key=lambda cm:lead_score(cm)+rng.random()*0.5)
            for c in lc: h.remove(c)
            plays[p]=lc;n=len(lc);lf=form(lc,RANKS)
            if any(isban(c) for c in lc) and n>1: S['ban_combo']+=1
            best_p=p
            def beats(a,b):
                fa=form(a,RANKS);fb=form(b,RANKS)
                if not fb: return False
                if fa[0]=='gc': return False
                if fb[0]=='gc': return roles[pb_]==G
                if fa[0]=='ban': return fb[0]=='single'  # バナナのリードには何でも勝てる
                if fa[0]!=fb[0] or fa[2]!=fb[2]: return False
                if fa[0] in ('single','run') and fa[1]!=fb[1]: return False
                return fb[3]>fa[3]
            for p in order[1:]:
                pb_=p
                h=hands[p];r=roles[p];cur=plays[best_p];wr=roles[best_p]
                trick=[c for q in plays for c in plays[q]]
                opts=[]
                for cm in combos(h,n,RANKS):
                    if len(cm)==n and form(cm,RANKS) and beats(cur,cm):
                        if lf[0] in ('single','run') and any(c[0]>=0 for c in h if c[0]==lf[1]):
                            need=min(n,sum(1 for c in h if c[0]==lf[1]))
                            if sum(1 for c in cm if c[0]==lf[1])<need and not any(isgc(c) for c in cm): continue
                        opts.append((val(r,trick+cm)+0.6*(val(wr,trick) if wr!=r else 0)-0.4*sum(hold(p,c) for c in cm),cm))
                if lf[0] in ('single','run'):
                    fol=sorted([c for c in h if c[0]==lf[1]],key=lambda c:c[1])
                    rest=sorted([c for c in h if c[0]!=lf[1]],key=lambda c:(pts(c,wr) if (wr==G or c[0]==wr) else 0)+hold(p,c))
                    dis=(fol+rest)[:n] if len(fol)<n else fol[:n]
                else:
                    dis=sorted(h,key=lambda c:(pts(c,wr) if (wr==G or c[0]==wr) else 0)+hold(p,c))[:n]
                feed=sum(pts(c,wr) for c in dis if wr==G or c[0]==wr)
                opts.append((-0.8*feed-0.4*sum(hold(p,c) for c in dis),dis))
                # ゴリラはフォローの決まりに関係なく出せる：勝てないなら要らない札を捨てる
                if opt.get('gorfree') and r==G:
                    dis2=sorted(h,key=lambda c:(c[1] if c[0]>=0 else 0)*0.3+hold(p,c))[:n]
                    opts.append((-0.4*sum(hold(p,c) for c in dis2),dis2))
                # 商人は貨幣をいつでも出せる（負けても仲買で拾い戻せる見込み）
                if opt.get('mercoin') and r==M and lf[0] in ('single','run') and lf[1]!=M:
                    coins=sorted([c for c in h if c[0]==M],key=lambda c:c[1])
                    if coins:
                        k=min(n,len(coins));cm_=coins[:k]
                        rest=sorted([c for c in h if c not in cm_],key=lambda c:(c[0]!=lf[1], c[1]))
                        cm_=cm_+rest[:n-k]
                        back=0 if wr==G else cm_[0][1]*0.8
                        opts.append((back-0.8*sum(pts(c,wr) for c in cm_ if wr==G or c[0]==wr)-0.4*sum(hold(p,c) for c in cm_),cm_))
                cm=max(opts,key=lambda o:o[0]+rng.random()*0.3)[1]
                for c in cm: h.remove(c)
                plays[p]=cm
                if beats(plays[best_p],cm): best_p=p
            pb_=None
            trick=[c for q in plays for c in plays[q]];S['tricks']+=1
            for q in plays:
                if any(isgc(c) for c in plays[q]):
                    if roles[q]==G: S['gc_play_g']+=1
                    else: S['gc_waste']+=1
            w=best_p;wr=roles[w]
            got=list(trick) if wr==G else [c for c in trick if c[0]==wr]
            v=sum(pts(c,wr) for c in got);score[w]+=v;byrole[wr]+=v;removed+=got
            left=[c for c in trick if c not in got]
            if wr==L and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[w]+=max(c[1],0);byrole[L]+=max(c[1],0)
            if M in holder and holder[M]!=w:
                coins=[c for c in left if c[0]==M]
                if coins: c=min(coins,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[M]]+=c[1];byrole[M]+=c[1]
            if pred is not None and pred==w and left:
                c=max(left,key=lambda c:c[1]);left.remove(c);removed.append(c);score[holder[P]]+=max(c[1],0);byrole[P]+=max(c[1],0);S['pro_pts']+=max(c[1],0)
            lead=w;t+=1
            if opt.get('refill_trick'):   # 1トリックごとに8枚まで補充（捨て札は山札に戻っている扱い）
                pool=[c for c in deck if c not in removed and not any(c in h for h in hands)];rng.shuffle(pool)
                need=HMAX-len(hands[0]); d2=min(need,len(pool)//N)
                if d2<need: S['short_refill']=S.get('short_refill',0)+1
                for i in range(N): hands[i]+=pool[i*d2:(i+1)*d2]
        if t<5: S['short']+=1
        deck=[c for c in deck if c not in removed];keep=[list(h) for h in hands]
    return score,byrole,S





if __name__=="__main__":
    base={'prophetA':1,'bananas':4,'gc':1,'king':'lead','roleorder':1,'refill_trick':1,'mercoin':1}
    for name,opt in [("v0.12",base),("v0.13案（ゴリラは色にかかわらず出せる）",dict(base,gorfree=1))]:
        print("==",name)
        for N,R in {2:7,3:9,4:11,5:13}.items():
            rng=random.Random(4);BR=[0]*5;SS={};n=800;five=0
            for i in range(n):
                sc,b,s_=game(rng,N,R,opt);BR=[x+y for x,y in zip(BR,b)];five+=s_['rounds']==5
                for k,v in s_.items(): SS[k]=SS.get(k,0)+v
            T=sum(BR)
            print(f" N={N}: "+" ".join(f"{a}{x/T:.0%}" for a,x in zip("商預指王ゴ",BR))+f" | 5局{five/n:.0%}")
