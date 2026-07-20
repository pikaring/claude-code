#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Qommons AI 利用ログ CSV → 「QommonsAI利用集計.xlsx」形式の集計ブックを生成する。

入力:
  downloads/qommons-log-YYYY-MM-DD.csv  (fetch_logs.mjs が取得した当月分ログ)
  registrants.csv                        (メール↔氏名・部署 の登録者マスタ)
  report_settings.json                   (業務削減効果試算の編集可能な前提値)

出力:
  reports/QommonsAI利用集計_YYYY-MM.xlsx

再現方針:
  部署別・個人別・課別TOP3・モデル/機能別・時間帯/曜日別・利用者推移・
  入出力の文字数分布 は生ログから機械的に再現できるため完全自動計算。
  個人別「削減時間」は 2026-07-20 に実データから逆算で確認した式
  (入力文字数*0.012 + 出力文字数*0.002)/60 [時間] を使用。
  業務削減効果_試算の「１つの文脈での質問数(C)」は生ログに会話スレッドIDが
  無く再現不能なため、report_settings.json の値をそのまま引き継ぐ
  (自動再計算はしない。手元で見直したい場合はその値を編集する)。
  頻出フレーズ Top30 は簡易な N-gram 頻度集計による参考値(前回とアルゴリズムが
  異なる可能性があるため目安として扱うこと)。
