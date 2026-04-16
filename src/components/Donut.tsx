export function Donut({
  segments,
  size = 120,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const parts = segments.map((seg) => {
    const pct = (seg.value / total) * 100;
    const start = acc;
    acc += pct;
    return { ...seg, start, pct };
  });
  const gradient = parts
    .map((p) => `${p.color} ${p.start}% ${p.start + p.pct}%`)
    .join(", ");

  return (
    <div className="donut-wrap">
      <div
        className="donut-ring"
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${gradient})`,
        }}
      >
        <div className="donut-hole" />
      </div>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="dot" style={{ background: s.color }} />
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
