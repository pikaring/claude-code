#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
週次(月曜〜日曜)の利用者数・利用回数の推移を集計する。

使い方:
    python3 weekly_trend.py            # downloads/ の全CSVから集計し、履歴を更新して表を出力
    python3 weekly_trend.py --weeks 6  # 表示する週数を指定(既定4)

背景(2026-09-06 ユーザー指示):
定時レポートの数字は「月初からの累計」なので、月をまたぐと前週と単純比較できない
(例: 8/30時点646人 vs 9/6時点522人は期間長が違う)。週単位で切り直した推移を
レポートに載せるために追加した。

履歴の持ち方:
`downloads/` は .gitignore 済みで、コンテナが作り直されると消える。前月分CSVが
無い状態でも月をまたぐ比較ができるよう、**週ごとの集計値のみ** を weekly_stats.json
としてリポジトリにコミットして引き継ぐ(発話内容やログインIDは保存しない)。
同じ週をより多い日数でカバーする再集計が行われた場合のみ既存値を上書きする。

「継続/新規/離脱」の内訳は連続する2週分の生ログが手元にある場合のみ算出する
(集計値だけでは復元できないため)。
"""
import csv
import json
import os
import glob
import datetime
import argparse

csv.field_size_limit(10 ** 8)

HERE = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS = os.path.join(HERE, 'downloads')
STATS_PATH = os.path.join(HERE, 'weekly_stats.json')
WEEKDAY_JP = '月火水木金土日'


def week_start(d):
    """その日が属する週(月曜起点)の月曜日を返す"""
    return d - datetime.timedelta(days=d.weekday())


def scan_downloads():
    """downloads/ の全CSVを走査し、日付ごとの利用者集合と件数を返す。

    CSVは「当月1日〜当日」で毎回取得するため、複数ファイルが同じ日付を重複して
    含む。件数は単純に足すと多重計上になるので、日付ごとに **最も件数の多い
    スナップショット** を採用する(利用者はどのスナップショットも部分集合なので
    和集合で正しい)。
    """
    day_users = {}
    per_file = {}  # path -> {date: count}
    for path in sorted(glob.glob(os.path.join(DOWNLOADS, 'qommons-log-*.csv'))):
        counts = {}
        with open(path, encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                if len(row) < 2:
                    continue
                d = (row.get('利用日時') or '')[:10]
                if len(d) != 10:
                    continue
                day_users.setdefault(d, set()).add(row.get('ユーザー名') or '')
                counts[d] = counts.get(d, 0) + 1
        per_file[path] = counts
    day_count = {}
    for counts in per_file.values():
        for d, c in counts.items():
            if c > day_count.get(d, 0):
                day_count[d] = c
    return day_users, day_count


def aggregate_weeks(day_users, day_count):
    """日別データを週(月〜日)単位に畳み込む"""
    weeks = {}
    for d, users in day_users.items():
        ws = week_start(datetime.date.fromisoformat(d)).isoformat()
        w = weeks.setdefault(ws, {'users': set(), 'records': 0, 'days': 0})
        w['users'] |= users
        w['records'] += day_count[d]
        w['days'] += 1
    return weeks


def load_stats():
    if not os.path.exists(STATS_PATH):
        return {}
    with open(STATS_PATH, encoding='utf-8') as f:
        return json.load(f)


def merge_stats(stats, weeks):
    """同じ週をより多い日数でカバーした集計のみ上書きする"""
    updated = []
    for ws, w in weeks.items():
        new = {'users': len(w['users']), 'records': w['records'], 'days': w['days']}
        old = stats.get(ws)
        if old is None or new['days'] >= old.get('days', 0):
            if old != new:
                updated.append(ws)
            stats[ws] = new
    return stats, updated


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--weeks', type=int, default=4, help='表示する週数(既定4)')
    args = ap.parse_args()

    day_users, day_count = scan_downloads()
    if not day_users:
        raise SystemExit('ERROR: downloads/ に qommons-log-*.csv が見つかりません')
    weeks = aggregate_weeks(day_users, day_count)

    stats = load_stats()
    stats, updated = merge_stats(stats, weeks)
    with open(STATS_PATH, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(stats.items())), f, ensure_ascii=False, indent=2)
    print(f'週次履歴を更新: {STATS_PATH}（{len(updated)}週分を追加/更新）')

    keys = sorted(stats)[-args.weeks:]
    print('\n## 週次推移（月〜日）\n')
    print('| 週 | 利用者数 | 利用回数 | 対象日数 |')
    print('|---|---:|---:|---:|')
    for ws in keys:
        s = stats[ws]
        we = (datetime.date.fromisoformat(ws) + datetime.timedelta(days=6)).isoformat()
        print(f"| {ws}〜{we} | {s['users']:,}人 | {s['records']:,}件 | {s['days']}日 |")

    if len(keys) >= 2:
        a, b = stats[keys[-2]], stats[keys[-1]]
        du, dr = b['users'] - a['users'], b['records'] - a['records']
        print(f"\n前週比: 利用者数 {a['users']:,}人 → {b['users']:,}人 "
              f"({du:+,}人, {du / a['users'] * 100:+.1f}%) / "
              f"利用回数 {a['records']:,}件 → {b['records']:,}件 "
              f"({dr:+,}件, {dr / a['records'] * 100:+.1f}%)")

        # 継続/新規/離脱は生ログが両週分そろっている場合のみ
        wa, wb = weeks.get(keys[-2]), weeks.get(keys[-1])
        if wa and wb:
            cont = len(wa['users'] & wb['users'])
            print(f"内訳: 継続 {cont}人（前週の{cont / len(wa['users']) * 100:.1f}%） / "
                  f"新規 {len(wb['users'] - wa['users'])}人 / "
                  f"離脱 {len(wa['users'] - wb['users'])}人")
        else:
            print('内訳: 継続/新規/離脱は前週分の生ログが手元にないため算出せず')

    print('\n※定時実行は日曜朝のため、最新週は日曜日中の利用が含まれない（毎週同条件）。')


if __name__ == '__main__':
    main()
