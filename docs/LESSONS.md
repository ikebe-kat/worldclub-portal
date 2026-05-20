# ワールドクラブポータル ハンドオフ
# 最終更新: 2026/05/01

## プロジェクト基本情報
- GitHub: ikebe-kat/worldclub-portal
- Vercel: https://worldclub-portal.vercel.app
- Supabase: pktqlbpdjemmomfanvgt（KATと同じプロジェクト、company_idで分離）
- company_id: c2d368f0-aa9b-4f70-b082-43ec07723d6c
- store_id: 06027f43-fa49-4b2e-8009-903456b0ce33
- テーマカラー: #1a4b24
- デスクトップPC: C:\Users\DL-42\Dropbox\project\worldclub-portal

## 社員CD体系
- 管理者: W02（桑原啓輔）、W49（岩永）、W67（池邉）
- 一般社員: WC001〜WC017（WC+3桁）
- シフト管理者: WC001（小川）のみ
- 本部メンバー（シフト管理画面に表示しない）: W02、W49、W67

## 完了済み機能
- 箱作り（テーマカラー・会社情報・company_id設定）
- ログイン（employee_pinsテーブル対応 2026/05/01修正済み）
- portalLoading読み込み中バグ修正（2026/05/01修正済み）
- シフト管理画面（ShiftSub.tsx）基本実装
  - 縦軸=従業員名、横軸=日付の一覧表
  - 公休申請の承認/差し戻し
  - 管理者による直接公休ON/OFF
  - 確定ボタンでattendance_dailyに一括書き込み
  - 本部メンバー非表示
  - 半日概念なし（全日のみ）
  - 休日出勤・代休・半日代休を削除済み

## シフト管理システム仕様（確定）
### 従業員側
- カレンダーの日付タップ→「公休申請」選択→leave_requestsに保存（status=pending）
- 申請中=黄色バッジ、承認後=緑の公休、差し戻し=通知+バッジ消える
- 有給・公休ともに全日のみ

### 管理者側（小川WC001のみ）
- 縦軸=従業員名（苗字）、横軸=1ヶ月の日付
- 色分け：緑=公休確定、黄=申請中、青=有給、赤=差し戻し、灰=出勤
- 黄色セルタップ→承認/差し戻しポップアップ
- 空きセルタップ→直接公休ON/OFF
- 確定ボタン→attendance_dailyに一括upsert
- 未承認件数バッジ表示
- 月選択（◀▶）
- 土日背景色区別

### データ構造
- 公休申請: leave_requests（type='shift_koukyuu', status='pending'/'approved'/'returned'）
- 確定後: attendance_daily（reason='公休（全日）'）

## 勤怠ロジック（確定済み）
- 正社員定時: 10:00-19:00（実働8時間、休憩1時間）
- 残業手当なし（基本給に含む）
- 遅刻・早退は定時との差で記録
- パート: 個別シフト時間、休憩60分固定、8時間超=1.25倍、8時間以下=1.0倍、1分単位
- 打刻丸め: 出勤15分切り上げ、退勤15分切り捨て（KATと同じ）
- 締め日: 毎月20日（21日〜翌月20日）
- 打刻漏れアラート: 翌朝9:10

## パート時給一覧
- 小澤直美(WC005): 平日1,150円、土日1,250円、交通費120円
- 増田彩華(WC006): 平日1,400円、土日1,500円、交通費520円
- 小池眞加(WC007): 平日1,500円、土日1,600円、交通費240円
- 島寄裕子(WC008): 平日1,300円、土日1,400円、交通費128円
- 加藤知子(WC009): 平日1,300円、土日1,400円、交通費160円
- 南亜矢子(WC010): 平日1,450円、土日1,550円、交通費0円
- 新田真弓(WC011): 平日1,300円、土日1,400円、交通費0円
- 秋田奈津季(WC012): 平日1,150円、土日1,250円、交通費140円
- 中嶋亜紀(WC013): 平日1,150円、土日1,250円、交通費460円
- 小寺慎一(WC014): 平日1,150円、土日1,250円、交通費900円
- 松浦潤子(WC015): 平日1,450円、土日1,450円
- 塚田(WC016): 平日1,250円、土日1,350円

