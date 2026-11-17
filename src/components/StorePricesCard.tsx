"use client";
/**
 * Ops → Settings → Pricing & taxes: "Store purchase prices". How many
 * products have a store price on file and the newest purchase date, plus the
 * Import button (components/PurchasePriceImport.tsx).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import PurchasePriceImport from "./PurchasePriceImport";
import { isMissingTable } from "@/lib/material-spec-client";

export default function StorePricesCard() {
  const [info, setInfo] = useState<{ count: number; newest: string | null; missing: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { count, error } = await supabase.from("material_prices").select("id", { count: "exact", head: true });
    if (error) { setInfo({ count: 0, newest: null, missing: isMissingTable(error) }); return; }
    const { data } = await supabase.from("material_prices").select("purchased_on")
      .order("purchased_on", { ascending: false, nullsFirst: false }).limit(1);
    const newest = Array.isArray(data) && data[0] ? (data[0] as { purchased_on: string | null }).purchased_on : null;
    setInfo({ count: count || 0, newest, missing: false });
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="cd mb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h4 style={{ fontSize: 15, margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="receipt" size={15} color="var(--color-primary)" /> {t("pp.cardTitle")}
        </h4>
        {info && !info.missing && (
          <button className="bo" onClick={() => setOpen(true)} style={{ width: "auto", fontSize: 13.5, padding: "5px 10px" }}>
            <Icon name="upload" size={13} /> {t("pp.import")}
          </button>
        )}
      </div>
      <p className="dim" style={{ fontSize: 13, margin: 0, lineHeight: 1.45 }}>
        {!info ? "…"
          : info.missing ? t("pp.notSetUp")
          : info.count === 0 ? t("pp.cardEmpty")
          : t("pp.cardCount").replace("{n}", String(info.count)).replace("{date}", info.newest || "—")}
      </p>
      {open && <PurchasePriceImport onClose={() => setOpen(false)} onSaved={() => void load()} />}
    </div>
  );
}
