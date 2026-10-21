import React, { useCallback, useEffect, useReducer, useRef } from "react";
import {
  Target, Trophy, CircleGauge, Percent, Zap, Wind, RotateCcw,
  Crosshair, Move, Sparkles, Flame, Star, Award, Lock, X
} from "lucide-react";

const MAX_SHOTS = 10;
const SAVE_KEY = "archery-progress-v1";
const WIND_DRIFT = 0.015;
const ACH_XP = 25;
const ROUND_BONUS = { S: 100, A: 60, B: 30, C: 10 };
const DEFAULT_NOTICE = "Click on the target or press Space to shoot";

// Scoring zones from the centre outwards. `maxRatio` is the distance from the
// centre as a fraction of the target radius (1 = outer edge).
const ZONES = [
  { points: 10, maxRatio: 0.13, name: "Bullseye",   color: "#ffda30" },
  { points: 7,  maxRatio: 0.30, name: "Gold Ring",  color: "#ffd62d" },
  { points: 5,  maxRatio: 0.47, name: "Red Ring",   color: "#ff413b" },
  { points: 3,  maxRatio: 0.64, name: "Blue Ring",  color: "#0799ef" },
  { points: 2,  maxRatio: 0.81, name: "Black Ring", color: "#1a242c" },
  { points: 1,  maxRatio: 1.00, name: "White Ring", color: "#f5f6f5" },
];

const ACHIEVEMENTS = [
  { id: "first-blood",  name: "First Blood",    desc: "Hit the target for the first time", icon: Target },
  { id: "bullseye",     name: "Bullseye!",      desc: "Score a perfect 10",                icon: Crosshair },
  { id: "hot-streak",   name: "Hot Streak",     desc: "Land 3 shots of 5+ in a row",       icon: Flame },
  { id: "inferno",      name: "Inferno",        desc: "Land 5 shots of 5+ in a row",       icon: Flame },
  { id: "round-master", name: "Round Master",   desc: "Score 70+ in one round",            icon: Trophy },
  { id: "flawless",     name: "Flawless Round", desc: "Finish a round with no misses",     icon: Star },
  { id: "level-5",      name: "Rising Archer",  desc: "Reach level 5",                     icon: Award },
];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function scoreFor(x, y) {
  const distance = Math.hypot(x, y);
  const zone = ZONES.find(z => distance <= z.maxRatio);
  return zone ? zone.points : 0;
}

function messageFor(points) {
  if (points === 10) return "Bullseye! Perfect shot!";
  if (points === 0) return "Missed the target!";
  return `Arrow landed — ${points} ${points === 1 ? "point" : "points"}!`;
}

const xpNeeded = level => 100 + (level - 1) * 50;

function applyXp(level, xp, gain) {
  let newLevel = level;
  let newXp = xp + gain;
  let leveled = false;
  while (newXp >= xpNeeded(newLevel)) {
    newXp -= xpNeeded(newLevel);
    newLevel++;
    leveled = true;
  }
  return { level: newLevel, xp: newXp, leveled };
}

const gradeFor = total => (total >= 80 ? "S" : total >= 65 ? "A" : total >= 45 ? "B" : "C");
const starsFor = total => (total >= 80 ? 3 : total >= 50 ? 2 : total >= 20 ? 1 : 0);
const focusPct = level => Math.round(Math.min(level - 1, 10) * 3);

function freshRound(notice = DEFAULT_NOTICE) {
  return {
    shots: [], combo: 0, roundBestCombo: 0, lastScore: null,
    summary: null, flight: null, notice
  };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return {};
    const d = JSON.parse(raw);
    return {
      level: Number(d.level) || 1,
      xp: Number(d.xp) || 0,
      unlocked: Array.isArray(d.unlocked) ? d.unlocked : [],
      bestRound: Number(d.bestRound) || 0
    };
  } catch {
    return {};
  }
}

function createInitial() {
  return {
    level: 1, xp: 0, unlocked: [], bestRound: 0,
    ...loadProgress(),
    ...freshRound(),
    power: 75, wind: 0,
    toasts: [], nextToast: 1,
    showBadges: false
  };
}

