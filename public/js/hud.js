let els = null;

function E(id) {
  return document.getElementById(id);
}

export function hudInit() {
  els = {
    root: E("hud"),
    speed: E("hud-speed"),
    lap: E("hud-lap"),
    pos: E("hud-pos"),
    mm: E("hud-minimap"),
    cd: E("hud-countdown"),
    note: E("hud-note"),
  };
  return els;
}

export function hudShow(visible) {
  if (!els) hudInit();
  els.root.classList.toggle("hidden", !visible);
  if (!visible) {
    hudCountdown(null);
    hudNote("");
  }
}

export function hudCountdown(txt) {
  if (!els) hudInit();
  if (txt == null) els.cd.classList.add("hidden");
  else {
    els.cd.classList.remove("hidden");
    els.cd.textContent = txt;
  }
}

export function hudNote(txt) {
  if (!els) hudInit();
  els.note.textContent = txt || "";
}

export function hudUpdate({ speedKmh, lap, lapTotal, pos, total, map }) {
  if (!els) hudInit();
  if (els.speed.firstChild) els.speed.firstChild.nodeValue = String(Math.round(speedKmh));
  els.lap.textContent = `Lap ${Math.min(lap + 1, lapTotal)}/${lapTotal}`;
  els.pos.textContent = `${pos}/${total}`;
  if (map) drawMinimap(map);
}

function drawMinimap({ outline, bounds, cars }) {
  const ctx = els.mm.getContext("2d");
  const w = els.mm.width;
  const h = els.mm.height;
  ctx.clearRect(0, 0, w, h);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const s = Math.min((w - 14) / spanX, (h - 14) / spanZ);
  const ox = (w - spanX * s) / 2;
  const oz = (h - spanZ * s) / 2;
  const mx = (x) => ox + (x - bounds.minX) * s;
  const mz = (z) => oz + (z - bounds.minZ) * s;

  ctx.beginPath();
  outline.forEach(([x, z], i) => (i ? ctx.lineTo(mx(x), mz(z)) : ctx.moveTo(mx(x), mz(z))));
  ctx.closePath();
  ctx.strokeStyle = "#4ade80";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const c of cars) {
    ctx.beginPath();
    ctx.arc(mx(c.x), mz(c.z), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
