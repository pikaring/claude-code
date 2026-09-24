#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
無償プランの1,000ライセンス枠に対する残り余裕を監視する。

使い方:
    python3 license_watch.py              # registrants.csv から今回値を記録し、Markdownを出力
    python3 license_watch.py --no-update  # 履歴を更新せず表示だけ

背景(2026-09-17 ユーザー指示):
QommonsAIの無償プランは1,000アカウントが上限(1,001以上は標準・フロンティアモデルが
月間3億トークン制限の対象になる)。アカウント削除で枠は戻るため、未完了アカウントの
定例棚卸しで枠内を維持する運用としている。9月・10月の増加ペースを見て、棚卸しだけで
維持できるか、2,000アカウントへの拡張(年12万円)に踏み切るかを判断する。

ポイント:
アカウント発行は稼働日にしか起きないため、到達予測は**稼働日ベース**で計算する。
暦日換算だと連休や年末年始をまたぐ時期に予測が大きくずれる(例: 9月は5連休がある)。

履歴の持ち方:
registrants.csv は毎回上書きされるため、過去の登録者数は復元できない。weekly_stats.json
と同じ考え方で、**人数のみ**を license_stats.json にコミットして引き継ぐ(氏名・メール
アドレス・職員番号は保存しない)。
"""
import csv
import json
import os
import datetime
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRANTS = os.path.join(HERE, 'registrants.csv')
STATS_PATH = os.path.join(HERE, 'license_stats.json')

JST = datetime.timezone(datetime.timedelta(hours=9))

LIMIT = 1000          # 無償プランのライセンス上限
WARN_WORKDAYS = 10    # 到達予測がこの稼働日数を切ったら警告

# 祝日・閉庁日(2026年度末まで)。稼働日計算に使う。
HOLIDAYS = {
    '2026-08-11',                                          # 山の日
    '2026-09-21', '2026-09-22', '2026-09-23',              # 敬老の日/国民の休日/秋分の日
    '2026-10-12',                                          # スポーツの日
    '2026-11-03', '2026-11-23',                            # 文化の日/勤労感謝の日
    '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',  # 年末年始閉庁
    '2027-01-11',                                          # 成人の日
    '2027-02-11', '2027-02-23',                            # 建国記念の日/天皇誕生日
    '2027-03-22',                                          # 春分の日の振替休日
}
HOLIDAYS = {datetime.date.fromisoformat(d) for d in HOLIDAYS}

# 棚卸し前の履歴(git履歴から復元。2026-08-07の167人削除より後の実測値)
SEED = {
    '2026-08-07': {'total': 848},
    '2026-08-15': {'total': 859},
    '2026-08-19': {'total': 880},
    '2026-08-22': {'total': 881},
    '2026-08-29': {'total': 907},
    '2026-08-31': {'total': 910},
    '2026-09-05': {'total': 924},
    '2026-09-13': {'total': 943, 'pending': 95},
}


def today_jst():
    """記録日はJSTで判定する。

    実行環境のタイムゾーンはUTCで、定時実行はJST日曜8時(=UTC土曜23時)に走るため、
    date.today() をそのまま使うと記録日が1日前にずれる(2026-09-20の実行が
    2026-09-19として記録された)。
    """
    return datetime.datetime.now(JST).date()


def workdays(a, b):
    """a(排他)からb(包含)までの稼働日数"""
    n, d = 0, a
    step = 1 if b >= a else -1
    while d != b:
        d += datetime.timedelta(days=step)
        if d.weekday() < 5 and d not in HOLIDAYS:
            n += step
    return n


def add_workdays(start, n):
    """startからn稼働日後の日付"""
    d, c = start, 0
    while c < n:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5 and d not in HOLIDAYS:
            c += 1
    return d


def read_registrants():
    """現在の登録者数と未完了(棚卸し候補)数を返す"""
    total = pending = 0
    with open(REGISTRANTS, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            if not any((v or '').strip() for v in row.values()):
                continue
            total += 1
            if (row.get('status') or '').strip() == '未完了':
                pending += 1
    return total, pending


def load_stats():
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH, encoding='utf-8') as f:
            return json.load(f)
    return dict(SEED)


def save_stats(stats):
    with open(STATS_PATH, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(stats.items())), f, ensure_ascii=False, indent=2)
        f.write('\n')


def pace(stats, today, lookback_days=30):
    """直近の発行ペース(人/稼働日)。棚卸しによる減少区間は除外する。"""
    pts = sorted((datetime.date.fromisoformat(d), v['total']) for d, v in stats.items())
    pts = [p for p in pts if (today - p[0]).days <= lookback_days]
    if len(pts) < 2:
        return None, 0, 0
    gained = wd = 0
    for (d0, n0), (d1, n1) in zip(pts, pts[1:]):
        if n1 < n0:          # 棚卸しがあった区間は発行ペースの計算から除く
            continue
        gained += n1 - n0
        wd += workdays(d0, d1)
    return (gained / wd if wd else None), gained, wd


def monthly_summary(stats):
    """月ごとの増加(棚卸しによる減少を含む純増)"""
    pts = sorted((datetime.date.fromisoformat(d), v['total']) for d, v in stats.items())
    out = {}
    for (d0, n0), (d1, n1) in zip(pts, pts[1:]):
        out.setdefault(f'{d1:%Y-%m}', 0)
        out[f'{d1:%Y-%m}'] += n1 - n0
    return out


def build(update=True):
    today = today_jst()
    total, pending = read_registrants()
    stats = load_stats()
    if update:
        stats[today.isoformat()] = {'total': total, 'pending': pending}
        save_stats(stats)

    prev = sorted(d for d in stats if d < today.isoformat())
    prev_total = stats[prev[-1]]['total'] if prev else None
    rate, gained, wd = pace(stats, today)
    remain = LIMIT - total

    L = []
    L.append('## ライセンス枠(無償プラン1,000)')
    L.append('')
    L.append('| 項目 | 値 |')
    L.append('|---|---:|')
    L.append(f'| 登録者数 | **{total:,}人** |')
    if prev_total is not None:
        L.append(f'| 前回比({prev[-1]}) | {total - prev_total:+,}人 |')
    L.append(f'| 1,000枠まで残り | **{remain:,}人** |')
    L.append(f'| 未完了(棚卸し候補) | {pending:,}人 |')
    if rate:
        L.append(f'| 発行ペース | {rate:.2f}人/稼働日 |')
    L.append('')

    if rate and remain > 0:
        need = remain / rate
        hit = add_workdays(today, int(need) + 1)
        L.append(f'- 到達予測: **{hit:%Y年%-m月%-d日}**(あと約{need:.0f}稼働日)')
        if need < WARN_WORKDAYS:
            L.append(f'- ⚠️ **到達予測が{WARN_WORKDAYS}稼働日を切りました。棚卸しの前倒しを検討してください**')
        if pending:
            after = remain + pending
            L.append(f'- 未完了{pending:,}人を棚卸しした場合: 残り{after:,}人 → '
                     f'**{add_workdays(today, int(after / rate) + 1):%Y年%-m月%-d日}**まで延長')
    elif remain <= 0:
        L.append('- ⚠️ **1,000枠を超過しています。標準・フロンティアモデルが月間3億トークン制限の対象です**')

    ms = monthly_summary(stats)
    if len(ms) >= 2:
        L.append('')
        L.append('| 月 | 純増 |')
        L.append('|---|---:|')
        for k in sorted(ms)[-4:]:
            L.append(f'| {k} | {ms[k]:+,}人 |')
        L.append('')
        L.append('※純増は棚卸しによる削除を差し引いた値。月間の純増が棚卸しで回収できる人数を'
                 '上回る場合、2,000アカウントへの拡張(年12万円)の検討が必要。')
    return '\n'.join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-update', action='store_true', help='履歴を更新せず表示のみ')
    args = ap.parse_args()
    print(build(update=not args.no_update))


if __name__ == '__main__':
    main()
