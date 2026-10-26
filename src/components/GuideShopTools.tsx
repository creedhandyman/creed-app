"use client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import ShopItemSheet, { type ShopDraft } from "./ShopItemSheet";
import { orderShopList, type GuideShopItem } from "@/lib/guide-shop";

/**
 * The Guide's Shopping list + Tools checklist — ONE component shared by Work
 * mode (WorkVision → Guide) and the quote editor (QuoteForge → Guide), so the
 * crew and the estimator add / edit / remove materials the same way.
 *
 * Shopping: tap the box to check off; tap the name or price to open
 * ShopItemSheet (name type-ahead, −/+ qty, price each, total). Custom items
 * edit in place; a quote-derived item is "adopted" into customShop with
 * `replaces` = its key (keeps its spot, lib/guide-shop.ts) and the original
 * hidden via removedGuideShop. Checked state follows a rename.
 *
 * The parent owns the state (it lives on the job's rooms blob) and gets every
 * change as ONE patch through `onChange` — WorkVision persists it straight to
 * the job, QuoteForge keeps it until Save.
 */
export type ShopItem = GuideShopItem;
export interface GuidePatch {
  customShop?: ShopItem[];
  removedGuideShop?: string[];
  checkedShop?: string[];
  customTools?: string[];
  checkedTools?: string[];
}

/** Stable identity for a shop item (checked state survives reorders). */
export const shopKey = (s: { n: string; room?: string; trade?: string }) =>
  `${(s.n || "").toLowerCase().trim()}|||${(s.room || "").toLowerCase().trim()}|||${(s.trade || "").toLowerCase().trim()}`;

interface Props {
  guide: { shop: ShopItem[]; tools: string[] };
  customShop: ShopItem[];
  removedGuideShop: string[];
  checkedShop: string[];
  customTools: string[];
  checkedTools: string[];
  onChange: (patch: GuidePatch) => void;
  darkMode: boolean;
  /** Trade label for hand-added items (they sort to the bottom). */
  addTrade?: string;
}

