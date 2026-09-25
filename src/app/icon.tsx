import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the NexoOmni brand mark —
// the green-ringed "eye" glyph from the wordmark logo, on white — so
// the browser tab matches the actual product identity instead of a
// generic purple square. Next.js renders this at build time and
// auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          borderRadius: 6,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 108 106" fill="none">
          <circle cx="54" cy="53" r="43" fill="none" stroke="#16bd57" strokeWidth="12" />
          <circle cx="54" cy="53" r="13" fill="#061b45" />
          <circle cx="49" cy="48" r="4" fill="#fff" />
          <path d="M21 12 Q54 -8 87 12" fill="none" stroke="#061b45" strokeWidth="8" strokeLinecap="round" />
          <path d="M21 94 Q54 114 87 94" fill="none" stroke="#061b45" strokeWidth="8" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}

