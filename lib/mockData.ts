// ═══════════════════════════════════════════
// モックデータ — Phase 2でSupabase接続後に削除
// ═══════════════════════════════════════════
import type { Employee, AttendanceRow, CalEvent, Document } from "./types";

export const EMPLOYEES: Employee[] = [
  { id:1,  cd:"001", name:"桑原 啓輔",   kana:"クワバラ ケイスケ", store:"kengun",     role:"代表取締役",   gender:"男性", birthday:"1985-04-15", hire:"2015-06-01", type:"正社員C", grade:"S",  email:"kuwabara@katworld-hd.com",   phone:"090-1234-5678", skills:"普通自動車免許, 損害保険募集人",         perm:"super" },
  { id:2,  cd:"002", name:"桑原 啓彰",   kana:"クワバラ ヒロアキ", store:"kengun",     role:"専務取締役",   gender:"男性", birthday:"1988-08-22", hire:"2017-04-01", type:"正社員C", grade:"A",  email:"h-kuwabara@katworld-hd.com",  phone:"090-2345-6789", skills:"普通自動車免許",                          perm:"super" },
  { id:3,  cd:"003", name:"池邉 遊貴",   kana:"イケベ ユウキ",    store:"gyomu",      role:"人事総務",     gender:"女性", birthday:"1993-01-14", hire:"2023-11-01", type:"正社員C", grade:"B",  email:"jinji@katworld-hd.com",       phone:"090-3456-7890", skills:"普通自動車免許, ITパスポート, GAS開発",   perm:"super" },
  { id:4,  cd:"004", name:"山口 夕絹乃", kana:"ヤマグチ ユキノ",  store:"kengun",     role:"店長",         gender:"女性", birthday:"1990-07-03", hire:"2019-04-01", type:"正社員C", grade:"A",  email:"yamaguchi@suzuki-arena.com",  phone:"090-4567-8901", skills:"普通自動車免許, 損害保険募集人",         perm:"admin" },
  { id:5,  cd:"005", name:"吉田 政和",   kana:"ヨシダ マサカズ",  store:"yatsushiro", role:"店長",         gender:"男性", birthday:"1987-11-20", hire:"2018-09-01", type:"正社員C", grade:"A",  email:"yoshida@suzuki-arena.com",    phone:"090-5678-9012", skills:"普通自動車免許, 整備士2級",             perm:"admin" },
  { id:6,  cd:"006", name:"近藤 大翼",   kana:"コンドウ タイスケ",store:"ozu",        role:"本部長兼店長", gender:"男性", birthday:"1986-03-10", hire:"2016-06-01", type:"正社員C", grade:"S",  email:"kondo@suzuki-arena.com",      phone:"090-6789-0123", skills:"普通自動車免許, 損害保険募集人",         perm:"admin" },
  { id:7,  cd:"007", name:"渡邉 謙太郎", kana:"ワタナベ ケンタロウ",store:"kengun",   role:"営業",         gender:"男性", birthday:"1995-05-28", hire:"2022-04-01", type:"正社員C", grade:"B",  email:"watanabe@suzuki-arena.com",   phone:"090-7890-1234", skills:"普通自動車免許",                          perm:"employee" },
  { id:8,  cd:"008", name:"中野 太郎",   kana:"ナカノ タロウ",    store:"kengun",     role:"鈑金塗装",     gender:"男性", birthday:"1992-09-15", hire:"2020-07-01", type:"正社員C", grade:"B",  email:"nakano@katworld-hd.com",      phone:"090-8901-2345", skills:"鈑金塗装技能士2級",                      perm:"employee" },
  { id:9,  cd:"009", name:"鳥巣 健一",   kana:"トリス ケンイチ",  store:"gyomu",      role:"DX推進",       gender:"男性", birthday:"1991-12-05", hire:"2024-01-15", type:"正社員C", grade:"B",  email:"torisu@katworld-hd.com",      phone:"090-9012-3456", skills:"基本情報技術者, AWS SAA",               perm:"employee" },
  { id:10, cd:"010", name:"高倉 美咲",   kana:"タカクラ ミサキ",  store:"kengun",     role:"フロント",     gender:"女性", birthday:"1998-06-18", hire:"2023-04-01", type:"パート",  grade:"-",  email:"",                            phone:"090-0123-4567", skills:"普通自動車免許",                          perm:"employee" },
  { id:11, cd:"011", name:"湯野 花子",   kana:"ユノ ハナコ",      store:"ozu",        role:"フロント",     gender:"女性", birthday:"1996-02-14", hire:"2022-10-01", type:"パート",  grade:"-",  email:"",                            phone:"080-1234-5678", skills:"",                                        perm:"employee" },
  { id:12, cd:"012", name:"川越 誠",     kana:"カワゴエ マコト",  store:"kengun",     role:"インシュアランス",gender:"男性",birthday:"1989-10-30",hire:"2019-01-15",  type:"正社員C", grade:"B",  email:"kawagoe@suzuki-arena.com",    phone:"090-1111-2222", skills:"損害保険募集人, 生命保険募集人",         perm:"employee" },
];

