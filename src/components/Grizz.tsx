"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "@/lib/i18n";

/**
 * Grizz — Creed's handyman-bear mascot. Pure inline SVG (no images), so it
 * scales crisply at ~zero cost. Three poses; the wave pose animates only the
 * right-arm group (pinned at the shoulder via transform-box:view-box). Colors:
 * brown fur #5f452c, blue shirt #2E75B6, red beanie #e2342f/#b5251f, navy
 * hammer #1d4e7d. He blinks on his own, and with `chatty` he's tappable: a hop,
 * a grin and a one-liner from the `grizz.quip*` pool (a few too many taps and
 * he gets grumpy — `grizz.annoyed*`).
 */
export type GrizzPose = "wave" | "point" | "cheer";

const FUR = "#5f452c";

const QUIPS = 12;
const ANNOYED = 3;
const ANNOYED_EVERY = 7;

const HAMMER = (
  <>
    <rect x="-6" y="0" width="24" height="11" rx="3" fill="#aab2c0" />
    <rect x="-6" y="0" width="24" height="4" rx="2" fill="#c8cfda" />
    <path d="M14 0 q9 1 9 6 q-1 6 -8 6 l0 -3.4 q4 0 4 -2.6 q0 -3 -5 -3 z" fill="#8b94a3" />
    <rect x="2.5" y="9" width="8" height="44" rx="4" fill="#1d4e7d" />
    <rect x="4.4" y="12" width="2.4" height="38" rx="1.2" fill="#6aa9f0" />
  </>
);

const ears = (
  <>
    <circle cx="34" cy="50" r="11" fill={FUR} /><circle cx="34" cy="51" r="5" fill="#8a6a45" />
    <circle cx="86" cy="50" r="11" fill={FUR} /><circle cx="86" cy="51" r="5" fill="#8a6a45" />
  </>
);
const body = (
  <>
    <rect x="37" y="106" width="46" height="48" rx="15" fill="#2E75B6" />
    <rect x="50" y="106" width="20" height="22" fill="#245f96" />
  </>
);
const head = (
  <>
    <circle cx="60" cy="70" r="31" fill={FUR} />
    <ellipse cx="60" cy="82" rx="17" ry="13" fill="#c9a877" />
  </>
);
const beanie = (
  <>
    <path d="M31 55 Q60 20 89 55 L89 57 L31 57Z" fill="#e2342f" />
    <rect x="29" y="54" width="62" height="9.5" rx="4.5" fill="#b5251f" />
  </>
);
// Eyes sit BELOW the beanie band — don't raise them or the hat clips them.
const faceNeutral = (
  <>
    <g className="grizz-eyes">
      <circle cx="49" cy="67" r="3.6" fill="#23252c" /><circle cx="71" cy="67" r="3.6" fill="#23252c" />
    </g>
    <ellipse cx="60" cy="76" rx="5.5" ry="4" fill="#2a1c10" />
    <path d="M60 80 L60 84 M52 87 Q60 93 68 87" stroke="#2a1c10" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </>
);
const faceHappy = (
  <>
    <path d="M45 68 Q49 64 53 68" stroke="#23252c" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M67 68 Q71 64 75 68" stroke="#23252c" strokeWidth="3" fill="none" strokeLinecap="round" />
    <ellipse cx="60" cy="78" rx="5.5" ry="4" fill="#2a1c10" />
    <path d="M51 84 Q60 92 69 84" stroke="#2a1c10" strokeWidth="3" fill="none" strokeLinecap="round" />
  </>
);
const leftArmRest = (
  <>
    <rect x="28" y="110" width="13" height="30" rx="6.5" fill={FUR} />
    <circle cx="34.5" cy="140" r="7" fill={FUR} />
  </>
);

/** Head-only Grizz for small spots — the marker on AI notes and headers (12–24
 *  px), where the full body would be an unreadable smudge. Static (no blink,
 *  no hop): it sits next to text the user is reading. */
export function GrizzFace({ size = 16, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="22 30 76 76"
      width={size}
      height={size}
      role="img"
      aria-label="Grizz"
      style={{ display: "inline-block", flexShrink: 0, ...style }}
    >
      {ears}{head}{faceNeutral}{beanie}
    </svg>
  );
}

