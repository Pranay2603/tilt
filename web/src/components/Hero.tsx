import { useEffect, useRef, useState } from "react";
import { FIRST_SEED, HeroScene, TARGET_VISITORS, type HeroStats } from "../hero/scene";
import { LANE_END_X, LANE_NAMES, STRIPS, laneYFrac } from "../lib/layout";
import { fmt, int } from "../lib/format";
import { LOG_DATE } from "../config";

const EMPTY: HeroStats = {
  visitors: 0,
  lost: [0, 0],
  conversions: [0, 0],
  share: [
    [1 / 3, 1 / 3, 1 / 3],
    [1 / 3, 1 / 3, 1 / 3],
  ],
  seed: FIRST_SEED,
  finished: false,
};

const STRIP_NAMES = ["Fixed split", "Tilt"];

export function Hero() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HeroScene | null>(null);
  const [stats, setStats] = useState<HeroStats>(EMPTY);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const body = bodyRef.current;
    if (!canvas || !body) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: HeroScene;
    try {
      scene = new HeroScene(canvas, body, setStats, reduced);
    } catch {
      setOk(false);
      return;
    }
    sceneRef.current = scene;
    let inView = true;
    const sync = () => scene.setActive(inView && !document.hidden);
    const io = new IntersectionObserver(
      ([e]) => {
        inView = !!e?.isIntersecting;
        sync();
      },
      { threshold: 0.1 },
    );
    io.observe(body);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const [lostFixed, lostTilt] = stats.lost;
  const recovered = Math.max(0, lostFixed - lostTilt);

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div className="titleblock">
          <p className="meta mono">
            <span>Experiment log · No. 01</span>
            <span>{LOG_DATE}</span>
          </p>
          <div className="title-grid">
            <h1 className="title">
              Tilt moves traffic toward the winning variant{" "}
              <em>while the test is still running.</em>
            </h1>
            <div className="abstract">
              <p className="label mono">Abstract</p>
              <p>
                A fixed 50/50 test keeps sending visitors to variants it already suspects are worse. Tilt shifts
                traffic toward the winner as evidence builds, using Thompson sampling behind a
                PostgreSQL-backed service.
              </p>
              <p>
                The figure below is not a recording. It is the engine itself, running in your browser.
              </p>
              <p className="jumps mono">
                <a href="#experiment">Run your own ↓</a>
                <a href="#method">How it learns ↓</a>
              </p>
            </div>
          </div>
        </div>

        <figure className="plate" aria-label="Live simulation comparing a fixed split with Tilt">
          <div className="plate-head mono">
            <span className="fig">Fig. 1</span>
            <span className="plate-title">Same promos, same visitors, two ways to split them.</span>
            <button className="linkbtn" onClick={() => sceneRef.current?.replay()} type="button">
              ↻ New run
            </button>
          </div>

          <div className="plate-body" ref={bodyRef}>
            <canvas ref={canvasRef} aria-hidden="true" />
            {!ok && <p className="fallback mono">WebGL is unavailable here, so the live figure is off.</p>}

            {STRIPS.map((s, si) => (
              <div key={si} className="strip-tag mono" style={{ top: `${s.top * 100}%` }}>
                <span className={si === 1 ? "tag tilt" : "tag"}>{STRIP_NAMES[si]}</span>
              </div>
            ))}

            {STRIPS.flatMap((_, si) =>
              LANE_NAMES.map((name, li) => (
                <div
                  key={`${si}-${li}`}
                  className="lane-label mono"
                  style={{ left: `${LANE_END_X * 100}%`, top: `${laneYFrac(si, li) * 100}%` }}
                >
                  <b>{name}</b>
                  <span>{Math.round((stats.share[si]?.[li] ?? 0) * 100)}%</span>
                </div>
              )),
            )}
          </div>

          <dl className="scoreboard">
            <div>
              <dt className="mono">Visitors</dt>
              <dd className="num">
                {int(stats.visitors)}
                <small> / {int(TARGET_VISITORS)}</small>
              </dd>
            </div>
            <div>
              <dt className="mono">Conversions lost, fixed split</dt>
              <dd className="num">{fmt(lostFixed)}</dd>
            </div>
            <div className="hot">
              <dt className="mono">Conversions lost, Tilt</dt>
              <dd className="num">{fmt(lostTilt)}</dd>
            </div>
            <div>
              <dt className="mono">Recovered by Tilt</dt>
              <dd className="num">+{fmt(recovered)}</dd>
            </div>
          </dl>
          <p className="plate-note mono">
            Lost = expected conversions given up by not always showing the best variant. Run {stats.seed}. The best
            variant changes every run, and Tilt wins most runs, not all. Try a few.
          </p>
        </figure>
      </div>
    </section>
  );
}
