"use client";
import type { CSSProperties } from "react";

/**
 * Grizz — Creed's handyman-bear mascot. Pure inline SVG (no images), so it
 * scales crisply at ~zero cost. Three poses; the wave pose animates only the
 * right-arm group (pinned at the shoulder via transform-box:view-box). Colors:
 * brown fur #5f452c, blue shirt #2E75B6, red beanie #e2342f/#b5251f, navy
 * hammer #1d4e7d. Used only in onboarding (welcome / setup / done) for now.
 */
export type GrizzPose = "wave" | "point" | "cheer";

const FUR = "#5f452c";

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
    <circle cx="49" cy="67" r="3.6" fill="#23252c" /><circle cx="71" cy="67" r="3.6" fill="#23252c" />
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

export default function Grizz({
  pose,
  size = 166,
  bob = false,
  style,
}: {
  pose: GrizzPose;
  size?: number;
  bob?: boolean;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 130 170"
      width={size}
      height={Math.round(size * (170 / 130))}
      className={bob ? "grizz-bob" : undefined}
      style={style}
      role="img"
      aria-label="Grizz the handyman bear"
    >
      <style>{`
        .grizz-armw{transform-box:view-box;transform-origin:80px 110px;animation:grizzWave 1.6s ease-in-out infinite}
        @keyframes grizzWave{0%,100%{transform:rotate(0)}25%{transform:rotate(-16deg)}50%{transform:rotate(6deg)}75%{transform:rotate(-9deg)}}
        .grizz-bob{animation:grizzBob 3.2s ease-in-out infinite}
        @keyframes grizzBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @media (prefers-reduced-motion:reduce){.grizz-armw,.grizz-bob{animation:none}}
      `}</style>

      {pose === "wave" && (
        <>
          {ears}{body}{leftArmRest}
          <g transform="translate(31 96) scale(.8)">{HAMMER}</g>
          <g className="grizz-armw">
            <path d="M80 110 Q94 90 100 76" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
            <circle cx="100" cy="74" r="8" fill={FUR} />
          </g>
          {head}{faceNeutral}{beanie}
        </>
      )}

      {pose === "point" && (
        <>
          {ears}{body}{leftArmRest}
          <g transform="translate(31 96) scale(.8)">{HAMMER}</g>
          <path d="M82 114 Q98 110 110 108" stroke={FUR} strokeWidth="13" fill="none" strokeLinecap="round" />
          <circle cx="110" cy="108" r="7.5" fill={FUR} />
          {head}{faceNeutral}{beanie}
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
          {head}{faceHappy}{beanie}
        </>
      )}
    </svg>
  );
}