## 未完了タスク（次にやること）
1. 勤怠ロジックトリガー（KATのtrg_01/02/03とは別名で新規作成）
2. 給与計算ロジック
3. Edge Function（send-push-worldclub）
4. pg_cronバッチ（打刻漏れアラート翌朝9:10、カレンダー通知）
5. 動作確認（打刻・出勤簿・シフト申請→承認フロー）

## 絶対ルール
- KATのtrg_01/02/03は絶対に触るな
- 有給・公休は全日のみ（半日の概念なし）
- 本部メンバー（W02/W49/W67）はシフト管理画面に表示しない
- 仮データを勝手に入れるな
- 会社名は「ワールドクラブ」（桑原=クワバラ、クワハラは間違い）

---

## 【2026/05/02 重大インシデント】Supabase Proプラン移行ミスで全社システム停止

### 事象
- KATポータル・明石ポータルが全ページデータ表示されず、全社員から打刻不可のクレーム殺到
- 約1時間全社のシステムが使用不可能になった

### 真因
- SupabaseをProプランにアップグレードした際、Compute SizeがNanoのまま放置されていた
- Proプラン=$25/月にはMicro Computeが含まれるが、手動でCompute and DiskからNano→Microへの切り替えが必要だった
- この事実をClaudeが把握しておらず、池邉さんに案内しなかった

### 誤った対応で悪化させた
- フロントコードのバグだと思い込み、PunchTab・secureApi・home/page.tsxを何度もrevert・修正
- fetchに15秒タイムアウトを追加→全データ表示されなくなった
- タイムアウトを60秒に変更→意味なし
- 原因不明のまま推測修正を繰り返し、状況をさらに悪化させた
- 「Supabase側のせいにするな」と言われるまでサーバー側の確認を池邉さんに求め続けた

### 教訓
1. Supabaseプラン変更時はCompute and Diskも必ず確認・アップグレードしろ
2. 原因不明のままコードを修正するな。推測修正は事故を拡大する
3. 全アプリが同時に遅い=共通インフラ（DB/Supabase）の問題。フロントコードではない
4. 「5分で直せるバグがなぜ起きる」→知識不足で防げたことを防がなかったClaudeの責任

---

## 【2026/05/09 重大インシデント】環境変数を勝手に変更するな

### 事象
- Claudeがワールドクラブの通知バグ修正中に、確認なくVercelのProduction環境変数にSUPABASE_SERVICE_ROLE_KEYを勝手に追加した
- .env.localにもservice_role keyを勝手に追加した
- 池邉さんに一切の事前確認をしなかった

### 教訓
1. 環境変数（Vercel環境変数・.env.local・Supabase設定）を勝手に追加・変更・削除するな
2. 環境変数に関わる操作は全て「〜を追加してよいですか？」と事前確認してから実行しろ
3. コードの修正指示があっても、環境変数の変更が伴う場合は別途確認しろ
4. 本番環境に影響する設定変更を無断で行うな。確認を取るコストはゼロ、事故のコストは無限大

---

## 【絶対ルール】松浦さん（WC015）の休憩時間

### 事実
- 松浦さんだけ休憩40分（wc_payroll_settings.break_minutes_fixed=40）
- 他のWCパートは一律60分（break_minutes_fixedがNULL→self_reported使用）

### トリガー仕様（wc_trg_99_calc_attendance_daily → wc_fn_calc_attendance_daily）
- wc_payroll_settingsのbreak_minutes_fixedを参照して休憩分を決定する
- break_minutes_fixedがNOT NULLならその値を使用（松浦=40）
- NULLならbreak_minutes_self_reportedを使用

### 再発防止ルール
- 松浦さんの休憩を60分にするバグが何度も再発している。絶対に再発させるな
- wc_fn_calc_attendance_dailyを修正する場合、必ずbreak_minutes_fixedの参照ロジックを維持すること
- paid_leave_grants等への書き込み時にトリガーが再発火してbreak_minutesを上書きするリスクがある
- WCのattendance_dailyに対するINSERT/UPDATEを行う際は、必ず松浦さんの休憩が40分のままか確認すること
- 確認SQL: `SELECT attendance_date, break_minutes FROM attendance_daily WHERE employee_id = (SELECT id FROM employees WHERE employee_code = 'WC015' AND company_id = 'c2d368f0-aa9b-4f70-b082-43ec07723d6c') AND attendance_date >= '2026-05-01' ORDER BY attendance_date;`
