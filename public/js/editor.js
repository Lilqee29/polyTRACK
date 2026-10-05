import { chaikinClosed, resampleEven, buildSpline } from "./track.js";
import { makePreset, validatePreset } from "./presets.js";

export function initEditor({ onRace, store }) {
  const canvas = document.getElementById("ed-canvas");
  const ctx = canvas.getContext("2d");
  const nameEl = document.getElementById("ed-name");
  const widthEl = document.getElementById("ed-width");
  const widthV = document.getElementById("ed-width-v");
  const smoothEl = document.getElementById("ed-smooth");
  const smoothV = document.getElementById("ed-smooth-v");
  const themeEl = document.getElementById("ed-theme");
  const hillsEl = document.getElementById("ed-hills");
  const hillsV = document.getElementById("ed-hills-v");
  const hint = document.getElementById("ed-hint");

  let raw = []; // control points [[x,y],...] authoritative
  let selected = -1;
  let dragging = false;
  let capture = null; // array while drawing
  let captureLen = 0;
  let elevSeed = Math.floor(Math.random() * 0x7fffffff); // stable per track edit

  const toast = (m) => (window.toast ? window.toast(m) : console.warn(m));

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.width) / r.width,
      ((e.clientY - r.top) * canvas.height) / r.height,
    ];
  }

  function hitPoint(x, y) {
    for (let i = raw.length - 1; i >= 0; i--) {
      const d = Math.hypot(raw[i][0] - x, raw[i][1] - y);
      if (d < 11) return i;
    }
    return -1;
  }

  function segDist(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  function nearestSeg(p) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < raw.length; i++) {
      const d = segDist(p, raw[i], raw[(i + 1) % raw.length]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { i: best, d: bd };
  }

  function loopLength(pts) {
    let L = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return L;
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const [x, y] = toCanvas(e);
    const hit = hitPoint(x, y);
    if (hit >= 0) {
      selected = hit;
      dragging = true;
      return;
    }
    capture = [[x, y]];
    captureLen = 0;
  });

  canvas.addEventListener("mousemove", (e) => {
    const [x, y] = toCanvas(e);
    if (dragging && selected >= 0) {
      raw[selected] = [x, y];
      return;
    }
    if (capture) {
      const last = capture[capture.length - 1];
      const d = Math.hypot(x - last[0], y - last[1]);
      if (d > 6) {
        captureLen += d;
        capture.push([x, y]);
      }
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (dragging) {
      dragging = false;
      return;
    }
    if (!capture) return;
    const cap = capture;
    capture = null;
    if (cap.length >= 4 && captureLen > 300) {
      raw = cap;
      selected = -1;
      hint.textContent = "Nice loop! Drag the dots to fine-tune, then save or race.";
    } else if (cap.length >= 12) {
      toast("Draw a bigger loop");
    }
  });

  canvas.addEventListener("dblclick", (e) => {
    const [x, y] = toCanvas(e);
    if (raw.length < 3) return;
    const { i, d } = nearestSeg([x, y]);
    if (i >= 0 && d < 14) {
      raw.splice(i + 1, 0, [x, y]);
      selected = i + 1;
    }
  });

  widthEl.addEventListener("input", () => (widthV.textContent = widthEl.value));
  smoothEl.addEventListener("input", () => (smoothV.textContent = smoothEl.value));
  hillsEl.addEventListener("input", () => (hillsV.textContent = hillsEl.value));

  document.getElementById("ed-clear").addEventListener("click", () => {
    if (raw.length && !confirm("Clear this track?")) return;
    raw = [];
    selected = -1;
    hint.textContent = "Draw a loop with the mouse — then drag the dots to fine-tune.";
  });

  function currentPreset() {
    return makePreset(
      nameEl.value.trim() || "Untitled",
      raw,
      Number(widthEl.value),
      Number(smoothEl.value),
      {
        theme: themeEl.value,
        elev: { amp: Number(hillsEl.value), seed: elevSeed },
      }
    );
  }

  document.getElementById("ed-save").addEventListener("click", () => {
    const p = currentPreset();
    const v = validatePreset(p);
    if (v !== true) {
      toast(v === "points must be finite [x,y] pairs" ? "Draw a loop first" : v);
      return;
    }
    store.save(p);
    toast(`Saved "${p.name}"`);
    document.dispatchEvent(new CustomEvent("polytrack:presets-changed"));
  });

  document.getElementById("ed-race").addEventListener("click", () => {
    const p = currentPreset();
    const v = validatePreset(p);
    if (v !== true) {
      toast(v === "points must be finite [x,y] pairs" ? "Draw a loop first" : v);
      return;
    }
    onRace(p);
  });

  document.getElementById("ed-back").addEventListener("click", () => {
    location.hash = "#menu";
  });

  function polyline(pts, color, widthPx, close) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.stroke();
  }

  function render() {
    if (document.getElementById("screen-editor").classList.contains("active")) {
      ctx.fillStyle = "#0a101f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(70,90,140,.25)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      const n = Number(smoothEl.value);
      if (capture) {
        polyline(capture, "#eef2f7", 3, false);
      } else if (raw.length >= 2) {
        if (n > 0 && raw.length >= 4) {
          const sm = chaikinClosed(raw, n);
          const dense = resampleEven(sm, 4, true);
          const spline = buildSpline(dense, true, 6);
          polyline(spline.pts, "#4ade80", 6, true);
        }
        polyline(raw, "rgba(238,242,247,.45)", 2, true);
        for (let i = 0; i < raw.length; i++) {
          const [x, y] = raw[i];
          ctx.beginPath();
          ctx.arc(x, y, i === selected ? 9 : 6, 0, Math.PI * 2);
          ctx.fillStyle = i === selected ? "#f59e0b" : i === 0 ? "#eef2f7" : "#4ade80";
          ctx.fill();
          ctx.strokeStyle = "#0a101f";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (raw.length >= 4) {
          const [x, y] = raw[0];
          ctx.fillStyle = "#eef2f7";
          ctx.font = "bold 13px system-ui";
          ctx.fillText("START", x + 12, y + 4);
        }
      } else {
        ctx.fillStyle = "rgba(139,151,179,.5)";
        ctx.font = "16px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("draw your track here", canvas.width / 2, canvas.height / 2);
        ctx.textAlign = "start";
      }
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  return {
    open() {
      hint.textContent = raw.length
        ? "Drag dots to fine-tune. Double-click the road to add a point."
        : "Draw a loop with the mouse — then drag the dots to fine-tune.";
    },
    load(preset) {
      raw = (preset.points || []).map(([x, y]) => [x, y]);
      selected = -1;
      nameEl.value = preset.name || "";
      widthEl.value = String(preset.width ?? 14);
      widthV.textContent = widthEl.value;
      smoothEl.value = String(preset.smoothing ?? 3);
      smoothV.textContent = smoothEl.value;
      themeEl.value = ["summer", "winter", "desert"].includes(preset.theme)
        ? preset.theme
        : "summer";
      hillsEl.value = String(Math.min(30, Math.max(0, preset.elev?.amp ?? 0)));
      hillsV.textContent = hillsEl.value;
      elevSeed = Number.isFinite(preset.elev?.seed)
        ? preset.elev.seed
        : Math.floor(Math.random() * 0x7fffffff);
      if (raw.length) hint.textContent = "Loaded preset — drag dots to edit.";
    },
  };
}
