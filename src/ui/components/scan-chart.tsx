import type { ScanSeriesDto } from "../api";

interface ScanChartProps extends ScanSeriesDto {}

export function ScanChart({ total, series }: ScanChartProps) {
  const width = 640;
  const height = 190;
  const padding = 22;
  const maximum = Math.max(1, ...series.map((point) => point.scans));
  const points = series.map((point, index) => {
    const x = series.length <= 1 ? width / 2 : padding + (index / (series.length - 1)) * (width - padding * 2);
    const y = height - padding - (point.scans / maximum) * (height - padding * 2);
    return { ...point, x, y };
  });
  const activeDays = series.filter((point) => point.scans > 0).length;

  return (
    <figure className="scan-chart">
      <div className="scan-chart__heading">
        <div><p className="eyebrow">Last 30 days</p><h2>Scan activity</h2></div>
        <strong>{total.toLocaleString()} <span>all-time scans</span></strong>
      </div>
      {series.length > 0 ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily scans for the last 30 days">
          <title>Daily scans for the last 30 days</title>
          <desc>The chart contains {activeDays} active days and {total} scans.</desc>
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
          {points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="5"><title>{point.date}: {point.scans} scans</title></circle>)}
        </svg>
      ) : <p className="chart-empty">No scans recorded in this period.</p>}
      <figcaption>{total} scans across {activeDays} active {activeDays === 1 ? "day" : "days"}.</figcaption>
    </figure>
  );
}
