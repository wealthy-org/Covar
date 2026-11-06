/**
 * Fee-flow diagram in the shape of the reference's economics sankey. Band widths
 * encode the published *rules* (100%, 80/20, cost + application fee) — not
 * volumes: nothing is live, so no volume is drawn or implied.
 */
type Node = { id: string; label: string; sub: string; y0: number; y1: number };

const H = 340;
const LEFT: Node[] = [
  { id: "flow", label: "Deposit & withdrawal fees", sub: "1% + 0.10 USDG per flow", y0: 30, y1: 110 },
  { id: "perf", label: "Creator fee", sub: "≤20% of each winning trade", y0: 140, y1: 240 },
  { id: "ai", label: "Copilot usage", sub: "model cost + app fee", y0: 270, y1: 320 },
];
const RIGHT: Node[] = [
  { id: "creator", label: "Creator", sub: "80% of the creator fee", y0: 20, y1: 100 },
  { id: "treasury", label: "Platform treasury", sub: "flow fees · 20% split · app fee", y0: 130, y1: 250 },
  { id: "provider", label: "AI provider", sub: "pass-through cost", y0: 290, y1: 320 },
];
const LINKS: { a: [number, number]; b: [number, number]; tone: string; pct: string }[] = [
  { a: [30, 110], b: [130, 210], tone: "#3B5BDB", pct: "100%" },
  { a: [140, 220], b: [20, 100], tone: "#6E86E6", pct: "80%" },
  { a: [220, 240], b: [210, 230], tone: "#3B5BDB", pct: "20%" },
  { a: [270, 290], b: [230, 250], tone: "#3B5BDB", pct: "fee" },
  { a: [290, 320], b: [290, 320], tone: "#A9B4CF", pct: "cost" },
];

const W = 380;
const X0 = 10;
const X1 = W - 10;
const MID = W / 2;

const band = ({ a, b }: (typeof LINKS)[number]) =>
  `M${X0},${a[0]} C${MID},${a[0]} ${MID},${b[0]} ${X1},${b[0]} L${X1},${b[1]} C${MID},${b[1]} ${MID},${a[1]} ${X0},${a[1]} Z`;
const centre = ({ a, b }: (typeof LINKS)[number]) => {
  const ya = (a[0] + a[1]) / 2;
  const yb = (b[0] + b[1]) / 2;
  return `M${X0},${ya} C${MID},${ya} ${MID},${yb} ${X1},${yb}`;
};

function Labels({ nodes, align }: { nodes: Node[]; align: "left" | "right" }) {
  return (
    <div className="sk-labels" style={{ textAlign: align }}>
      {nodes.map((n) => (
        <div key={n.id} className="sk-label" style={{ top: `${(((n.y0 + n.y1) / 2) / H) * 100}%` }}>
          <span className="sk-label-t">{n.label}</span>
          <span className="sk-label-s">{n.sub}</span>
        </div>
      ))}
    </div>
  );
}

export function FeeSankey() {
  return (
    <>
      <div className="sk" role="img" aria-label="Fee flows: deposit and withdrawal fees go to the platform treasury; the creator fee splits 80% creator, 20% treasury; Copilot usage pays the AI provider's cost plus an application fee to the treasury.">
        <Labels nodes={LEFT} align="right" />
        <svg viewBox={`0 0 ${W} ${H}`} className="sk-svg" aria-hidden>
          {LINKS.map((l, i) => (
            <path key={`b${i}`} d={band(l)} fill={l.tone} opacity={0.16} />
          ))}
          {LINKS.map((l, i) => (
            <path key={`c${i}`} id={`sk-c${i}`} d={centre(l)} fill="none" stroke={l.tone} strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {[...LEFT, ...RIGHT].map((n, i) => (
            <rect key={n.id} x={i < LEFT.length ? 0 : W - 10} y={n.y0} width={10} height={n.y1 - n.y0} rx={2} fill="#10141F" />
          ))}
          {LINKS.map((l, i) =>
            [0, 1, 2].map((k) => (
              <circle key={`d${i}-${k}`} r={2.6} fill={l.tone} className="sk-dot">
                <animateMotion dur={`${4.2 + i * 0.5}s`} begin={`-${(k * (4.2 + i * 0.5)) / 3 + i * 0.3}s`} repeatCount="indefinite">
                  <mpath href={`#sk-c${i}`} />
                </animateMotion>
              </circle>
            ))
          )}
          {LINKS.map((l, i) => {
            const y = (l.b[0] + l.b[1]) / 2;
            return (
              <text key={`t${i}`} x={X1 - 8} y={y + 3.5} textAnchor="end" className="sk-pct">
                {l.pct}
              </text>
            );
          })}
        </svg>
        <Labels nodes={RIGHT} align="left" />
      </div>

      {/* small screens: the same flows as a list */}
      <ul className="sk-list">
        <li><span>Deposit &amp; withdrawal fees</span><span>→ treasury · 100%</span></li>
        <li><span>Creator fee (winning trades)</span><span>→ creator 80% · treasury 20%</span></li>
        <li><span>Copilot usage</span><span>→ AI provider cost · app fee to treasury</span></li>
      </ul>
    </>
  );
}
