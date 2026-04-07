// ═══════════════════════════════════════════
// components/ui/index.tsx — 共通UIパーツ
//   Avatar / Badge / ReasonBadges / Dot
// ═══════════════════════════════════════════
import React, { CSSProperties } from "react";
import { T } from "@/lib/constants";

// ── Avatar ──────────────────────────────────
interface AvatarProps {
  name: string;
  size?: number;
  style?: CSSProperties;
}
export const Avatar = ({ name, size = 64, style: s = {} }: AvatarProps) => {
  const colors = [T.primary, "#E9528E", "#00A37B", "#EE7959", "#7484C1"];
  const bg = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        backgroundColor: bg, display: "flex", alignItems: "center",
        justifyContent: "center", color: "#fff", fontWeight: 700,
        fontSize: size * 0.32, flexShrink: 0, ...s,
      }}
    >
      {name.replace(/\s/g, "").slice(0, 2)}
    </div>
  );
};

// ── Badge ────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  style?: CSSProperties;
}
export const Badge = ({
  children,
  color = "#fff",
  bg = T.primary,
  style: s = {},
}: BadgeProps) => (
  <span
    style={{
      display: "inline-block", padding: "2px 10px",
      borderRadius: "3px", fontSize: 11, fontWeight: 600,
      lineHeight: "18px", color, backgroundColor: bg,
      whiteSpace: "nowrap", ...s,
    }}
  >
    {children}
  </span>
);

// ── ReasonBadges ─────────────────────────────
interface ReasonBadgesProps {
  reason: string | null;
}
export const ReasonBadges = ({ reason }: ReasonBadgesProps) => {
  if (!reason) return null;
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {reason.split("+").map((p, i) => {
        const t = p.trim();
        let bg: string = T.textMuted;
        if      (t.includes("有給"))                                    bg = T.yukyuBlue;
        else if (t === "公休申請中")                                    bg = T.kibouYellow;
        else if (t === "公休差し戻し")                                  bg = T.holidayRed;
        else if (t === "公休" || t.includes("公休（") || t.includes("午前公休") || t.includes("午後公休")) bg = T.primary;
        else if (t.includes("希望休"))                                  bg = T.kibouYellow;
        else if (["出張","休日出勤","代休"].some((k) => t.includes(k))) bg = T.kinmuGreen;
        else if (t === "欠勤")                                          bg = "#6B7280";
        return (
          <Badge key={i} bg={bg} color={t.includes("希望休") ? "#78350F" : "#fff"}>
            {t}
          </Badge>
        );
      })}
    </div>
  );
};

// ── Dot（セクション見出しドット） ───────────
interface DotProps {
  color: string;
  label: string;
}
export const Dot = ({ color, label }: DotProps) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
    <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />
    <span style={{ fontSize: 13, fontWeight: 600, color: T.textSec }}>{label}</span>
  </div>
);

// ── GeoBackground（背景ジオメトリックライン） ─
export const GeoBackground = () => (
  <div
    style={{
      position: "fixed", inset: 0, pointerEvents: "none",
      zIndex: 0, overflow: "hidden",
    }}
  >
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMaxYMax slice"
      style={{ position: "absolute", right: 0, bottom: 0, opacity: 0.035 }}
    >
      <polyline points="100,700 180,520 260,620 340,400 420,550 500,300" fill="none" stroke="#00AFCC" strokeWidth="4"/>
      <polyline points="130,750 210,580 290,680 370,460 450,600 530,380" fill="none" stroke="#E9528E" strokeWidth="3"/>
      <polyline points="80,650 160,480 240,580 320,360 400,500 480,260" fill="none" stroke="#EFE200" strokeWidth="3"/>
      <polyline points="150,720 230,540 310,640 390,420 470,560"         fill="none" stroke="#00A37B" strokeWidth="2.5"/>
      <polyline points="60,600 140,440 220,540 300,320 380,460 460,220"  fill="none" stroke="#EE7959" strokeWidth="2"/>
      <polygon  points="300,650 360,520 420,650"                          fill="none" stroke="#7484C1" strokeWidth="3"/>
      <polygon  points="450,550 490,440 530,550"                          fill="none" stroke="#00AFCC" strokeWidth="2.5"/>
    </svg>
  </div>
);
