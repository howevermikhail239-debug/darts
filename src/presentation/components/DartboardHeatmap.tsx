import { useState } from "react";

const order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;
const polar = (radius: number, degrees: number) => { const angle = (degrees - 90) * Math.PI / 180; return [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)] as const; };
const ringPath = (inner: number, outer: number, start: number, end: number) => { const [a,b]=polar(outer,start), [c,d]=polar(outer,end), [e,f]=polar(inner,end), [g,h]=polar(inner,start); return `M ${a} ${b} A ${outer} ${outer} 0 0 1 ${c} ${d} L ${e} ${f} A ${inner} ${inner} 0 0 0 ${g} ${h} Z`; };

export function DartboardHeatmap({ hitCounts, detailedDarts, label = "Тепловая карта попаданий" }: { hitCounts: Readonly<Record<string, number>>; detailedDarts: number; label?: string }) {
  const [active, setActive] = useState<string>();
  const boardEntries = Object.entries(hitCounts).filter(([key]) => key !== "MISS");
  const max = Math.max(1, ...boardEntries.map(([, value]) => value));
  const fill = (key: string) => { const ratio = (hitCounts[key] ?? 0) / max; return `color-mix(in srgb, var(--accent) ${Math.round(12 + ratio * 78)}%, #20272e)`; };
  const regions = order.flatMap((number, index) => {
    const start = index * 18 - 9, end = start + 18;
    return [[`S${number}`, 42, 66], [`T${number}`, 37, 42], [`S${number}`, 14, 37], [`D${number}`, 66, 72]].map(([key, inner, outer], zone) => ({ key: String(key), path: ringPath(Number(inner), Number(outer), start, end), id: `${key}-${zone}` }));
  });
  const describe = (key: string) => `${key} — ${hitCounts[key] ?? 0} попаданий`;
  if (detailedDarts === 0) return <section className="heatmap-empty"><h3>Мишень</h3><p>Для тепловой карты пока нет детализированных бросков.</p></section>;
  return <section className="dartboard-heatmap"><svg viewBox="0 0 200 200" role="img" aria-label={label}>
    <circle cx="100" cy="100" r="74" className="board-edge" />
    {regions.map((region) => <path key={region.id} d={region.path} fill={fill(region.key)} tabIndex={0} onFocus={() => setActive(region.key)} onBlur={() => setActive(undefined)} onPointerEnter={() => setActive(region.key)} onPointerLeave={() => setActive(undefined)}><title>{describe(region.key)}</title></path>)}
    <circle cx="100" cy="100" r="14" fill={fill("25")} tabIndex={0} onFocus={() => setActive("25")} onBlur={() => setActive(undefined)} onPointerEnter={() => setActive("25")} onPointerLeave={() => setActive(undefined)}><title>{describe("25")}</title></circle>
    <circle cx="100" cy="100" r="6" fill={fill("Bull")} tabIndex={0} onFocus={() => setActive("Bull")} onBlur={() => setActive(undefined)} onPointerEnter={() => setActive("Bull")} onPointerLeave={() => setActive(undefined)}><title>{describe("Bull")}</title></circle>
    {order.map((number, index) => { const [x,y]=polar(84,index*18); return <text key={number} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{number}</text>; })}
  </svg><div className="heatmap-caption" aria-live="polite"><strong>{active ? describe(active) : "Наведите или нажмите на сектор"}</strong><span>Карта построена по {detailedDarts} детализированным броскам · промахов: {hitCounts.MISS ?? 0}</span></div></section>;
}
