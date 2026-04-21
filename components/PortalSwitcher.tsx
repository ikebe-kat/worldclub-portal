"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type PortalItem = {
  key: string;
  label: string;
  shortLabel: string;
  logo: string | null;
  url: string;
  companyId: string | null;
  color: string;
  current: boolean;
};

const PORTAL_DEFS: Omit<PortalItem, "current">[] = [
  { key: "kat", label: "KAT WORLD", shortLabel: "KAT", logo: "/KAT_logo_-05.png", url: "https://kat-kintai-app.vercel.app/portal", companyId: "a653846d-3add-47ab-beb8-230a97f2c53e", color: "#06b6d4" },
  { key: "akashi", label: "ダイハツ明石西", shortLabel: "明石", logo: "/daihatsu_logo.png", url: "https://akashi-portal.vercel.app", companyId: "e85e40ac-71f7-4918-b2fc-36d877337b74", color: "#e96d96" },
  { key: "wc", label: "ワールドクラブ", shortLabel: "WC", logo: "/worldclub-logo.png", url: "/home", companyId: "c2d368f0-aa9b-4f70-b082-43ec07723d6c", color: "#1a4b24" },
  { key: "dashboard", label: "実績管理", shortLabel: "実績", logo: "/icons/dashboard.png", url: "https://kat-dashboard-app.vercel.app/dashboard", companyId: null, color: "#f59e0b" },
];

const ACCESS_MAP: Record<string, string[]> = {
  "W02": ["kat", "akashi", "wc", "dashboard"],
  "W67": ["kat", "akashi", "wc", "dashboard"],
  "W18": ["kat", "akashi"],
  "W49": ["kat", "akashi", "wc"],
  "W03": ["kat", "dashboard"],
};

function getPortals(employeeCode: string): PortalItem[] | null {
  const keys = ACCESS_MAP[employeeCode];
  if (!keys) return null;
  return PORTAL_DEFS
    .filter((p) => keys.includes(p.key))
    .map((p) => ({ ...p, current: p.key === "wc" }));
}

function PortalIcon({ item, size }: { item: PortalItem; size: number }) {
  const imgSize = Math.round(size * 0.55);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: item.current ? `${item.color}18` : "#fff",
        border: item.current ? `2px solid ${item.color}` : "1.5px solid #e0e0e0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {item.logo ? (
        <img src={item.logo} alt={item.label} style={{ width: imgSize, height: imgSize, objectFit: "contain" }} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.28), fontWeight: 700, color: item.color }}>{item.shortLabel}</span>
      )}
    </div>
  );
}

export default function PortalSwitcher({ employee }: { employee: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const employeeCode = employee?.employee_code || "";
  const portals = getPortals(employeeCode);

  useEffect(() => {
    if (!portals) return;

    const applyPadding = () => {
      if (window.innerWidth >= 769) {
        document.body.style.paddingLeft = "50px";
      } else {
        document.body.style.paddingLeft = "";
      }
    };

    applyPadding();
    window.addEventListener("resize", applyPadding);
    return () => {
      window.removeEventListener("resize", applyPadding);
      document.body.style.paddingLeft = "";
    };
  }, [!!portals]);

  if (!portals) return null;

  const navigate = (item: PortalItem) => {
    if (item.current) return;
    if (item.key === "dashboard") {
      window.location.href = item.url + "?ec=" + encodeURIComponent(employeeCode);
      return;
    }
    if (item.url.startsWith("http")) {
      localStorage.setItem("portal_last", item.url);
      localStorage.setItem("portal_token", JSON.stringify({
        portal_group_id: employee.portal_group_id,
        target_company_id: item.companyId,
        from: "worldclub-portal",
        ts: Date.now(),
      }));
      const pg = encodeURIComponent(employee.portal_group_id || "");
      window.location.href = item.url + "?portal_token=" + pg;
    } else {
      localStorage.setItem("portal_last", item.url);
      router.push(item.url);
    }
  };

  return (
    <>
      {/* PC: 左サイドバー */}
      <div
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: 50,
          background: "#f8f9fa",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 0,
          gap: 8,
          zIndex: 200,
        }}
        className="portal-switcher-pc"
      >
        {portals.map((p) => (
          <button
            key={p.key}
            onClick={() => navigate(p)}
            title={p.label}
            style={{
              background: "none",
              border: "none",
              cursor: p.current ? "default" : "pointer",
              padding: 3,
              opacity: p.current ? 1 : 0.7,
              transition: "opacity 0.15s",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
            onMouseEnter={(e) => { if (!p.current) e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { if (!p.current) e.currentTarget.style.opacity = "0.7"; }}
          >
            <PortalIcon item={p} size={36} />
            <span style={{ fontSize: 8, color: p.current ? p.color : "#8e8e93", fontWeight: p.current ? 700 : 500, lineHeight: 1.1 }}>
              {p.shortLabel}
            </span>
          </button>
        ))}
      </div>

      {/* スマホ: FAB + ポップアップ */}
      <div className="portal-switcher-sp">
        {open && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 299 }}
            onClick={() => setOpen(false)}
          />
        )}
        {open && (
          <div
            style={{
              position: "fixed",
              right: 16,
              bottom: 76,
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
              padding: "12px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              zIndex: 301,
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 10, color: "#8e8e93", padding: "0 8px 4px", fontWeight: 600 }}>ポータル切替</div>
            {portals.map((p) => (
              <button
                key={p.key}
                onClick={() => { navigate(p); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 10,
                  background: p.current ? `${p.color}12` : "transparent",
                  cursor: p.current ? "default" : "pointer",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                <PortalIcon item={p} size={32} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: p.current ? 700 : 500, color: p.current ? p.color : "#1c1c1e" }}>
                    {p.label}
                  </div>
                  {p.current && <div style={{ fontSize: 10, color: p.color }}>現在のポータル</div>}
                </div>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          style={{
            position: "fixed",
            right: 16,
            bottom: 20,
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#1a4b24",
            border: "none",
            boxShadow: "0 2px 12px rgba(26,75,36,0.4)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
            transition: "transform 0.2s",
            transform: open ? "rotate(45deg)" : "none",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="5" cy="5" r="2" fill="#fff" stroke="none" />
            <circle cx="12" cy="5" r="2" fill="#fff" stroke="none" />
            <circle cx="5" cy="12" r="2" fill="#fff" stroke="none" />
            <circle cx="12" cy="12" r="2" fill="#fff" stroke="none" />
          </svg>
        </button>
      </div>

      <style>{`
        .portal-switcher-pc { display: none !important; }
        .portal-switcher-sp { display: block; }
        @media (min-width: 769px) {
          .portal-switcher-pc { display: flex !important; padding-top: 56px !important; }
          .portal-switcher-sp { display: none !important; }
        }
      `}</style>
    </>
  );
}
