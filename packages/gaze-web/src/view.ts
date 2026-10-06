// Vendored verbatim from Blindspot's coords.ts (see §0 of the kickoff prompt). Do not edit; re-check against Blindspot.
export type View = { originX: number; originY: number; scale: number }; // screen = origin + img * scale
export function screenToImage(sx: number, sy: number, v: View) { return { x: (sx - v.originX) / v.scale, y: (sy - v.originY) / v.scale }; }
export function imageToScreen(ix: number, iy: number, v: View) { return { x: v.originX + ix * v.scale, y: v.originY + iy * v.scale }; }
export function clientToImage(clientX: number, clientY: number, stage: { left: number; top: number }, v: View) {
  return screenToImage(clientX - stage.left, clientY - stage.top, v);
}
export function visibleRect(w: number, h: number, v: View, imgW: number, imgH: number): [number, number, number, number] {
  const a = screenToImage(0, 0, v), b = screenToImage(w, h, v);
  return [Math.max(0, a.x), Math.max(0, a.y), Math.min(imgW, b.x), Math.min(imgH, b.y)];
}
export function zoomAt(v: View, factor: number, sx: number, sy: number, minScale: number, maxScale: number): View {
  const ns = Math.min(maxScale, Math.max(minScale, v.scale * factor)), k = ns / v.scale;
  return { scale: ns, originX: sx - (sx - v.originX) * k, originY: sy - (sy - v.originY) * k };
}
export function fitView(stageW: number, stageH: number, imgW: number, imgH: number, pad = 0): View {
  const scale = Math.max(1e-6, Math.min((stageH - 2 * pad) / imgH, (stageW - 2 * pad) / imgW));
  return { scale, originX: (stageW - imgW * scale) / 2, originY: (stageH - imgH * scale) / 2 };
}
