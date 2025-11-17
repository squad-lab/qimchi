export const themeColors = {
  accent: "rgba(140,198,62,0.6)",
  accentHover: "rgba(110,160,48,0.65)",
  accentBorder: "#7ab134",
  accentBorderLight: "#cfe59b",
  accentHeaderBg: "#dff1bd",
  accentLightBg: "#f4fae8",
  accentOverlay: "rgba(223,241,189,0.6)",
  accentText: "#2f4a11",
  accentIcon: "#6ea030",
} as const;

export const themeClasses = {
  accentBg: "bg-[rgba(140,198,62,0.6)]",
  accentHoverBg: "hover:bg-[rgba(110,160,48,0.65)]",
  accentBorder: "border-[#7ab134]",
  accentBorderLight: "border-[#cfe59b]",
  accentHeaderBg: "bg-[#dff1bd]",
  accentLightBg: "bg-[#f4fae8]",
  accentOverlay: "bg-[rgba(223,241,189,0.6)]",
  accentText: "text-[#2f4a11]",
  accentIcon: "text-[#6ea030]",
  accentFocusRing: "focus:ring-[#8cc63e]",
} as const;

// Backwards-compatible exports
export const BRAND_COLORS = {
  primary: themeColors.accent,
  primaryDark: themeColors.accentHover,
} as const;

export const BRAND_BG_CLASS = themeClasses.accentBg;
export const BRAND_HOVER_BG_CLASS = themeClasses.accentHoverBg;
export const BRAND_BORDER_CLASS = themeClasses.accentBorder;


// TODOLATER: Try these as well - official SQUAD Lab colors
// export const themeColors = {
//   // SQUAD Lab official brand colors
//   accent: "#8DC63F", // Pantone 376 - primary green
//   accentHover: "#6ea030", // Darker green for hover
//   accentTeal: "#54C5D0", // Pantone 3115 - gradient start
//   accentYellow: "#FFF200", // Pantone Yellow C - gradient end
//   accentRichBlack: "#2C2A29", // Rich black
//   accentBorder: "#7ab134",
//   accentBorderLight: "#cfe59b",
//   accentHeaderBg: "#dff1bd",
//   accentLightBg: "#f4fae8",
//   accentOverlay: "rgba(141, 198, 63, 0.6)",
//   accentText: "#2f4a11",
//   accentIcon: "#6ea030",
// } as const;

// export const themeClasses = {
//   accentBg: "bg-[#8DC63F]",
//   accentHoverBg: "hover:bg-[#6ea030]",
//   accentBorder: "border-[#7ab134]",
//   accentBorderLight: "border-[#cfe59b]",
//   accentHeaderBg: "bg-[#dff1bd]",
//   accentLightBg: "bg-[#f4fae8]",
//   accentOverlay: "bg-[rgba(141,198,63,0.6)]",
//   accentText: "text-[#2f4a11]",
//   accentIcon: "text-[#6ea030]",
//   accentFocusRing: "focus:ring-[#8DC63F]",
//   // SQUAD Lab gradient (teal to yellow)
//   gradientSquad: "bg-gradient-to-r from-[#54C5D0] via-[#8DC63F] to-[#FFF200]",
//   textTeal: "text-[#54C5D0]",
//   textYellow: "text-[#FFF200]",
//   bgTeal: "bg-[#54C5D0]",
//   bgYellow: "bg-[#FFF200]",
//   bgRichBlack: "bg-[#2C2A29]",
//   textRichBlack: "text-[#2C2A29]",
// } as const;

// // Backwards-compatible exports
// export const BRAND_COLORS = {
//   primary: themeColors.accent,
//   primaryDark: themeColors.accentHover,
// } as const;

// export const BRAND_BG_CLASS = themeClasses.accentBg;
// export const BRAND_HOVER_BG_CLASS = themeClasses.accentHoverBg;
// export const BRAND_BORDER_CLASS = themeClasses.accentBorder;
