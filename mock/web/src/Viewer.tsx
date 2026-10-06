import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fitView, screenToImage, visibleRect, zoomAt, type View } from '@gaze/view';
import type { ViewState } from '@gaze/types';
import type { TelemetryBuffer } from './telemetry';
import type { Mark } from './api';

export type Overlay = { points: number[][]; color: string; label?: string; width?: number; dashed?: boolean };
export type ViewerHandle = { getViewState(): ViewState; reset(): void; stageEl(): HTMLDivElement | null };

type Props = {
  src: string; imgW: number; imgH: number;
  marks: Mark[];
  overlays?: Overlay[];
  readonly?: boolean;
  telemetry?: TelemetryBuffer;
  loupe: { radius: number; mag: number; defaultOn: boolean };
  zoomMax: number;
  onPlaceMark?: (p: { x: number; y: number; sx: number; sy: number }) => void;
  /** Extra drawing in image space (replay panel uses this). Called after overlays, before the loupe. */
  draw?: (ctx: CanvasRenderingContext2D, view: View) => void;
  showGazeDot?: { sx: number; sy: number } | null; // debug only — never during reading
};

const LABEL_SHORT: Record<string, string> = { pleural_thickening: 'pl. thick.', consolidation: 'consol.', calcification: 'calc.', pneumothorax: 'PTX', atelectasis: 'atel.', not_sure: '?' };

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(p, ref) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ originX: 0, originY: 0, scale: 1 });
  const fitRef = useRef<View>({ originX: 0, originY: 0, scale: 1 });
  const [bright, setBright] = useState(1), [contrast, setContrast] = useState(1), [invert, setInvert] = useState(false);
  const [loupeOn, setLoupeOn] = useState(p.loupe.defaultOn);
  const cursor = useRef<{ sx: number; sy: number } | null>(null); // stage-relative
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = p.src;
    setImg(null);
  }, [p.src]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const reset = useCallback(() => {
    if (!size.w) return;
    const f = fitView(size.w, size.h, p.imgW, p.imgH, 0);
    fitRef.current = f;
    setView(f);
  }, [size, p.imgW, p.imgH]);
  useEffect(() => { reset(); }, [reset, p.src]);

  const zoom = view.scale / (fitRef.current.scale || 1);
  const vp = () => visibleRect(size.w, size.h, view, p.imgW, p.imgH);
  const imgPt = (sx: number, sy: number) => screenToImage(sx, sy, view);
  const onImage = (q: { x: number; y: number }) => q.x >= 0 && q.y >= 0 && q.x <= p.imgW && q.y <= p.imgH;

  const tele = (kind: 'move' | 'down' | 'up' | 'wheel' | 'enter' | 'leave' | 'loupe' | 'wl' | 'pan', sx?: number, sy?: number) => {
    if (!p.telemetry) return;
    const e: Parameters<TelemetryBuffer['push']>[0] = { kind, zoom, vp: vp(), loupe: loupeOn };
    if (sx !== undefined && sy !== undefined) { const q = imgPt(sx, sy); if (onImage(q)) { e.x = q.x; e.y = q.y; } }
    p.telemetry.push(e);
  };

  useImperativeHandle(ref, () => ({
    getViewState: () => {
      const r = stageRef.current?.getBoundingClientRect() ?? new DOMRect();
      const c = cursor.current;
      const q = c ? imgPt(c.sx, c.sy) : null;
      return {
        view, stageRect: { left: r.left, top: r.top, width: r.width, height: r.height }, imgW: p.imgW, imgH: p.imgH, zoom,
        loupe: c && q ? { on: loupeOn && onImage(q), cx: r.left + c.sx, cy: r.top + c.sy, radius: p.loupe.radius, mag: p.loupe.mag, imgX: q.x, imgY: q.y } : undefined,
      };
    },
    reset,
    stageEl: () => stageRef.current,
  }), [view, zoom, loupeOn, p.imgW, p.imgH, p.loupe, reset]);

  // keys
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'l' || e.key === 'L') { setLoupeOn((v) => !v); tele('loupe'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  // draw
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr; cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.w, size.h);
    if (!img) return;
    const filter = `brightness(${bright}) contrast(${contrast})${invert ? ' invert(1)' : ''}`;
    const drawImage = (v: View) => {
      ctx.save(); ctx.filter = filter; ctx.imageSmoothingEnabled = v.scale < 1.5;
      ctx.drawImage(img, v.originX, v.originY, p.imgW * v.scale, p.imgH * v.scale); ctx.restore();
    };
    const drawOverlays = (v: View) => {
      ctx.save(); ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.originX, dpr * v.originY);
      for (const o of p.overlays ?? []) {
        if (o.points.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(o.points[0]![0]!, o.points[0]![1]!);
        for (const q of o.points.slice(1)) ctx.lineTo(q[0]!, q[1]!);
        ctx.closePath(); ctx.strokeStyle = o.color; ctx.lineWidth = (o.width ?? 2) / v.scale; ctx.setLineDash(o.dashed ? [6 / v.scale, 4 / v.scale] : []); ctx.stroke();
        if (o.label) { ctx.fillStyle = o.color; ctx.font = `${13 / v.scale}px Atkinson Hyperlegible, system-ui`; ctx.fillText(o.label, o.points[0]![0]! + 4 / v.scale, o.points[0]![1]! - 4 / v.scale); }
      }
      p.draw?.(ctx, v);
      ctx.restore();
    };
    const drawMarks = (v: View) => {
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      p.marks.forEach((m, i) => {
        const sx = v.originX + m.x * v.scale, sy = v.originY + m.y * v.scale;
        ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.strokeStyle = '#f0a92e'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#f0a92e'; ctx.font = '12px Atkinson Hyperlegible, system-ui';
        ctx.fillText(`${i + 1} ${LABEL_SHORT[m.label] ?? m.label}`, sx + 17, sy + 4);
      });
      ctx.restore();
    };
    drawImage(view); drawOverlays(view); drawMarks(view);
    const c = cursor.current;
    if (loupeOn && c) {
      const q = imgPt(c.sx, c.sy);
      if (onImage(q)) {
        const k = view.scale * p.loupe.mag;
        const lv: View = { scale: k, originX: c.sx - q.x * k, originY: c.sy - q.y * k };
        ctx.save(); ctx.beginPath(); ctx.arc(c.sx, c.sy, p.loupe.radius, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.w, size.h);
        drawImage(lv); drawOverlays(lv); ctx.restore();
        ctx.beginPath(); ctx.arc(c.sx, c.sy, p.loupe.radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(243,245,246,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    if (p.showGazeDot) { ctx.beginPath(); ctx.arc(p.showGazeDot.sx, p.showGazeDot.sy, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(53,201,221,.6)'; ctx.fill(); }
  });

  const rel = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  return (
    <div
      ref={stageRef} className="stage" style={{ cursor: p.readonly ? 'default' : 'crosshair' }}
      onPointerDown={(e) => { const { sx, sy } = rel(e); drag.current = { sx, sy, ox: view.originX, oy: view.originY, moved: false }; (e.target as HTMLElement).setPointerCapture(e.pointerId); tele('down', sx, sy); }}
      onPointerMove={(e) => {
        const { sx, sy } = rel(e); cursor.current = { sx, sy };
        const d = drag.current;
        if (d && (d.moved || Math.hypot(sx - d.sx, sy - d.sy) > 4)) {
          d.moved = true; setView((v) => ({ ...v, originX: d.ox + (sx - d.sx), originY: d.oy + (sy - d.sy) })); tele('pan', sx, sy);
        } else { tele('move', sx, sy); bump((n) => n + 1); }
      }}
      onPointerUp={(e) => {
        const { sx, sy } = rel(e); const d = drag.current; drag.current = null; tele('up', sx, sy);
        if (d && !d.moved && !p.readonly) { const q = imgPt(sx, sy); if (onImage(q)) p.onPlaceMark?.({ x: q.x, y: q.y, sx, sy }); }
      }}
      onPointerEnter={(e) => { const { sx, sy } = rel(e); cursor.current = { sx, sy }; tele('enter', sx, sy); }}
      onPointerLeave={(e) => { const { sx, sy } = rel(e); cursor.current = null; drag.current = null; tele('leave', sx, sy); bump((n) => n + 1); }}
      onWheel={(e) => { const { sx, sy } = rel(e); const f = fitRef.current.scale; setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), sx, sy, f, f * p.zoomMax)); tele('wheel', sx, sy); }}
      onDoubleClick={() => reset()}
    >
      <canvas ref={canvasRef} />
      <div className="toolbar" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <span>zoom {zoom.toFixed(1)}×</span>
        <label>bright <input type="range" min={0.4} max={1.8} step={0.02} value={bright} onChange={(e) => { setBright(+e.target.value); tele('wl'); }} /></label>
        <label>contrast <input type="range" min={0.5} max={2.5} step={0.02} value={contrast} onChange={(e) => { setContrast(+e.target.value); tele('wl'); }} /></label>
        <button className="ghost" onClick={() => { setInvert((v) => !v); tele('wl'); }}>{invert ? 'invert ✓' : 'invert'}</button>
        <button className="ghost" onClick={() => { setLoupeOn((v) => !v); tele('loupe'); }}>loupe {loupeOn ? '✓' : ''} <span className="kbd">L</span></button>
      </div>
    </div>
  );
});