"""
import csv
import json
import re
import sys
import collections
import statistics
import datetime
import glob
import os

FILE_UPLOAD_RE = re.compile(r'^user_file_upload#(\{)')

csv.field_size_limit(10**8)

HERE = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS = os.path.join(HERE, 'downloads')
REPORTS = os.path.join(HERE, 'reports')
REGISTRANTS_PATH = os.path.join(HERE, 'registrants.csv')
SETTINGS_PATH = os.path.join(HERE, 'report_settings.json')

DEFAULT_SETTINGS = {
    "annual_workdays": 245,
    "hourly_wage_yen": 3000,
    "workday_hours": 7.75,
    "typing_speed_cpm_scenario": 60,
    "editing_speed_cpm_scenario": 20,
    "session_gap_minutes": 60,
    "session_gap_note": "6月分データの手動集計値(C≈4.55)に最も近い結果を返す閾値として60分を採用(2026-07-20 ユーザー提供の update_shukei.py 仕様に基づく)。",
    "reduction_time_input_min_per_char": 0.012,
    "reduction_time_output_min_per_char": 0.002,
}


def load_settings():
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, encoding='utf-8') as f:
            s = json.load(f)
        merged = {**DEFAULT_SETTINGS, **s}
        return merged
    return dict(DEFAULT_SETTINGS)


def save_settings(s):
    with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False, indent=2)


# システムアカウント等、登録者マスタに含まれないが所属が既知のメールアドレス
KNOWN_UNLISTED_DEPARTMENTS = {
    'system@city.hakodate.hokkaido.jp': ('(システムアカウント)', '総務部情報システム課'),
}


def load_registrants():
    regs = {}
    dept_registrant_count = collections.Counter()
    if not os.path.exists(REGISTRANTS_PATH):
        return regs, dept_registrant_count
    with open(REGISTRANTS_PATH, encoding='utf-8-sig') as f:
        r = csv.DictReader(f)
        for row in r:
            email = row['email']
            regs[email] = {
                'name': row.get('name') or email,
                'kana': row.get('name_kana') or '',
                'department': row.get('department') or '(未登録)',
                'employee_no': row.get('employee_no') or '',
            }
            dept_registrant_count[row.get('department') or '(未登録)'] += 1
    for email, (name, dept) in KNOWN_UNLISTED_DEPARTMENTS.items():
        if email not in regs:
            regs[email] = {'name': name, 'kana': '', 'department': dept, 'employee_no': ''}
    return regs, dept_registrant_count


def find_latest_csv():
    files = sorted(glob.glob(os.path.join(DOWNLOADS, 'qommons-log-*.csv')))
    if not files:
        raise SystemExit('ERROR: downloads/ に qommons-log-*.csv が見つかりません')
    return files[-1]


def parse_dt(s):
    s = s.strip()
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S'):
        try:
            return datetime.datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f'unrecognized datetime format: {s!r}')


def load_log(csv_path):
    rows = []
    with open(csv_path, encoding='utf-8-sig') as f:
        r = csv.reader(f)
        header = next(r)
        for row in r:
            if len(row) < 5:
                continue
            email, dt_str, ai_name, model_name, content = row[0], row[1], row[2], row[3], row[4]
            try:
                dt = parse_dt(dt_str)
            except ValueError:
                continue
            if '#' in content:
                role, text = content.split('#', 1)
            else:
                role, text = 'unknown', content
            role = role.strip()
            # user行は生ログ側で "user#user# 本文" のように役割マーカーが二重に
            # 入っている(assistant行は単一)。重複マーカーを除去してから本文を数える。
            if text.startswith(role + '#'):
                text = text[len(role) + 1:]
            text = text.lstrip()
            has_attachment = False
            m = FILE_UPLOAD_RE.match(text)
            if m:
                has_attachment = True
                try:
                    obj, _end = json.JSONDecoder().raw_decode(text[m.start(1):])
                    text = obj.get('message', '') or ''
                except (json.JSONDecodeError, ValueError):
                    pass  # JSON解析に失敗した場合は元テキスト(添付JSONを含む)のまま扱う
            rows.append({
                'email': email, 'dt': dt, 'ai_name': ai_name, 'model': model_name,
                'role': role.strip(), 'text': text, 'chars': len(text),
                'has_attachment': has_attachment,
            })
    return rows


WEEKDAY_JP = ['月', '火', '水', '木', '金', '土', '日']
WEEKDAY_JP_FULL = ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜']


def hour_label(h, peak_am, peak_pm):
    if h == 8:
        return '始業前'
    if 9 <= h <= 11:
        return '午前（ピーク）' if h == peak_am else '午前'
    if h == 12:
        return '昼休み'
    if 13 <= h <= 17:
        return '午後（ピーク）' if h == peak_pm else '午後'
    if 18 <= h <= 21:
        return '時間外'
    if h == 22 or h == 23:
        return '深夜'
    return None


def bucket_len(n):
    if n <= 50:
        return '〜50字（短文・ひと言）'
    if n <= 100:
        return '51〜100字'
    if n <= 200:
        return '101〜200字'
    if n <= 500:
        return '201〜500字'
    if n <= 1000:
        return '501〜1000字'
    if n <= 2000:
        return '1001〜2000字'
    if n <= 5000:
        return '2001〜5000字'
    return '5001字〜（大量）'


BUCKET_ORDER = ['〜50字（短文・ひと言）', '51〜100字', '101〜200字', '201〜500字',
                '501〜1000字', '1001〜2000字', '2001〜5000字', '5001字〜（大量）']


def count_sessions(user_rows, gap_minutes=60):
    """ユーザーごとに発言を時系列で並べ、直前発言との間隔が gap_minutes を
    超えたら新セッションとみなしてカウントする(update_shukei.py と同仕様)。"""
    by_user = collections.defaultdict(list)
    for r in user_rows:
        by_user[r['email']].append(r['dt'])
    n_sessions = 0
    for email, times in by_user.items():
        times.sort()
        prev = None
        for t in times:
            if prev is None or (t - prev).total_seconds() / 60 > gap_minutes:
                n_sessions += 1
            prev = t
    return n_sessions


def top_ngrams(texts, top_n=30, min_len=3, max_len=12):
    # 簡易な部分文字列(n-gram)頻度集計。テンプレ文言・システムプロンプトも含む粗い参考値。
    counter = collections.Counter()
    for t in texts:
        t = t.strip()
        L = len(t)
        if L < min_len:
            continue
        step = max(1, L // 400)  # 長文はサンプリングして計算量を抑える
        for length in range(min_len, min(max_len, L) + 1):
            for i in range(0, L - length + 1, step):
                frag = t[i:i + length]
                if frag.strip() and '\n' not in frag:
                    counter[frag] += 1
    # 短いフレーズが長いフレーズの部分文字列として重複カウントされやすいので、
    # 出現数が同程度の下位互換(部分文字列)を間引く簡易フィルタ
    items = counter.most_common(top_n * 4)
    picked = []
    for frag, cnt in items:
        if any(frag in p[0] and cnt <= p[1] * 1.05 for p in picked):
            continue
        picked.append((frag, cnt))
        if len(picked) >= top_n:
            break
    return picked


def build(csv_path, out_path):
    settings = load_settings()
    regs, dept_reg_count = load_registrants()
    rows = load_log(csv_path)
    if not rows:
        raise SystemExit('ERROR: ログが空です')

    dates = sorted({r['dt'].date() for r in rows})
    period_start, period_end = dates[0], dates[-1]

    user_rows = [r for r in rows if r['role'] == 'user']
    asst_rows = [r for r in rows if r['role'] == 'assistant']

    def dept_of(email):
        return regs.get(email, {}).get('department', '(未登録)')

    def name_of(email):
        return regs.get(email, {}).get('name', email)

    # ---------- 個人別集計 ----------
    per_user = collections.defaultdict(lambda: {
        'prompts': 0, 'responses': 0, 'in_chars': 0, 'out_chars': 0,
        'days': set(), 'first': None, 'last': None,
    })
    for r in rows:
        u = per_user[r['email']]
        if r['role'] == 'user':
            u['prompts'] += 1
            u['in_chars'] += r['chars']
        elif r['role'] == 'assistant':
            u['responses'] += 1
            u['out_chars'] += r['chars']
        u['days'].add(r['dt'].date())
        if u['first'] is None or r['dt'] < u['first']:
            u['first'] = r['dt']
        if u['last'] is None or r['dt'] > u['last']:
            u['last'] = r['dt']

    in_coef = settings['reduction_time_input_min_per_char']
    out_coef = settings['reduction_time_output_min_per_char']
    workday_hours = settings['workday_hours']

    individual = []
    for email, u in per_user.items():
        reduction_hours = (u['in_chars'] * in_coef + u['out_chars'] * out_coef) / 60
        individual.append({
            'name': name_of(email), 'department': dept_of(email), 'email': email,
            'prompts': u['prompts'], 'responses': u['responses'],
            'records': u['prompts'] + u['responses'],
            'in_chars': u['in_chars'], 'out_chars': u['out_chars'],
            'total_chars': u['in_chars'] + u['out_chars'],
            'days': len(u['days']), 'first': u['first'], 'last': u['last'],
            'reduction_hours': reduction_hours,
            'reduction_days': reduction_hours / workday_hours,
        })
    individual.sort(key=lambda x: -x['prompts'])

    # ---------- 部署別集計 ----------
    dept_agg = collections.defaultdict(lambda: {'prompts': 0, 'responses': 0, 'chars': 0, 'users': set()})
    for r in rows:
        d = dept_of(r['email'])
        a = dept_agg[d]
        if r['role'] == 'user':
            a['prompts'] += 1
        elif r['role'] == 'assistant':
            a['responses'] += 1
        a['chars'] += r['chars']
        a['users'].add(r['email'])
    department = []
    for d, a in dept_agg.items():
        registrant_count = dept_reg_count.get(d, len(a['users']))
        user_count = len(a['users'])
        department.append({
            'department': d, 'registrants': registrant_count, 'users': user_count,
            'usage_rate': (user_count / registrant_count) if registrant_count else None,
            'prompts': a['prompts'], 'responses': a['responses'],
            'records': a['prompts'] + a['responses'], 'chars': a['chars'],
            'prompts_per_user': round(a['prompts'] / user_count) if user_count else 0,
        })
    department.sort(key=lambda x: -x['prompts'])

    # ---------- 課別文字数TOP3 ----------
    dept_top3 = []
    by_dept_users = collections.defaultdict(list)
    for iu in individual:
        by_dept_users[iu['department']].append(iu)
    for d, users in by_dept_users.items():
        users_sorted = sorted(users, key=lambda x: -x['total_chars'])
        total_chars = sum(u['total_chars'] for u in users)
        top3 = users_sorted[:3]
        row = {'department': d, 'users': len(users), 'chars': total_chars}
        for i in range(3):
            if i < len(top3):
                row[f'name{i+1}'] = top3[i]['name']
                row[f'chars{i+1}'] = top3[i]['total_chars']
            else:
                row[f'name{i+1}'] = None
                row[f'chars{i+1}'] = None
        dept_top3.append(row)
    dept_top3.sort(key=lambda x: -x['chars'])

    # ---------- モデル・機能別集計 ----------
    model_agg = collections.defaultdict(lambda: {'prompts': 0, 'responses': 0, 'users': set(), 'ai_names': collections.Counter()})
    for r in rows:
        m = model_agg[r['model']]
        if r['role'] == 'user':
            m['prompts'] += 1
            m['users'].add(r['email'])
            m['ai_names'][r['ai_name']] += 1
        elif r['role'] == 'assistant':
            m['responses'] += 1
    total_prompts = len(user_rows)
    model_stats = []
    for m, a in model_agg.items():
        model_stats.append({
            'model': m, 'prompts': a['prompts'], 'share': a['prompts'] / total_prompts if total_prompts else 0,
            'responses': a['responses'], 'users': len(a['users']),
            'main_use': a['ai_names'].most_common(1)[0][0] if a['ai_names'] else None,
        })
    model_stats.sort(key=lambda x: -x['prompts'])

    ai_agg = collections.defaultdict(lambda: {'prompts': 0, 'users': set(), 'models': collections.Counter()})
    for r in user_rows:
        a = ai_agg[r['ai_name']]
        a['prompts'] += 1
        a['users'].add(r['email'])
        a['models'][r['model']] += 1
    ai_stats = []
    for name, a in ai_agg.items():
        ai_stats.append({
            'ai_name': name, 'prompts': a['prompts'], 'share': a['prompts'] / total_prompts if total_prompts else 0,
            'users': len(a['users']),
            'main_model': a['models'].most_common(1)[0][0] if a['models'] else None,
        })
    ai_stats.sort(key=lambda x: -x['prompts'])

    # ---------- 時間帯・曜日別集計 ----------
    hour_counts = collections.Counter(r['dt'].hour for r in user_rows)
    peak_am = max(range(9, 12), key=lambda h: hour_counts.get(h, 0))
    peak_pm = max(range(13, 18), key=lambda h: hour_counts.get(h, 0))
    hourly = []
    for h in range(24):
        c = hour_counts.get(h, 0)
        if c == 0 and h not in hour_counts:
            continue
        hourly.append({'hour': h, 'count': c, 'share': c / total_prompts if total_prompts else 0,
                        'note': hour_label(h, peak_am, peak_pm)})

    weekday_counts = collections.Counter(r['dt'].weekday() for r in user_rows)
    weekday_stats = []
    for wd in range(7):
        c = weekday_counts.get(wd, 0)
        weekday_stats.append({'weekday': WEEKDAY_JP_FULL[wd], 'count': c,
                               'share': c / total_prompts if total_prompts else 0,
                               'note': '休日' if wd >= 5 else '平日'})

    daily = []
    for d in dates:
        day_rows = [r for r in user_rows if r['dt'].date() == d]
        c = len(day_rows)
        users = len(set(r['email'] for r in day_rows))
        note = None
        wd = d.weekday()
        if wd == 5:
            note = '土曜'
        elif wd == 6:
            note = '日曜'
        daily.append({'date': d, 'prompts': c, 'users': users, 'note': note})

    # ---------- 利用者推移(日別) ----------
    seen = set()
    trend = []
    for d in dates:
        day_users = set(r['email'] for r in user_rows if r['dt'].date() == d)
        new_users = day_users - seen
        repeaters = day_users & seen
        seen |= day_users
        wd = d.weekday()
        trend.append({
            'date': d, 'weekday': WEEKDAY_JP[wd], 'repeaters': len(repeaters),
            'new': len(new_users), 'total': len(day_users), 'cumulative': len(seen),
            'weekend': 1 if wd >= 5 else 0,
        })

    # ---------- 入出力傾向分析 ----------
    bucket_counts = collections.Counter(bucket_len(r['chars']) for r in user_rows)
    length_dist = [{'bucket': b, 'count': bucket_counts.get(b, 0),
                     'share': bucket_counts.get(b, 0) / total_prompts if total_prompts else 0}
                    for b in BUCKET_ORDER]

    attach_count = sum(1 for r in user_rows if r['has_attachment'])
    attachment = {
        'with': attach_count, 'with_share': attach_count / total_prompts if total_prompts else 0,
        'without': total_prompts - attach_count,
        'without_share': (total_prompts - attach_count) / total_prompts if total_prompts else 0,
    }

    by_ai_chars = collections.defaultdict(list)
    for r in user_rows:
        by_ai_chars[r['ai_name']].append(r['chars'])
    ai_char_stats = []
    for name, lens in by_ai_chars.items():
        ai_char_stats.append({
            'ai_name': name, 'mean': round(statistics.mean(lens), 1),
            'median': statistics.median(lens),
        })
    ai_char_stats.sort(key=lambda x: -x['mean'])

    phrases = top_ngrams([r['text'] for r in user_rows if r['text']])

    # ---------- 業務削減効果_試算 ----------
    total_in_chars = sum(r['chars'] for r in user_rows)
    total_out_chars = sum(r['chars'] for r in asst_rows)
    total_users = len(per_user)
    n_sessions = count_sessions(user_rows, settings['session_gap_minutes'])
    context_questions_per_thread = round(total_prompts / n_sessions, 3) if n_sessions > 0 else 1.0

    return {
        'period_start': period_start, 'period_end': period_end,
        'individual': individual, 'department': department, 'dept_top3': dept_top3,
        'model_stats': model_stats, 'ai_stats': ai_stats,
        'hourly': hourly, 'weekday_stats': weekday_stats, 'daily': daily, 'trend': trend,
        'length_dist': length_dist, 'attachment': attachment, 'ai_char_stats': ai_char_stats,
        'phrases': phrases,
        'total_prompts': total_prompts, 'total_responses': len(asst_rows),
        'total_in_chars': total_in_chars, 'total_out_chars': total_out_chars,
        'total_users': total_users, 'settings': settings,
        'n_sessions': n_sessions, 'context_questions_per_thread': context_questions_per_thread,
    }, regs


# ---------------- xlsx 出力 ----------------

def write_workbook(data, regs, out_path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    wb.remove(wb.active)

    header_font = Font(bold=True)
    title_font = Font(bold=True, size=13)
    note_font = Font(size=9, italic=True, color='666666')
    header_fill = PatternFill('solid', fgColor='DDEBF7')

    def style_header_row(ws, row, ncols):
        for c in range(1, ncols + 1):
            cell = ws.cell(row, c)
            cell.font = header_font
            cell.fill = header_fill

    def autosize(ws, widths):
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

    period_label = f"集計期間: {data['period_start']} 〜 {data['period_end']}"

    # ===== 部署別集計 =====
    ws = wb.create_sheet('部署別集計')
    ws['A1'] = 'QommonsAI 利用集計（部署別）'; ws['A1'].font = title_font
    ws['A2'] = f"{period_label}  ／ 利用回数=プロンプト(質問)数  ／ 使用文字数=入力+出力(プレフィックス除く)"; ws['A2'].font = note_font
    headers = ['部署名', '登録者数', '利用者数', '利用率', 'プロンプト数', '応答数', '合計レコード', '使用文字数', '1人あたり\nプロンプト数(利用者)']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 4, len(headers))
    for d in data['department']:
        ws.append([d['department'], d['registrants'], d['users'], d['usage_rate'],
                   d['prompts'], d['responses'], d['records'], d['chars'], d['prompts_per_user']])
    for r in range(5, ws.max_row + 1):
        ws.cell(r, 4).number_format = '0%'
    autosize(ws, [26, 10, 10, 9, 11, 9, 11, 12, 16])

    # ===== 個人別集計 =====
    ws = wb.create_sheet('個人別集計')
    ws['A1'] = 'QommonsAI 利用集計（個人別）'; ws['A1'].font = title_font
    ws['A2'] = '利用回数=プロンプト(質問)数。使用文字数=入力+出力。利用順→プロンプト数降順。'; ws['A2'].font = note_font
    ws['N2'] = f"入力係数：{data['settings']['reduction_time_input_min_per_char']}分／文字"
    ws['N3'] = f"出力係数：{data['settings']['reduction_time_output_min_per_char']}分／文字"
    headers = ['氏名', '部署名', 'メールアドレス', 'プロンプト数', '応答数', '合計レコード', '入力文字数',
               '出力文字数', '使用文字数(計)', '利用日数', '初回利用', '最終利用', '個人別\n削減時間',
               '個人別\n削減時間\n（日）']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 4, len(headers))
    total_reduction_hours = sum(u['reduction_hours'] for u in data['individual'])
    total_reduction_days = sum(u['reduction_days'] for u in data['individual'])
    for i, u in enumerate(data['individual']):
        row = [u['name'], u['department'], u['email'], u['prompts'], u['responses'], u['records'],
               u['in_chars'], u['out_chars'], u['total_chars'], u['days'],
               u['first'], u['last'], u['reduction_hours'], u['reduction_days']]
        ws.append(row)
    ws.cell(5, 16).value = total_reduction_hours
    ws.cell(5, 17).value = total_reduction_days
    ws.cell(4, 16).value = '合計'
    ws.cell(4, 17).value = '平均(削減時間)'
    for r in range(5, ws.max_row + 1):
        ws.cell(r, 11).number_format = 'yyyy/mm/dd hh:mm'
        ws.cell(r, 12).number_format = 'yyyy/mm/dd hh:mm'
        ws.cell(r, 13).number_format = '0.00'
        ws.cell(r, 14).number_format = '0.00'
    autosize(ws, [14, 24, 30, 10, 8, 11, 10, 10, 12, 8, 17, 17, 10, 10])

    # ===== 課別文字数TOP3 =====
    ws = wb.create_sheet('課別文字数TOP3')
    ws['A1'] = '課別 使用文字数 TOP3'; ws['A1'].font = title_font
    ws['A2'] = '使用文字数=入力+出力(プレフィックス除く)。課合計文字数の多い順。利用者のいる課のみ。'; ws['A2'].font = note_font
    headers = ['部署名', '利用者数', '課合計文字数', '1位 氏名', '1位 文字数', '2位 氏名', '2位 文字数', '3位 氏名', '3位 文字数']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 4, len(headers))
    for d in data['dept_top3']:
        ws.append([d['department'], d['users'], d['chars'], d['name1'], d['chars1'],
                   d['name2'], d['chars2'], d['name3'], d['chars3']])
    autosize(ws, [26, 10, 13, 14, 10, 14, 10, 14, 10])

    # ===== 対応表 =====
    ws = wb.create_sheet('対応表（メール↔氏名部署）')
    ws['A1'] = 'メールアドレス ↔ 氏名・部署 対応表（登録者リスト）'; ws['A1'].font = title_font
    ws['A2'] = '出典: registrants.csv（このリポジトリで管理する登録者マスタ）'; ws['A2'].font = note_font
    headers = ['No', 'メールアドレス', '職員番号', '氏名', '氏名（カナ）', '部署名']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 4, len(headers))
    for i, (email, r) in enumerate(regs.items(), start=1):
        ws.append([i, email, r.get('employee_no'), r.get('name'), r.get('kana'), r.get('department')])
    autosize(ws, [6, 32, 10, 16, 18, 26])

    # ===== モデル・機能別集計 =====
    ws = wb.create_sheet('モデル・機能別集計')
    ws['A1'] = 'QommonsAI 利用集計（モデル・AI機能別）'; ws['A1'].font = title_font
    ws['A2'] = period_label; ws['A2'].font = note_font
    ws['A4'] = '▼ モデル別利用状況'; ws['A4'].font = header_font
    headers = ['モデル名', 'プロンプト数', '構成比', '応答数', '利用者数', '主な用途']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 5, len(headers))
    for m in data['model_stats']:
        ws.append([m['model'], m['prompts'], m['share'], m['responses'], m['users'], m['main_use']])
    ws.append(['合計', data['total_prompts'], 1, data['total_responses'], data['total_users'], None])
    ai_start = ws.max_row + 2
    ws.cell(ai_start, 1).value = '▼ AI機能別利用状況'; ws.cell(ai_start, 1).font = header_font
    headers2 = ['AI機能名', 'プロンプト数', '構成比', '利用者数', '主に使われるモデル']
    ws.append(headers2)
    style_header_row(ws, ai_start + 1, len(headers2))
    for a in data['ai_stats']:
        ws.append([a['ai_name'], a['prompts'], a['share'], a['users'], a['main_model']])
    for r in range(6, ws.max_row + 1):
        ws.cell(r, 3).number_format = '0.0%'
    autosize(ws, [26, 12, 9, 10, 10, 22])

    # ===== 時間帯・曜日別集計 =====
    ws = wb.create_sheet('時間帯・曜日別集計')
    ws['A1'] = 'QommonsAI 利用集計（時間帯・曜日別）'; ws['A1'].font = title_font
    ws['A2'] = period_label; ws['A2'].font = note_font
    ws['A4'] = '▼ 時間帯別プロンプト数（1時間単位）'; ws['A4'].font = header_font
    headers = ['時間帯', 'プロンプト数', '構成比', '備考']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 5, len(headers))
    for h in data['hourly']:
        ws.append([f"{h['hour']:02d}:00〜{h['hour']:02d}:59", h['count'], h['share'], h['note']])
    ws.append(['合計', data['total_prompts'], 1, None])
    wd_start = ws.max_row + 2
    ws.cell(wd_start, 1).value = '▼ 曜日別プロンプト数'; ws.cell(wd_start, 1).font = header_font
    ws.append(['曜日', 'プロンプト数', '構成比', '備考'])
    style_header_row(ws, wd_start + 1, 4)
    for w in data['weekday_stats']:
        ws.append([w['weekday'], w['count'], w['share'], w['note']])
    daily_start = ws.max_row + 2
    ws.cell(daily_start, 1).value = '▼ 日別推移（プロンプト数・利用者数）'; ws.cell(daily_start, 1).font = header_font
    ws.append(['日付', 'プロンプト数', '利用者数', '備考'])
    style_header_row(ws, daily_start + 1, 4)
    for d in data['daily']:
        ws.append([d['date'].isoformat(), d['prompts'], d['users'], d['note']])
    for r in range(6, ws.max_row + 1):
        c = ws.cell(r, 3)
        if isinstance(c.value, float):
            c.number_format = '0.0%'
    autosize(ws, [18, 12, 9, 12])

    # ===== 入出力傾向分析 =====
    ws = wb.create_sheet('入出力傾向分析')
    ws['A1'] = 'QommonsAI 入出力傾向分析（粗い参考値）'; ws['A1'].font = title_font
    ws['A2'] = f"{period_label}  ※キーワードは機械的な頻度集計。プレフィックス・テンプレ文も含む。"; ws['A2'].font = note_font
    ws['A4'] = '▼ 入力文字数の分布（プロンプト1件あたり）'; ws['A4'].font = header_font
    ws.append([]); ws.append(['文字数区分', '件数', '構成比'])
    style_header_row(ws, 5, 3)
    for b in data['length_dist']:
        ws.append([b['bucket'], b['count'], b['share']])
    ws.append(['合計', data['total_prompts'], 1])
    a_start = ws.max_row + 2
    ws.cell(a_start, 1).value = '▼ ファイル添付利用'; ws.cell(a_start, 1).font = header_font
    ws.append(['区分', '件数', '構成比'])
    style_header_row(ws, a_start + 1, 3)
    ws.append(['ファイル添付あり', data['attachment']['with'], data['attachment']['with_share']])
    ws.append(['添付なし', data['attachment']['without'], data['attachment']['without_share']])
    b_start = ws.max_row + 2
    ws.cell(b_start, 1).value = '▼ AI機能別 平均入力文字数'; ws.cell(b_start, 1).font = header_font
    ws.append(['AI機能', '平均入力文字数', '中央値'])
    style_header_row(ws, b_start + 1, 3)
    for a in data['ai_char_stats']:
        ws.append([a['ai_name'], a['mean'], a['median']])
    c_start = ws.max_row + 2
    ws.cell(c_start, 1).value = '▼ 入力テキスト 頻出フレーズ Top30（簡易N-gram、参考値）'; ws.cell(c_start, 1).font = header_font
    ws.append(['フレーズ（3文字以上）', '出現回数'])
    style_header_row(ws, c_start + 1, 2)
    for frag, cnt in data['phrases']:
        ws.append([frag, cnt])
    for r in range(6, ws.max_row + 1):
        c = ws.cell(r, 3)
        if isinstance(c.value, float):
            c.number_format = '0.0%'
    autosize(ws, [30, 16, 10])

    # ===== 利用者推移 =====
    ws = wb.create_sheet('利用者推移')
    ws['A1'] = 'QommonsAI 利用者推移（日別）'; ws['A1'].font = title_font
    ws['A2'] = period_label; ws['A2'].font = note_font
    headers = ['日付', '曜日', 'リピーター', '新規', '日計', '累計ユニーク', '土日']
    ws.append([]); ws.append(headers)
    style_header_row(ws, 4, len(headers))
    for t in data['trend']:
        ws.append([t['date'].isoformat(), t['weekday'], t['repeaters'], t['new'], t['total'],
                   t['cumulative'], t['weekend']])
    autosize(ws, [14, 8, 11, 8, 8, 12, 6])

    # ===== 業務削減効果_試算 =====
    ws = wb.create_sheet('業務削減効果_試算')
    s = data['settings']
    ws['A1'] = '業務削減効果の試算（推計）'; ws['A1'].font = title_font
    ws['A2'] = '※ログは「利用量」を示すもので、削減効果は前提条件に依存する推計値です。黄色セル＝変更可／緑セル＝ログ実数。'; ws['A2'].font = note_font
    ws['A4'] = '前提条件'; ws['A4'].font = header_font
    ws['A5'] = 'プロンプト総数（質問件数）'; ws['B5'] = data['total_prompts']
    ws['C5'] = f"ログ実数({data['period_start']}〜{data['period_end']})"
    ws['A6'] = '実利用日数'; ws['B6'] = len(data['daily']); ws['C6'] = 'ログ実数'
    ws['A7'] = '年間業務日数（目安）'; ws['B7'] = s['annual_workdays']; ws['C7'] = '年換算用・変更可'
    ws['A8'] = '人件費（円/時, 概算）'; ws['B8'] = s['hourly_wage_yen']; ws['C8'] = '共済等込みの目安・変更可'
    ws['A9'] = '1日あたり労働時間（時）'; ws['B9'] = s['workday_hours']; ws['C9'] = '7時間45分・変更可'
    ws['A11'] = 'シナリオ別 試算'; ws['A11'].font = header_font
    ws.append(['シナリオ', '1件あたり\n削減時間(分)', '削減時間\n(時間)', '人日換算\n(人日)', '削減額\n(円)', '年換算\n(時間)※単純外挿'])
    style_header_row(ws, 12, 6)
    for name, minutes in [('控えめ', 5), ('標準', 10), ('積極', 20)]:
        r = ws.max_row + 1
        ws.append([name, minutes, f'=$B$5*B{r}/60', f'=C{r}/$B$9', f'=C{r}*$B$8', f'=C{r}*$B$7/$B$6'])
    ws['A17'] = '【読み方】「標準（1件=10分短縮）」は中庸の目安。実際の値は業務内容で大きく変わります。'
    ws['A18'] = f"【年換算】実利用{len(data['daily'])}日の実績を年間業務日数で単純外挿した粗い参考値。導入初期データのため過大/過小の双方に振れます。"
    ws['A19'] = '【限界】ログは利用量のみを示し、各質問が実際に手作業を代替したか・重複や試行が含まれるかは判別できません。'
    ws['A20'] = '【精度向上策】「この作業、AIで何分短縮できたか」を数問アンケートで実測し、上の「1件あたり削減時間」を置き換えると確度が上がります。'
    ws['A22'] = '２　業務削減時間（利用ログから概算）'; ws['A22'].font = header_font
    ws['A23'] = 'タイピング速度'; ws['B23'] = s['typing_speed_cpm_scenario']; ws['C23'] = '字／分　（参考値・変更可）'
    ws['A24'] = '推敲込み速度'; ws['B24'] = s['editing_speed_cpm_scenario']; ws['C24'] = '字／分　（入出力時間の計算に使用・変更可）'
    ws['A26'] = f"{data['period_end'].month}月分データ"; ws['C26'] = '時間'
    ws['A27'] = '入力文字数'; ws['B27'] = data['total_in_chars']; ws['C27'] = '=ROUND(B27/B23/60,0)'; ws['D27'] = '入力時間（A）'
    ws['A28'] = '出力文字数'; ws['B28'] = data['total_out_chars']; ws['C28'] = '=ROUND(B28/B24/60,0)'; ws['D28'] = '出力時間（B）'
    ws['A29'] = '１つの文脈での質問数（C）'; ws['B29'] = data['context_questions_per_thread']
    ws['C29'] = '=ROUND(C28/B29,0)'; ws['D29'] = '回答を得るまでの実出力時間（D=B/C）'
    ws['A30'] = '利用者数'; ws['B30'] = data['total_users']; ws['C30'] = '=ROUND(C29-C27,0)'; ws['D30'] = '削減時間（D－A）'
    ws['A31'] = '一人当たり削減時間（月）'; ws['C31'] = '=ROUND(C30/B30,2)'; ws['D31'] = '時間／人'
    ws['A33'] = '【読み方】出力時間Bを質問数Cで割ることで「1回の問い合わせで得られた有効な回答」を生成するのに相当する時間を推計。入力時間Aを差し引いたものを純削減時間とする。'
    ws['A34'] = (f"【前提】入出力文字数はログ集計値（プレフィックス除く）。質問数C=総プロンプト数÷セッション数"
                 f"(ユーザーごとに発言間隔が{s['session_gap_minutes']}分を超えたら新セッション、として自動算出。"
                 f"今回のセッション数={data['n_sessions']})")
    autosize(ws, [30, 14, 30, 30, 12, 16])

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)
    save_settings(s)


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else find_latest_csv()
    data, regs = build(csv_path, None)
    month_str = f"{data['period_end'].year:04d}-{data['period_end'].month:02d}"
    out_path = os.path.join(REPORTS, f'QommonsAI利用集計_{month_str}.xlsx')
    write_workbook(data, regs, out_path)
    # 常に最新月を指す複製(デスクトップへの保存用に固定ファイル名を維持)
    import shutil
    latest_path = os.path.join(HERE, 'QommonsAI利用集計.xlsx')
    shutil.copyfile(out_path, latest_path)
    print(f"総プロンプト数: {data['total_prompts']}")
    print(f"総利用者数: {data['total_users']}")
    print(f"OUTPUT: {out_path}")
    print(f"LATEST_COPY: {latest_path}")


if __name__ == '__main__':
    main()