/** ログイン中ユーザー（池邉） — Supabase Auth導入後にセッションから取得 */
export const ME: Employee = EMPLOYEES[2];

/** ダミー勤怠データ生成 */
export function genAtt(yr: number, mo: number): AttendanceRow[] {
  const days = new Date(yr, mo, 0).getDate();
  const rows: AttendanceRow[] = [];
  const rr: (string | null)[] = [
    null, null, null, null, null, null,
    "有給（全日）", "希望休（全日）", "午前有給+出張", "出張", "欠勤", "希望休（全日）",
  ];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(yr, mo - 1, d);
    const dow = dt.getDay();
    const off = dow === 0 || dow === 3;
    const reason = off ? "公休" : rr[Math.floor(Math.random() * rr.length)];
    const hw = !off && !["有給（全日）","希望休（全日）","欠勤","公休"].includes(reason ?? "");
    const pi = hw ? `09:${String(25 + Math.floor(Math.random() * 8)).padStart(2, "0")}` : null;
    const po = hw ? `18:${String(Math.floor(Math.random() * 20)).padStart(2, "0")}` : null;
    const wm = hw
      ? (parseInt(po!.split(":")[0]) * 60 + parseInt(po!.split(":")[1]))
        - (parseInt(pi!.split(":")[0]) * 60 + parseInt(pi!.split(":")[1])) - 60
      : 0;
    rows.push({ day: d, dow, pi, po, reason: reason ?? null, wm, diff: hw ? wm - 450 : 0, off });
  }
  return rows;
}

/** ダミーカレンダーイベント生成 */
export function genEvents(): CalEvent[] {
  return [
    { id:1, title:"月次ミーティング",   start:5,  end:5,  color:"#17a2b8", creator:"桑原 啓輔", allDay:true,  repeat:"monthly" },
    { id:2, title:"新車展示会準備",      start:12, end:13, color:"#0d8bf2", creator:"近藤 大翼", allDay:true,  repeat:"none"    },
    { id:3, title:"安全衛生委員会",      start:15, end:15, color:"#2dc653", creator:"池邉 遊貴", allDay:true,  repeat:"monthly" },
    { id:4, title:"K2service打合せ",     start:18, end:18, color:"#8b5cf6", creator:"桑原 啓輔", allDay:false, time:"14:00〜16:00", repeat:"none" },
    { id:5, title:"鈑金塗装部研修",      start:22, end:22, color:"#f59e0b", creator:"中野 太郎", allDay:true,  repeat:"none"    },
    { id:6, title:"給与計算締め",        start:25, end:25, color:"#ef4444", creator:"池邉 遊貴", allDay:true,  repeat:"monthly" },
  ];
}

/** ダミー書類データ */
export const MOCK_DOCS: Document[] = [
  { id:1, name:"令和7年度 源泉徴収票.pdf",   cat:"源泉徴収票", date:"2026/01/20", ok:true  },
  { id:2, name:"2026年3月 給与明細.pdf",      cat:"給与明細",   date:"2026/03/25", ok:false },
  { id:3, name:"就業規則（改定版）.pdf",      cat:"その他",     date:"2026/03/01", ok:true  },
  { id:4, name:"2026年2月 給与明細.pdf",      cat:"給与明細",   date:"2026/02/25", ok:true  },
];