// Applies one shot and everything it triggers: XP, level-ups, combos,
// achievements, and the round summary when the 10th shot lands.
function handleShot(state, shot) {
  if (state.shots.length >= MAX_SHOTS) {
    return { ...state, notice: "Round complete! Tap Play Again for a new round." };
  }
  const { points } = shot;
  const shots = [...state.shots, shot];
  const combo = points >= 5 ? state.combo + 1 : 0;
  const roundBestCombo = Math.max(state.roundBestCombo, combo);
  const multiplier = 1 + Math.min(combo, 5) * 0.1;

  let progress = {
    level: state.level, xp: state.xp,
    unlocked: state.unlocked, bestRound: state.bestRound
  };
  const events = [];

  const award = gain => {
    const r = applyXp(progress.level, progress.xp, gain);
    progress = { ...progress, level: r.level, xp: r.xp };
    if (r.leveled) events.push({ kind: "level", text: `Level up! You are now level ${r.level}` });
  };

  award(points === 0 ? 2 : Math.round(points * 5 * multiplier));

  const roundDone = shots.length === MAX_SHOTS;
  const total = shots.reduce((sum, s) => sum + s.points, 0);

  const earned = [];
  if (shots.some(s => s.points > 0)) earned.push("first-blood");
  if (shots.some(s => s.points === 10)) earned.push("bullseye");
  if (roundBestCombo >= 3) earned.push("hot-streak");
  if (roundBestCombo >= 5) earned.push("inferno");
  if (progress.level >= 5) earned.push("level-5");
  if (roundDone && total >= 70) earned.push("round-master");
  if (roundDone && shots.every(s => s.points > 0)) earned.push("flawless");

  for (const id of earned) {
    if (progress.unlocked.includes(id)) continue;
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    progress = { ...progress, unlocked: [...progress.unlocked, id] };
    events.push({ kind: "badge", text: `${ach.name} unlocked! +${ACH_XP} XP` });
    award(ACH_XP);
  }

  let summary = null;
  if (roundDone) {
    const grade = gradeFor(total);
    award(ROUND_BONUS[grade]);
    progress = { ...progress, bestRound: Math.max(progress.bestRound, total) };
    summary = {
      total, grade,
      stars: starsFor(total),
      hits: shots.filter(s => s.points > 0).length,
      bestCombo: roundBestCombo,
      bonus: ROUND_BONUS[grade]
    };
  }

  // Keep at most three notifications on screen so they never bury the game.
  const toasts = [
    ...state.toasts,
    ...events.map((e, i) => ({ ...e, id: state.nextToast + i }))
  ].slice(-3);

  return {
    ...state,
    ...progress,
    shots,
    combo,
    roundBestCombo,
    summary,
    lastScore: points,
    notice: messageFor(points),
    flight: { key: shot.id, x: clamp(shot.x, -1.02, 1.02), y: clamp(shot.y, -1.02, 1.02) },
    toasts,
    nextToast: state.nextToast + events.length
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "SHOT":          return handleShot(state, action.shot);
    case "ROUND_FULL":    return { ...state, notice: "Round complete! Tap Play Again for a new round." };
    case "SET_POWER":     return { ...state, power: action.value };
    case "SET_WIND":      return { ...state, wind: action.value };
    case "RESET_ROUND":   return { ...state, ...freshRound(), power: 75, wind: 0 };
    case "NEW_SESSION":   return { ...state, ...freshRound("New session ready. Take your best shot!"), power: 75, wind: 0 };
    case "CLOSE_SUMMARY": return { ...state, summary: null };
    case "FLIGHT_DONE":   return { ...state, flight: null };
    case "TOGGLE_BADGES": return { ...state, showBadges: !state.showBadges };
    case "DISMISS_TOAST": return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    case "RESET_PROGRESS":return { ...state, level: 1, xp: 0, unlocked: [], bestRound: 0 };
    default:              return state;
  }
}

