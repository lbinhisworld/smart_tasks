function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const META_KEYS = ["分公司名称", "提取日期"] as const;

export function ReportJsonPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <pre className="json-fallback">{JSON.stringify(data, null, 2)}</pre>;
  }

  const metaEntries = META_KEYS.filter((k) => k in data).map((k) => [k, data[k]] as const);
  const root = data.production_report;

  return (
    <div className="report-tree">
      {metaEntries.length > 0 && (
        <div className="report-meta-card">
          {metaEntries.map(([k, v]) => (
            <div key={k} className="report-leaf report-meta-leaf">
              <span className="report-key">{k}</span>
              <span className="report-val">{typeof v === "string" ? v || "暂无" : String(v)}</span>
            </div>
          ))}
        </div>
      )}
      {isRecord(root) ? (
        Object.entries(root).map(([k, v]) => <Section key={k} title={k} node={v} depth={0} />)
      ) : (
        <pre className="json-fallback">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

function Section({
  title,
  node,
  depth,
}: {
  title: string;
  node: unknown;
  depth: number;
}) {
  if (typeof node === "string") {
    return (
      <div className="report-leaf" style={{ marginLeft: depth * 12 }}>
        <span className="report-key">{title}</span>
        <span className="report-val">{node || "暂无"}</span>
      </div>
    );
  }
  if (!isRecord(node)) {
    return (
      <div className="report-leaf" style={{ marginLeft: depth * 12 }}>
        <span className="report-key">{title}</span>
        <span className="report-val muted">{String(node)}</span>
      </div>
    );
  }
  const entries = Object.entries(node);
  const allLeaves = entries.every(([, v]) => typeof v === "string");
  if (allLeaves) {
    return (
      <details className="report-block" open={depth < 2}>
        <summary style={{ marginLeft: depth * 8 }}>{title}</summary>
        <div className="report-block-body">
          {entries.map(([k, v]) => (
            <div key={k} className="report-leaf">
              <span className="report-key">{k}</span>
              <span className="report-val">{typeof v === "string" ? v || "暂无" : String(v)}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }
  return (
    <details className="report-block" open={depth < 1}>
      <summary style={{ marginLeft: depth * 8 }}>{title}</summary>
      <div className="report-block-body">
        {entries.map(([k, v]) => (
          <Section key={k} title={k} node={v} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
