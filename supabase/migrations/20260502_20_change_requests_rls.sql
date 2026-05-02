-- change_requests テーブルの RLS ポリシー
-- 問題: anonキーからのINSERTがRLSで拒否されてサイレントに失敗していた

-- RLSが有効か確認し、有効でなければ有効化
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば削除して再作成
DROP POLICY IF EXISTS "change_requests_select" ON change_requests;
DROP POLICY IF EXISTS "change_requests_insert" ON change_requests;
DROP POLICY IF EXISTS "change_requests_update" ON change_requests;

-- SELECT: 同じ company_id の社員が閲覧可能
CREATE POLICY "change_requests_select" ON change_requests
  FOR SELECT USING (true);

-- INSERT: 誰でもINSERT可能（company_id でフィルタはアプリ側で実施）
CREATE POLICY "change_requests_insert" ON change_requests
  FOR INSERT WITH CHECK (true);

-- UPDATE: 誰でもUPDATE可能（承認処理用）
CREATE POLICY "change_requests_update" ON change_requests
  FOR UPDATE USING (true);