function Toast({ toast, dispatch }) {
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: "DISMISS_TOAST", id: toast.id }), 2800);
    return () => clearTimeout(timer);
  }, [dispatch, toast.id]);
  const Icon = toast.kind === "badge" ? Award : Star;
  return (
    <div className={`toast ${toast.kind}`} role="status">
      <Icon size={20} /> <span>{toast.text}</span>
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitial);
  const { shots, power, wind, level, xp, combo, unlocked, bestRound, summary, flight, notice, toasts, showBadges } = state;
  const nextId = useRef(1);

  const total = shots.reduce((sum, shot) => sum + shot.points, 0);
  const best = shots.length ? Math.max(...shots.map(s => s.points)) : 0;
  const accuracy = shots.length
    ? Math.round(shots.filter(s => s.points > 0).length / shots.length * 100)
    : 100;
  const roundOver = shots.length >= MAX_SHOTS;
  const xpMultiplier = (1 + Math.min(combo, 5) * 0.1).toFixed(1);

  // Persist progress (level, XP, badges, best round) across visits.
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ level, xp, unlocked, bestRound }));
    } catch {
      // Storage may be unavailable (private mode); the game still works.
    }
  }, [level, xp, unlocked, bestRound]);

  // Hide the arrow after its flight animation.
  useEffect(() => {
    if (!flight) return;
    const timer = setTimeout(() => dispatch({ type: "FLIGHT_DONE" }), 600);
    return () => clearTimeout(timer);
  }, [flight]);

  // Every shot uses the same rules: wind moves the aim point, then a random
  // scatter that shrinks with draw power and with the player's level (Focus).
  const shoot = useCallback((aimX = 0, aimY = 0) => {
    if (roundOver) {
      dispatch({ type: "ROUND_FULL" });
      return;
    }
    const focus = Math.min(level - 1, 10) * 0.03;
    const halfSpread = ((100 - power) / 100 * 0.5 + Math.abs(wind) * 0.01) * (1 - focus);
    const x = aimX + wind * WIND_DRIFT + (Math.random() - 0.5) * 2 * halfSpread;
    const y = aimY + (Math.random() - 0.5) * 2 * halfSpread;
    dispatch({ type: "SHOT", shot: { id: nextId.current++, x, y, points: scoreFor(x, y) } });
  }, [roundOver, level, power, wind]);

  // Space bar shoots, unless a button has focus or a dialog is open.
  useEffect(() => {
    const onKeyDown = e => {
      if (e.code !== "Space" || e.repeat) return;
      if (summary) return;
      if (["INPUT", "BUTTON"].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      shoot();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shoot, summary]);

  const onTargetClick = event => {
    // detail === 0 means the click came from the keyboard (Space/Enter on the
    // focused target), so there is no pointer position to use.
    if (event.detail === 0) {
      shoot();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const aimX = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const aimY = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    shoot(aimX, aimY);
  };

  const needed = xpNeeded(level);

  return (
    <main className="game-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo"><Target size={46} strokeWidth={2.5} /><span className="logo-arrow">➤</span></div>
          <div className="brand-copy">
            <h1>Archery <span>Game</span></h1>
            <p>Aim <b>•</b> Shoot <b>•</b> Score</p>
          </div>
        </div>
        <div className="stats-bar">
          <div className="top-stat"><Trophy className="trophy" size={35} fill="currentColor" /><div><span>Total Score</span><strong>{total}</strong></div></div>
          <div className="top-stat"><CircleGauge className="blue" size={35} /><div><span>Shots Taken</span><strong>{shots.length}<small> / {MAX_SHOTS}</small></strong></div></div>
          <div className="top-stat"><Percent className="green" size={35} /><div><span>Accuracy</span><strong>{accuracy}<small>%</small></strong></div></div>
        </div>
      </header>

      <section className="playfield">
        <div className="landscape">
          <div className="sky"><div className="cloud cloud-a" /><div className="cloud cloud-b" /><div className="mountain mountain-a" /><div className="mountain mountain-b" /><div className="mountain mountain-c" /></div>
          <div className="tree-line">
            {Array.from({ length: 32 }, (_, i) => (
              <span key={i} style={{ left: `${i * 3.25}%`, "--tree-height": `${55 + ((i * 17) % 48)}px` }} />
            ))}
          </div>
          <div className="fence"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
          <div className="meadow"><div className="grass-lines" /></div>
          <div className="banner"><Target size={48} /><strong>HIT<br />YOUR<br />TARGET</strong></div>
          <div className="bow-art" aria-hidden="true">
            <div className="bow-limb" /><div className="bow-string" /><div className="bow-grip" />
            <div className="flying-arrow"><span className="arrow-feather" /><span className="arrow-shaft" /><span className="arrow-tip" /></div>
          </div>
        </div>

        <div className="level-hud glass-panel" aria-label="Archer progress">
          <div className="level-badge"><span>LV</span><strong>{level}</strong></div>
          <div className="xp-block">
            <div className="xp-label"><span>Archer Rank</span><span>{xp} / {needed} XP</span></div>
            <div className="xp-bar"><i style={{ width: `${(xp / needed) * 100}%` }} /></div>
          </div>
          <div className="hud-chips">
            <span className="hud-chip">Focus +{focusPct(level)}%</span>
            {combo >= 2 && <span className="hud-chip combo"><Flame size={14} fill="currentColor" /> Combo x{combo} · XP x{xpMultiplier}</span>}
          </div>
        </div>

        <aside className="point-guide glass-panel">
          <h2>Point Guide</h2>
          {ZONES.map(zone => (
            <div className="guide-row" key={zone.points}>
              <i className="swatch" style={{ background: zone.color }} />
              <span>{zone.name}</span>
              <strong>{zone.points}</strong>
            </div>
          ))}
          <p className="guide-note">Missing the target scores 0.</p>
        </aside>

        <div className="target-wrap">
          <div className="target-shadow" />
          <button className="target" onClick={onTargetClick} aria-label="Shoot at the target" disabled={roundOver}>
            <div className="ring ring-white"><span className="ring-label label-one">1</span></div>
            <div className="ring ring-black"><span className="ring-label label-two">2</span></div>
            <div className="ring ring-blue"><span className="ring-label label-three">3</span></div>
            <div className="ring ring-red"><span className="ring-label label-five">5</span></div>
            <div className="ring ring-gold"><span className="ring-label label-seven">7</span></div>
            <div className="ring ring-center"><span>10</span></div>
            {shots.map((shot, i) => (
              <span
                className="target-hit"
                key={shot.id}
                style={{
                  left: `calc(50% + ${clamp(shot.x, -1.02, 1.02) * 50}%)`,
                  top: `calc(50% + ${clamp(shot.y, -1.02, 1.02) * 50}%)`
                }}
                title={`Shot ${i + 1}: ${shot.points} points`}
              >
                <i />
              </span>
            ))}
          </button>
          {flight && (
            <div
              key={flight.key}
              className="shot-arrow"
              style={{ left: `calc(50% + ${flight.x * 50}%)`, top: `calc(50% + ${flight.y * 50}%)` }}
            >
              <span className="arrow-feather" />
              <span className="arrow-shaft" />
              <span className="arrow-tip" />
            </div>
          )}
          <div className="target-legs"><span /><span /></div>
        </div>

        <section className="controls glass-panel">
          <div className="slider-control">
            <div className="slider-label"><span><Zap size={19} fill="currentColor" /> Draw Power</span><strong>{power}%</strong></div>
            <input aria-label="Draw power" type="range" min="20" max="100" value={power}
              onChange={e => dispatch({ type: "SET_POWER", value: Number(e.target.value) })}
              style={{ "--progress": `${(power - 20) / 80 * 100}%` }} />
          </div>
          <div className="control-divider" />
          <div className="slider-control">
            <div className="slider-label"><span><Wind size={21} /> Wind Angle</span><strong>{wind}°</strong></div>
            <input aria-label="Wind angle" type="range" min="-15" max="15" value={wind}
              onChange={e => dispatch({ type: "SET_WIND", value: Number(e.target.value) })}
              style={{ "--progress": `${(wind + 15) / 30 * 100}%` }} />
          </div>
          <button className="shoot-button" onClick={() => shoot()} disabled={roundOver}>
            <Crosshair size={28} strokeWidth={3} /> Shoot
          </button>
        </section>

        <div className="instruction-pill" role="status" aria-live="polite"><Move size={23} /><span>{notice}</span></div>
        <div className="action-buttons">
          <button onClick={() => dispatch({ type: "RESET_ROUND" })}><RotateCcw size={21} /> Reset Game</button>
          <button onClick={() => dispatch({ type: "TOGGLE_BADGES" })}><Award size={21} /> Badges {unlocked.length}/{ACHIEVEMENTS.length}</button>
          <button onClick={() => dispatch({ type: "NEW_SESSION" })}><Trophy size={21} fill="currentColor" /> New Session</button>
        </div>
      </section>

      <footer className="history-bar">
        <div className="last-shot"><Target size={39} /><div><span>Last Shot</span><strong>{state.lastScore === null ? "—" : `${state.lastScore} points`}</strong></div></div>
        <div className="history-divider" />
        <div className="shot-history">
          <span className="history-title">Shot History</span>
          <div className="shot-circles">
            {Array.from({ length: MAX_SHOTS }, (_, i) => {
              const shot = shots[i];
              const cls = [shot ? "shot-done" : "", shot?.points === 10 ? "perfect" : ""].join(" ").trim();
              return <span key={i} className={cls}>{shot ? shot.points : "–"}</span>;
            })}
          </div>
        </div>
        <div className="best-shot"><Sparkles size={31} fill="currentColor" /><div><span>Best Shot</span><strong>{shots.length ? `${best} points` : "—"}</strong></div></div>
        <div className="history-divider" />
        <div className="best-round"><Trophy size={31} fill="currentColor" /><div><span>Best Round</span><strong>{bestRound ? `${bestRound} points` : "—"}</strong></div></div>
      </footer>
      <div className="bottom-glow" />

      <div className="toast-stack">
        {toasts.map(t => <Toast key={t.id} toast={t} dispatch={dispatch} />)}
      </div>

      {summary && (
        <div className="modal-backdrop">
          <div className="modal glass-panel" role="dialog" aria-modal="true" aria-label="Round summary">
            <div className={`grade grade-${summary.grade}`}>{summary.grade}</div>
            <h2>Round Complete!</h2>
            <div className="stars">
              {[1, 2, 3].map(n => (
                <Star key={n} size={36} className={n <= summary.stars ? "star-on" : "star-off"} fill={n <= summary.stars ? "currentColor" : "none"} />
              ))}
            </div>
            <div className="summary-grid">
              <div><span>Score</span><strong>{summary.total}</strong></div>
              <div><span>Hits</span><strong>{summary.hits} / {MAX_SHOTS}</strong></div>
              <div><span>Best Combo</span><strong>{summary.bestCombo}</strong></div>
              <div><span>Bonus XP</span><strong>+{summary.bonus}</strong></div>
            </div>
            <div className="modal-actions">
              <button onClick={() => dispatch({ type: "CLOSE_SUMMARY" })}>Close</button>
              <button className="primary" onClick={() => dispatch({ type: "NEW_SESSION" })}>Play Again</button>
            </div>
          </div>
        </div>
      )}

      {showBadges && (
        <div className="modal-backdrop" onClick={() => dispatch({ type: "TOGGLE_BADGES" })}>
          <div className="modal glass-panel" role="dialog" aria-modal="true" aria-label="Badges" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Badges</h2>
              <button className="icon-btn" aria-label="Close badges" onClick={() => dispatch({ type: "TOGGLE_BADGES" })}><X size={20} /></button>
            </div>
            <div className="badge-grid">
              {ACHIEVEMENTS.map(a => {
                const got = unlocked.includes(a.id);
                const Icon = a.icon;
                return (
                  <div key={a.id} className={`badge ${got ? "got" : "locked"}`}>
                    {got ? <Icon size={28} /> : <Lock size={24} />}
                    <strong>{a.name}</strong>
                    <span>{a.desc}</span>
                  </div>
                );
              })}
            </div>
            <div className="summary-grid">
              <div><span>Level</span><strong>{level}</strong></div>
              <div><span>Best Round</span><strong>{bestRound}</strong></div>
            </div>
            <button className="link-btn" onClick={() => {
              if (window.confirm("Reset your level, XP and badges?")) dispatch({ type: "RESET_PROGRESS" });
            }}>Reset progress</button>
          </div>
        </div>
      )}
    </main>
  );
}
