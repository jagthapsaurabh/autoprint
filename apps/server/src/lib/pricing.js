export function computeAmount({ pages, copies, colorMode, colorRate, grayRate }) {
  const rate = colorMode === "COLOR" ? colorRate : grayRate;
  const total = Math.max(1, pages) * Math.max(1, copies) * rate;
  return Math.round(total * 100) / 100;
}