export default function Grizz({
  pose,
  size = 166,
  bob = false,
  chatty = false,
  bubbleAlign = "center",
  style,
}: {
  pose: GrizzPose;
  size?: number;
  bob?: boolean;
  /** Tap him for a hop + a one-liner. */
  chatty?: boolean;
  /** Which edge of Grizz the speech bubble hugs (use "left" near the left screen edge). */
  bubbleAlign?: "left" | "center" | "right";
  style?: CSSProperties;
}) {
  const [hop, setHop] = useState(0); // bumps every tap to restart the CSS animation
  const [line, setLine] = useState<string | null>(null);
  const taps = useRef(0);
  const lastQuip = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const poke = () => {
    taps.current += 1;
    let text: string;
    if (taps.current % ANNOYED_EVERY === 0) {
      text = t(`grizz.annoyed${1 + Math.floor(Math.random() * ANNOYED)}`);
    } else {
      let n = lastQuip.current;
      while (n === lastQuip.current) n = Math.floor(Math.random() * QUIPS);
      lastQuip.current = n;
      text = t(`grizz.quip${n + 1}`);
    }
    setLine(text);
    setHop((h) => h + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLine(null), 3600);
  };

  const grin = chatty && line !== null;
  const face = (p: GrizzPose) => (p === "cheer" || grin ? faceHappy : faceNeutral);

  const svg = (
    <svg
      viewBox="0 0 130 170"
      width={size}
      height={Math.round(size * (170 / 130))}
      className={bob ? "grizz-bob" : undefined}
      style={chatty ? { display: "block", overflow: "visible" } : style}
      role={chatty ? undefined : "img"}
      aria-label={chatty ? undefined : "Grizz the handyman bear"}
      aria-hidden={chatty ? true : undefined}
    >
      <style>{`
        .grizz-armw{transform-box:view-box;transform-origin:80px 110px;animation:grizzWave 1.6s ease-in-out infinite}
        @keyframes grizzWave{0%,100%{transform:rotate(0)}25%{transform:rotate(-16deg)}50%{transform:rotate(6deg)}75%{transform:rotate(-9deg)}}
        .grizz-bob{animation:grizzBob 3.2s ease-in-out infinite}
        @keyframes grizzBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        .grizz-eyes{transform-box:fill-box;transform-origin:center;animation:grizzBlink 5.2s infinite}
        @keyframes grizzBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
        .grizz-hop{transform-box:view-box;transform-origin:65px 154px;animation:grizzHop .5s cubic-bezier(.3,1.6,.5,1)}
        @keyframes grizzHop{0%{transform:scale(1.08,.9)}35%{transform:translateY(-12px) rotate(-5deg) scale(.96,1.05)}65%{transform:translateY(-3px) rotate(4deg)}100%{transform:none}}
        @media (prefers-reduced-motion:reduce){.grizz-armw,.grizz-bob,.grizz-eyes,.grizz-hop{animation:none}}
      `}</style>

      <g key={hop} className={chatty && hop > 0 ? "grizz-hop" : undefined}>
      {pose === "wave" && (
        <>
          {ears}{body}{leftArmRest}
          <g transform="translate(31 96) scale(.8)">{HAMMER}</g>
          <g className="grizz-armw">
            <path d="M80 110 Q94 90 100 76" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
            <circle cx="100" cy="74" r="8" fill={FUR} />
          </g>
          {head}{face(pose)}{beanie}
        </>
      )}

      {pose === "point" && (
        <>
          {ears}{body}{leftArmRest}
          <g transform="translate(31 96) scale(.8)">{HAMMER}</g>
          <path d="M82 114 Q98 110 110 108" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
          <circle cx="110" cy="108" r="7.5" fill={FUR} />
          {head}{face(pose)}{beanie}
        </>
      )}

      {pose === "cheer" && (
        <>
          {ears}{body}
          <path d="M40 112 Q30 94 26 80" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
          <circle cx="26" cy="80" r="7.5" fill={FUR} />
          <path d="M80 112 Q92 94 98 80" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
          <g transform="translate(92 36) scale(.85)">{HAMMER}</g>
          <circle cx="98" cy="80" r="7.5" fill={FUR} />
          {head}{face(pose)}{beanie}
        </>
      )}
      </g>
    </svg>
  );

  if (!chatty) return svg;

  const edge: CSSProperties =
    bubbleAlign === "left" ? { left: 0 } : bubbleAlign === "right" ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Grizz the handyman bear — tap to chat"
      onClick={poke}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } }}
      style={{ position: "relative", display: "block", width: size, cursor: "pointer", WebkitTapHighlightColor: "transparent", outline: "none", ...style }}
    >
      {line && (
        <span
          role="status"
          className="grizz-say"
          style={{
            position: "absolute", bottom: "92%", zIndex: 5, width: "max-content", maxWidth: 210,
            padding: "8px 11px", borderRadius: 12, textAlign: "left",
            background: "#fff", color: "#1a1a22", fontSize: 12.5, lineHeight: 1.35, fontWeight: 600,
            boxShadow: "0 8px 22px -8px rgba(0,0,0,.6)", pointerEvents: "none",
            ...edge,
          }}
        >
          <style>{`.grizz-say{animation:grizzSay .22s ease-out both}@keyframes grizzSay{from{opacity:0;margin-bottom:-6px}to{opacity:1;margin-bottom:0}}@media (prefers-reduced-motion:reduce){.grizz-say{animation:none}}`}</style>
          {line}
        </span>
      )}
      {svg}
    </span>
  );
}
