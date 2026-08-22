const hex = (h) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r) => 0.2126 * ch(r[0]) + 0.7152 * ch(r[1]) + 0.0722 * ch(r[2]);
const cr = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const RAMP = {
  n100: "#f8f4f4",
  n200: "#eae7e7",
  n300: "#d7d3d3",
  n400: "#bab6b6",
  n500: "#9b9797",
  n600: "#7d7979",
  n700: "#605d5d",
  n800: "#444141",
  n900: "#2d2b2b",
  n950: "#201e1d",
  a100: "#e9f8ff",
  a200: "#cbeeff",
  a300: "#99e0ff",
  a400: "#62c5ee",
  a500: "#38a6cf",
  a600: "#1186ac",
  a700: "#006786",
  a800: "#004961",
  a900: "#0a303e",
  b100: "#fff1f4",
  b200: "#ffdee6",
  b300: "#ffc0d0",
  b400: "#ff90b1",
  b500: "#ff458e",
  b600: "#d82071",
  b700: "#aa0b56",
  b800: "#790e3d",
  b900: "#4b1528",
  accent: "#0088b0",
  accent2: "#d6006c",
};

// Dark grounds: keep Broadsheet's *relationships* — surface raised (lighter on
// dark, darker on light), inset the third ground.
const GROUNDS = { bg: "#1a1918", surface: "#262423", inset: "#121110" };
const worst = (c) => Math.min(...Object.values(GROUNDS).map((g) => cr(c, g)));

console.log(
  "grounds:",
  Object.entries(GROUNDS)
    .map(([k, v]) => `${k} ${v}`)
    .join("  "),
);
console.log(
  "  bg↔surface",
  cr(GROUNDS.bg, GROUNDS.surface).toFixed(2),
  " bg↔inset",
  cr(GROUNDS.bg, GROUNDS.inset).toFixed(2),
);

console.log("\n── candidates for --ink (want >= 13, near-white) ──");
for (const k of ["n100", "n200", "n300"])
  console.log(`  ${k} ${RAMP[k]}  worst ${worst(RAMP[k]).toFixed(2)}`);
console.log(
  "\n── candidates for --ink-muted (want >= 4.5, clearly below --ink) ──",
);
for (const k of ["n400", "n500", "n600"])
  console.log(`  ${k} ${RAMP[k]}  worst ${worst(RAMP[k]).toFixed(2)}`);
console.log("\n── candidates for --ink-link (want >= 4.5) ──");
for (const k of ["a200", "a300", "a400", "a500"])
  console.log(`  ${k} ${RAMP[k]}  worst ${worst(RAMP[k]).toFixed(2)}`);
console.log("\n── candidates for --ink-alert (want >= 4.5) ──");
for (const k of ["b200", "b300", "b400", "b500"])
  console.log(`  ${k} ${RAMP[k]}  worst ${worst(RAMP[k]).toFixed(2)}`);

console.log("\n── fill-accent: which label on which fill (want >= 4.5) ──");
for (const f of ["a400", "a500", "a600", "a700"]) {
  console.log(
    `  fill ${f}: label n950 ${cr(RAMP.n950, RAMP[f]).toFixed(2)}   label n100 ${cr(RAMP.n100, RAMP[f]).toFixed(2)}`,
  );
}
console.log("\n── badge: label on accent-2 family (want >= 4.5) ──");
for (const f of ["b400", "b500", "b600"])
  console.log(
    `  ${f}: n950 ${cr(RAMP.n950, RAMP[f]).toFixed(2)}  n100 ${cr(RAMP.n100, RAMP[f]).toFixed(2)}`,
  );

console.log("\n── non-text, want >= 3.0 ──");
for (const k of ["a400", "a500", "a600", "accent"])
  console.log(`  focus ring ${k}: worst ground ${worst(RAMP[k]).toFixed(2)}`);
console.log("\n── line-control on the input fill (surface), want >= 3.0 ──");
for (const k of ["n500", "n600", "n700"])
  console.log(`  ${k}: ${cr(RAMP[k], GROUNDS.surface).toFixed(2)}`);
console.log("\n── tag pairs on dark: fg on their own dark fill ──");
console.log(
  `  accent tag:  a200 on a900  ${cr(RAMP.a200, RAMP.a900).toFixed(2)}`,
);
console.log(
  `  alert tag:   b200 on b900  ${cr(RAMP.b200, RAMP.b900).toFixed(2)}`,
);
console.log(
  `  neutral tag: n200 on n900  ${cr(RAMP.n200, RAMP.n900).toFixed(2)}`,
);

console.log("\n════ final pairs ════");
const D = { bg: "#1a1918", surface: "#262423", inset: "#121110" };
console.log(
  `  ink-link a400 on fill-highlight a900   ${cr(RAMP.a400, RAMP.a900).toFixed(2)}`,
);
console.log(
  `  ink-link a400 on fill-highlight a800   ${cr(RAMP.a400, RAMP.a800).toFixed(2)}`,
);
console.log(
  `  ink-inverse(bg) on fill-accent a400    ${cr(D.bg, RAMP.a400).toFixed(2)}`,
);
console.log(
  `  ink-inverse(bg) on hover a300          ${cr(D.bg, RAMP.a300).toFixed(2)}`,
);
console.log(
  `  ink-inverse(bg) on active a200         ${cr(D.bg, RAMP.a200).toFixed(2)}`,
);
console.log(
  `  badge: ink-inverse(bg) on b400         ${cr(D.bg, RAMP.b400).toFixed(2)}`,
);
console.log(
  `  line-control n600 on surface           ${cr(RAMP.n600, D.surface).toFixed(2)}`,
);
console.log(
  `  line-control-hover n400 on surface     ${cr(RAMP.n400, D.surface).toFixed(2)}`,
);
console.log(
  `  bar-fill a400 on fill-inert n800       ${cr(RAMP.a400, RAMP.n800).toFixed(2)}`,
);
console.log(
  `  chart-bar b400 on bg                   ${cr(RAMP.b400, D.bg).toFixed(2)}`,
);
console.log(
  `  ink n100 on fill-highlight a900        ${cr(RAMP.n100, RAMP.a900).toFixed(2)}`,
);