export default function GuideShopTools({
  guide, customShop, removedGuideShop, checkedShop, customTools, checkedTools, onChange, darkMode,
  addTrade = "Added on site",
}: Props) {
  const border = darkMode ? "#1e1e2e" : "#eee";
  const [newTool, setNewTool] = useState("");
  // Add/edit sheet. item null = adding.
  const [shopSheet, setShopSheet] = useState<{ item: ShopItem | null } | null>(null);

  const allTools = [...guide.tools, ...customTools];
  const allShop: ShopItem[] = orderShopList(guide.shop, removedGuideShop, customShop, shopKey);
  const shopTotal = allShop.reduce((s, i) => s + (i.c || 0), 0);
  const shopRemaining = allShop.reduce((s, i) => s + (checkedShop.includes(shopKey(i)) ? 0 : i.c || 0), 0);

  const toggleTool = (tool: string) =>
    onChange({ checkedTools: checkedTools.includes(tool) ? checkedTools.filter((x) => x !== tool) : [...checkedTools, tool] });
  const toggleShop = (item: ShopItem) => {
    const key = shopKey(item);
    onChange({ checkedShop: checkedShop.includes(key) ? checkedShop.filter((k) => k !== key) : [...checkedShop, key] });
  };
  const addTool = () => {
    const tool = newTool.trim();
    setNewTool("");
    if (!tool || allTools.includes(tool)) return;
    onChange({ customTools: [...customTools, tool] });
  };
  const isCustomShop = (item: ShopItem) => customShop.some((x) => shopKey(x) === shopKey(item));
  const closeSheet = () => setShopSheet(null);
  const saveEditShop = (item: ShopItem, draft: ShopDraft) => {
    const key = shopKey(item);
    const replaces = isCustomShop(item) ? item.replaces : key;
    const updated: ShopItem = { ...draft, n: draft.n || item.n, room: item.room, trade: item.trade, ...(replaces ? { replaces } : {}) };
    const newKey = shopKey(updated);
    const nextChecked = checkedShop.includes(key) && newKey !== key
      ? [...checkedShop.filter((k) => k !== key), newKey]
      : checkedShop;
    if (isCustomShop(item)) {
      onChange({ customShop: customShop.map((x) => (shopKey(x) === key ? updated : x)), checkedShop: nextChecked });
    } else {
      onChange({ removedGuideShop: [...removedGuideShop, key], customShop: [...customShop, updated], checkedShop: nextChecked });
    }
    closeSheet();
  };
  const deleteShop = (item: ShopItem) => {
    const key = shopKey(item);
    const nextChecked = checkedShop.filter((k) => k !== key);
    if (isCustomShop(item)) onChange({ customShop: customShop.filter((x) => shopKey(x) !== key), checkedShop: nextChecked });
    else onChange({ removedGuideShop: [...removedGuideShop, key], checkedShop: nextChecked });
    closeSheet();
  };

  const box = (done: boolean): React.CSSProperties => ({
    width: 18, height: 18, borderRadius: 4, padding: 0,
    border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
    background: done ? "var(--color-success)" : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, cursor: "pointer",
  });
  const rowFade = (done: boolean): React.CSSProperties => ({
    textDecoration: done ? "line-through" : "none",
    opacity: done ? 0.5 : 1,
    transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
  });

  return (
    <div>
      {/* Shopping (materials) first, tools under it */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 15, color: "var(--color-warning)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="cart" size={14} color="var(--color-warning)" />
            {t("wv.shoppingList")} (${shopTotal.toFixed(0)})
          </h4>
          <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            ${shopRemaining.toFixed(0)} left
          </span>
        </div>
        {allShop.length === 0 && (
          <div className="dim" style={{ fontSize: 14, padding: "4px 0" }}>No shopping items.</div>
        )}
        {allShop.map((s, i) => {
          const done = checkedShop.includes(shopKey(s));
          const curTrade = s.trade || "";
          const showHeader = curTrade && curTrade !== (i > 0 ? allShop[i - 1].trade : null);
          return (
            <div key={i}>
              {showHeader && (
                <div style={{
                  fontSize: 13, fontWeight: 600, color: "var(--color-primary)",
                  marginTop: i > 0 ? 12 : 0, marginBottom: 4,
                  fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em",
                }}>
                  {curTrade}
                </div>
              )}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 15, padding: "6px 0 6px 4px", borderBottom: `1px solid ${border}`,
                ...rowFade(done),
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <button onClick={() => toggleShop(s)} aria-label={done ? "Uncheck item" : "Check off item"} style={box(done)}>
                    {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                  </button>
                  <span onClick={() => setShopSheet({ item: s })} style={{ flex: 1, minWidth: 0, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.qty && s.qty > 1 ? <b style={{ color: "var(--color-warning)", marginRight: 4 }}>{s.qty}×</b> : null}{s.n}
                  </span>
                </span>
                <span onClick={() => setShopSheet({ item: s })} style={{ color: done ? "#888" : "var(--color-success)", fontFamily: "Oswald", cursor: "pointer", flexShrink: 0, marginLeft: 8 }}>
                  ${(s.c || 0).toFixed(0)}
                </span>
              </div>
            </div>
          );
        })}
        <button
          onClick={() => setShopSheet({ item: null })}
          className="bo"
          style={{ width: "100%", marginTop: 10, padding: "10px 0", fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--color-warning)", borderColor: "rgba(255,170,0,.45)" }}
        >
          <Icon name="add" size={16} /> Add item
        </button>
      </div>

      {/* Tools */}
      <div className="cd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 15, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="hammer" size={14} color="var(--color-primary)" />
            {t("wv.toolsNeeded")} ({allTools.length})
          </h4>
          <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald", letterSpacing: ".06em" }}>
            {checkedTools.filter((x) => allTools.includes(x)).length}/{allTools.length} packed
          </span>
        </div>
        {allTools.length === 0 && (
          <div className="dim" style={{ fontSize: 14, padding: "4px 0" }}>No tools listed.</div>
        )}
        {allTools.map((tool, i) => {
          const done = checkedTools.includes(tool);
          return (
            <div
              key={i}
              onClick={() => toggleTool(tool)}
              style={{
                display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "6px 0",
                borderBottom: `1px solid ${border}`, cursor: "pointer", ...rowFade(done),
              }}
            >
              <span style={{ ...box(done), cursor: undefined }}>
                {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
              </span>
              {tool}
            </div>
          );
        })}
        <div className="row" style={{ marginTop: 8 }}>
          <input
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            placeholder="Add tool…"
            style={{ flex: 1, fontSize: 15, padding: "6px 10px" }}
            onKeyDown={(e) => { if (e.key === "Enter") addTool(); }}
          />
          <button onClick={addTool} aria-label="Add tool" style={{ background: "none", color: "var(--color-primary)", padding: "0 6px", display: "inline-flex" }}>
            <Icon name="add" size={18} />
          </button>
        </div>
      </div>

      {shopSheet && (
        <ShopItemSheet
          item={shopSheet.item}
          darkMode={darkMode}
          onClose={closeSheet}
          onDelete={shopSheet.item ? () => deleteShop(shopSheet.item!) : undefined}
          onSave={(draft) => {
            if (shopSheet.item) saveEditShop(shopSheet.item, draft);
            else { onChange({ customShop: [...customShop, { ...draft, room: "Custom", trade: addTrade }] }); closeSheet(); }
          }}
        />
      )}
    </div>
  );
}
