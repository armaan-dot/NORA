import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cameraFeed, type CameraFrame } from '../sim/wristCamera';
import { topicBus, type TopicStats } from '../sim/topicBus';
import { rosService } from '../services/rosService';

/* ------------------------------------------------------------------ */
/* Sensors: what the wrist camera actually renders and detects          */
/* ------------------------------------------------------------------ */

const paint = (canvas: HTMLCanvasElement | null, data: Uint8ClampedArray, w: number, h: number) => {
  if (!canvas) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
};

export const SensorsPanel: React.FC = () => {
  const rgbRef = useRef<HTMLCanvasElement>(null);
  const depthRef = useRef<HTMLCanvasElement>(null);
  const segRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<CameraFrame | null>(cameraFeed.latest);
  const [fps, setFps] = useState(0);
  const stamps = useRef<number[]>([]);
  const [belief, setBelief] = useState(rosService.getBelief());

  useEffect(() => {
    const t = setInterval(() => setBelief(rosService.getBelief()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return cameraFeed.subscribe((f) => {
      paint(rgbRef.current, f.rgba, f.width, f.height);
      paint(depthRef.current, f.depthRgba, f.width, f.height);
      paint(segRef.current, f.segRgba, f.width, f.height);

      // Bounding boxes + labels on the RGB view
      const ctx = rgbRef.current?.getContext('2d');
      if (ctx) {
        ctx.lineWidth = 1;
        ctx.font = '9px "IBM Plex Mono", monospace';
        for (const d of f.detections) {
          const [x0, y0, x1, y1] = d.bbox;
          ctx.strokeStyle = 'rgba(236,236,238,0.9)';
          ctx.strokeRect(x0 - 1.5, y0 - 1.5, x1 - x0 + 3, y1 - y0 + 3);
          ctx.fillStyle = 'rgba(15,16,18,0.75)';
          const label = `${d.label} ${Math.round(d.confidence * 100)}%`;
          ctx.fillRect(x0 - 1.5, Math.max(0, y0 - 12), ctx.measureText(label).width + 6, 11);
          ctx.fillStyle = '#ececee';
          ctx.fillText(label, x0 + 1, Math.max(9, y0 - 3));
        }
      }
      const now = performance.now();
      stamps.current.push(now);
      stamps.current = stamps.current.filter((t) => now - t < 2000);
      setFps(stamps.current.length / 2);
      setFrame(f);
    });
  }, []);

  return (
    <div className="fx-panel">
      <div className="fx-note">
        Eye-in-hand RGB-D camera, rendered from the sensor pose (69° × 42° FOV, {frame ? `${frame.width}×${frame.height}` : '256×144'}).
        Objects are found and named from the colour and depth images alone: OpenCV segments and measures each region, and a
        classifier trained on simulator renders names it.
        <span className="fx-note-dim"> Anything out of view or hidden is not seen.</span>
      </div>

      <div className="fx-image-grid">
        <figure>
          <canvas ref={rgbRef} className="fx-canvas" aria-label="RGB image" />
          <figcaption>/camera/color/image_raw <em>{fps.toFixed(1)} Hz</em></figcaption>
        </figure>
        <figure>
          <canvas ref={depthRef} className="fx-canvas" aria-label="Depth image" />
          <figcaption>
            /camera/aligned_depth_to_color
            <em>{frame ? `${frame.depthMin.toFixed(2)}–${frame.depthMax.toFixed(2)} m` : ''}</em>
          </figcaption>
        </figure>
        <figure>
          <canvas ref={segRef} className="fx-canvas" aria-label="Instance segmentation" />
          <figcaption>OpenCV regions by class</figcaption>
        </figure>
      </div>

      <h4 className="fx-h">
        Robot's belief <span className="fx-dim">built only from camera frames · forgets objects it sees gone</span>
      </h4>
      {belief.length === 0 ? (
        <p className="fx-empty">Nothing believed yet. The robot has not seen any object.</p>
      ) : (
        <table className="fx-table">
          <thead>
            <tr>
              <th>Object</th>
              <th>Believed position (m)</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {belief.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>
                  {b.position.x.toFixed(3)}, {b.position.z.toFixed(3)}
                </td>
                <td className={b.ageMs > 5000 ? 'fx-dim' : ''}>{b.ageMs < 1500 ? 'now' : `${Math.round(b.ageMs / 1000)} s ago`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!frame && <p className="fx-empty">Waiting for the first frame…</p>}

      {frame && (
        <>
          <h4 className="fx-h">Detections ({frame.detections.length})</h4>
          {frame.detections.length === 0 ? (
            <p className="fx-empty">Nothing in view. The camera only sees what is inside its frustum.</p>
          ) : (
            <table className="fx-table">
              <thead>
                <tr>
                  <th>Recognised as</th>
                  <th>Conf.</th>
                  <th>Mask px</th>
                  <th>Depth</th>
                  <th>Position (m)</th>
                </tr>
              </thead>
              <tbody>
                {frame.detections.map((d) => (
                  <tr key={`${d.label}-${d.bbox.join(',')}`}>
                    <td>
                      {d.label}
                      {d.truncated && <span className="fx-dim"> (partial)</span>}
                    </td>
                    <td>{Math.round(d.confidence * 100)}%</td>
                    <td>{d.maskPixels}</td>
                    <td>{d.depthM.toFixed(2)}</td>
                    <td>
                      {d.position.x.toFixed(3)}, {d.position.y.toFixed(3)}, {d.position.z.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="fx-kv">
            <dt>Intrinsics</dt>
            <dd>
              fx {frame.intrinsics.fx.toFixed(1)} · fy {frame.intrinsics.fy.toFixed(1)} · cx {frame.intrinsics.cx} · cy {frame.intrinsics.cy}
            </dd>
            <dt>Pose (scene)</dt>
            <dd>{frame.position.map((v) => v.toFixed(3)).join(', ')}</dd>
          </dl>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Topics: ROS-style topic list + raw message inspector                 */
/* ------------------------------------------------------------------ */

const trimForDisplay = (v: unknown, depth = 0): unknown => {
  if (Array.isArray(v)) {
    const items = v.slice(0, 12).map((x) => trimForDisplay(x, depth + 1));
    return v.length > 12 ? [...items, `… ${v.length - 12} more`] : items;
  }
  if (v && typeof v === 'object' && depth < 5) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trimForDisplay(x, depth + 1)]));
  }
  return v;
};

export const TopicsPanel: React.FC = () => {
  const [topics, setTopics] = useState<TopicStats[]>(topicBus.snapshot());
  const [selected, setSelected] = useState<string>('/joint_states');

  useEffect(() => {
    const refresh = () => setTopics(topicBus.snapshot());
    const off = topicBus.onChange(refresh);
    const timer = setInterval(refresh, 500); // keeps Hz / age fresh between messages
    refresh();
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  const current = topics.find((t) => t.name === selected) ?? topics[0];
  const json = useMemo(() => {
    if (!current) return '';
    const text = JSON.stringify(trimForDisplay(current.last), null, 2) ?? '';
    return text.length > 3500 ? text.slice(0, 3500) + '\n…' : text;
  }, [current]);

  return (
    <div className="fx-panel">
      <table className="fx-table fx-topic-table">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Type</th>
            <th>Hz</th>
            <th>Msgs</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <tr
              key={t.name}
              className={t.name === current?.name ? 'selected' : ''}
              onClick={() => setSelected(t.name)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(t.name)}
            >
              <td>{t.name}</td>
              <td className="fx-dim">{t.type.split('/').pop()}</td>
              <td className={t.ageMs > 3000 ? 'fx-dim' : ''}>{t.hz >= 10 ? t.hz.toFixed(0) : t.hz.toFixed(1)}</td>
              <td className="fx-dim">{t.count}</td>
            </tr>
          ))}
          {topics.length === 0 && (
            <tr>
              <td colSpan={4} className="fx-empty">
                No topics yet. Run a command to see the pipeline publish.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {current && (
        <>
          <h4 className="fx-h">
            {current.name} <span className="fx-dim">{current.type}</span>
          </h4>
          <pre className="fx-json">{json}</pre>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Plots: joint trajectories from /joint_states                         */
/* ------------------------------------------------------------------ */

const JOINT_LABELS = ['shoulder pan', 'shoulder lift', 'elbow', 'wrist 1', 'wrist 2', 'wrist 3'];
const SERIES_COLORS = ['#6aa6ff', '#4cc38a', '#e8a53c', '#ef5b52', '#b79cff', '#7fd1d6'];
const WINDOW_MS = 20000;

export const PlotPanel: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [latest, setLatest] = useState<number[]>(rosService.getCurrentJointPositions().slice(0, 6));

  useEffect(() => {
    let raf = 0;
    let lastLabel = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 34;
      const padB = 18;
      const plotW = w - padL - 6;
      const plotH = h - padB - 6;
      const now = performance.now();
      const yMin = -Math.PI;
      const yMax = Math.PI;
      const ty = (v: number) => 6 + plotH * (1 - (v - yMin) / (yMax - yMin));
      const tx = (t: number) => padL + plotW * (1 - (now - t) / WINDOW_MS);

      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#6d717a';
      ctx.strokeStyle = '#25282d';
      ctx.lineWidth = 1;
      for (const v of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
        const y = Math.round(ty(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(v === 0 ? '0' : `${v < 0 ? '−' : ''}${Math.abs(v) === Math.PI ? 'π' : 'π/2'}`, 4, y + 3);
      }
      for (let s = 0; s <= 20; s += 5) {
        const x = Math.round(padL + plotW * (1 - s / 20)) + 0.5;
        ctx.fillText(`${s === 0 ? 'now' : `−${s}s`}`, s === 0 ? x - 20 : s === 20 ? x : x - 10, h - 4);
      }

      // Samples inside the window, plus the last one before it so a stationary arm draws a flat line.
      const cutoff = now - WINDOW_MS;
      const pts: { t: number; v: number[] }[] = [];
      let before: number[] | null = null;
      for (const h of topicBus.history('/joint_states')) {
        const pos = (h.msg as { position?: number[] }).position;
        if (!pos) continue;
        if (h.t < cutoff) before = pos;
        else pts.push({ t: h.t, v: pos });
      }
      pts.unshift({ t: cutoff, v: (before ?? rosService.getCurrentJointPositions()).slice(0, 6) });

      for (let j = 0; j < 6; j++) {
        ctx.beginPath();
        ctx.strokeStyle = SERIES_COLORS[j];
        ctx.lineWidth = 1.5;
        let started = false;
        for (const smp of pts) {
          const x = tx(smp.t);
          const y = ty(smp.v[j]);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        // hold the last value up to "now" so a stationary arm shows a flat line
        const last = pts[pts.length - 1];
        if (started) ctx.lineTo(tx(now), ty(last.v[j]));
        ctx.stroke();
      }

      if (now - lastLabel > 200) {
        lastLabel = now;
        const last = pts[pts.length - 1];
        setLatest(last.v);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fx-panel">
      <canvas ref={canvasRef} className="fx-plot" aria-label="Joint position plot" />
      <ul className="fx-legend">
        {JOINT_LABELS.map((label, j) => (
          <li key={label}>
            <span className="fx-swatch" style={{ background: SERIES_COLORS[j] }} />
            <span className="fx-legend-name">{label}</span>
            <span className="fx-legend-val">{(latest[j] ?? 0).toFixed(3)} rad</span>
          </li>
        ))}
      </ul>
      <p className="fx-note-dim">From /joint_states. A move that bends sharply mid-way is the planner routing around an obstacle.</p>
    </div>
  );
};
