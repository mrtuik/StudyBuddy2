import { useRef, useState } from 'react';
import type { Stroke } from '../store/annot';

export type Tool = 'pen' | 'hl' | 'eraser' | null;

interface Props {
  w: number; h: number;
  strokes: Stroke[];
  tool: Tool; color: string;
  onChange: (s: Stroke[]) => void;
}

const pts = (p: number[], w: number, h: number) => {
  const o: string[] = [];
  for (let i = 0; i < p.length; i += 2) o.push(`${(p[i] * w).toFixed(1)},${(p[i + 1] * h).toFixed(1)}`);
  return o.join(' ');
};

export default function AnnotLayer({ w, h, strokes, tool, color, onChange }: Props) {
  const live = useRef<number[]>([]);
  const [, bump] = useState(0);
  const svg = useRef<SVGSVGElement>(null);

  const pos = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };
  const erase = (x: number, y: number) => {
    const rad = 16;
    const hit = strokes.findIndex((s) => {
      for (let i = 0; i < s.p.length; i += 2) if (Math.hypot((s.p[i] - x) * w, (s.p[i + 1] - y) * h) < rad + s.w * w / 2) return true;
      return false;
    });
    if (hit >= 0) onChange(strokes.filter((_, i) => i !== hit));
  };

  const down = (e: React.PointerEvent) => {
    if (!tool) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    if (tool === 'eraser') { erase(x, y); return; }
    live.current = [x, y]; bump((n) => n + 1);
  };
  const move = (e: React.PointerEvent) => {
    if (!tool || e.buttons === 0 && e.pointerType === 'mouse') return;
    const [x, y] = pos(e);
    if (tool === 'eraser') { if (e.pressure > 0 || e.buttons) erase(x, y); return; }
    if (!live.current.length) return;
    live.current.push(x, y); bump((n) => n + 1);
  };
  const up = () => {
    if (tool && tool !== 'eraser' && live.current.length >= 2) {
      const hl = tool === 'hl';
      const p = live.current.length === 2 ? [...live.current, ...live.current] : live.current;
      onChange([...strokes, { c: color, hl, w: hl ? 0.04 : 0.006, p }]);
    }
    live.current = [];
    bump((n) => n + 1);
  };

  const draw = (s: Stroke, k: number | string) => (
    <polyline key={k} points={pts(s.p, w, h)} fill="none" stroke={s.c} strokeWidth={s.w * w}
      strokeLinecap={s.hl ? 'butt' : 'round'} strokeLinejoin="round" opacity={s.hl ? 0.38 : 1} />
  );

  return (
    <svg ref={svg} width={w} height={h} className="absolute left-0 top-0"
      style={{ touchAction: tool ? 'none' : 'auto', pointerEvents: tool ? 'auto' : 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {strokes.map((s, i) => draw(s, i))}
      {live.current.length >= 2 && tool && tool !== 'eraser' &&
        draw({ c: color, hl: tool === 'hl', w: tool === 'hl' ? 0.04 : 0.006, p: live.current }, 'live')}
    </svg>
  );
}
