## 通知システム設定（2026/04/08確定）

### 通知の仕組み
- カレンダー予定登録・編集・削除: DBトリガー trg_calendar_push → notify_calendar_event() → send-push
- 朝9:00カレンダー通知: pg_cron job10（morning-calendar-notify）
- 朝9:10打刻漏れ: pg_cron job11（attendance-alert-notify）
- 予定10分前アラート: pg_cron job9（notify-upcoming-events）
- 休暇事由登録・削除: AttendanceTab.tsxから直接send-pushを呼ぶ

### 通知が来なくなったときのチェックリスト
1. SQL: SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 3; で401が出たらキー切れ
2. SQL: SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'custom_events'::regclass; でtrg_calendar_pushが0なら ALTER TABLE custom_events ENABLE TRIGGER trg_calendar_push;
3. pg_cronのjob9・10・11が動いているかcron.job_run_detailsで確認

### ⚠️ 絶対ルール
- DBトリガー関数はservice_role keyをハードコード（current_settingは使わない）
- pg_cronはインラインSQL形式のみ（関数呼び出し形式は実行ログが残らない）
- キー切れ時はkat-kintai-appのCLAUDE.mdのチェックリストに従って更新
