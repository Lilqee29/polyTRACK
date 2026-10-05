let ws = null;
let myId = null;
let isHost = false;
let wired = false;
let currentPreset = null;
let intentional = false;

const people = new Map(); // id -> name
const buffers = new Map(); // id -> [{t,x,z,heading,v,lap,s}]

const state = {
  get myId() {
    return myId;
  },
  get people() {
    return people;
  },
  get buffers() {
    return buffers;
  },
  countdownAt: null,
  sendState(payload) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "state", ...payload }));
  },
  sendFinish(ms) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "finish", ms }));
  },
};

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function firePeers() {
  window.dispatchEvent(
    new CustomEvent("polytrack:mp-peers", {
      detail: { people: [...people].map(([id, name]) => ({ id, name })) },
    })
  );
}

export function openLobby({ store }) {
  const $ = (id) => document.getElementById(id);
  const statusEl = $("lobby-status");
  const peersEl = $("lobby-peers");
  const nameEl = $("lobby-name");
  const trackRow = $("lobby-track-row");
  const trackSel = $("lobby-track");
  const startBtn = $("lobby-start");
  const hintEl = $("lobby-hint");

  window.__mp = state;
  if (!nameEl.value) nameEl.value = sessionStorage.getItem("polytrack.myname") || "Player";

  const renderPeers = () => {
    peersEl.innerHTML = "";
    for (const [id, name] of people) {
      if (id === myId) continue;
      const li = document.createElement("li");
      li.textContent = name;
      peersEl.appendChild(li);
    }
    const li = document.createElement("li");
    li.innerHTML = "<b>you</b> ";
    li.appendChild(document.createTextNode(nameEl.value + (isHost ? " (HOST)" : "")));
    peersEl.appendChild(li);
    statusEl.textContent = isHost
      ? "Connected — you are the HOST"
      : "Connected — waiting for host";
  };

  const fillTracks = () => {
    const list = store.list();
    trackSel.innerHTML = "";
    for (const p of list) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      trackSel.appendChild(opt);
    }
    if (isHost) {
      trackRow.classList.toggle("hidden", false);
      if (!list.length) {
        hintEl.textContent = "No presets yet — draw one in the editor first.";
        startBtn.disabled = true;
      } else if (!currentPreset) {
        hintEl.textContent = "Pick a track, then start the race.";
        startBtn.disabled = true;
      }
    }
  };

  if (!wired) {
    wired = true;
    nameEl.addEventListener("change", () => {
      sessionStorage.setItem("polytrack.myname", nameEl.value);
      send({ t: "join", name: nameEl.value });
    });

    trackSel.addEventListener("change", () => {
      if (!isHost) return;
      currentPreset = store.get(trackSel.value);
      if (currentPreset) {
        send({ t: "track", preset: currentPreset });
        hintEl.textContent = `Track "${currentPreset.name}" sent — press Start when ready.`;
        startBtn.disabled = false;
      }
    });

    startBtn.addEventListener("click", () => {
      if (!isHost || !currentPreset) return;
      send({ t: "track", preset: currentPreset });
      const at = Date.now() + 3000;
      state.countdownAt = at;
      send({ t: "start", countdownAt: at });
      sessionStorage.setItem("polytrack.current", JSON.stringify(currentPreset));
      sessionStorage.setItem("polytrack.mode", "mp");
      location.hash = "#race";
    });

    $("lobby-leave").addEventListener("click", () => {
      intentional = true;
      location.hash = "#menu";
      if (ws) ws.close();
      ws = null;
      window.__mp = null;
    });
  }

  fillTracks();
  renderPeers();

  const proto = location.protocol === "https:" ? "wss" : "ws";
  if (!ws || ws.readyState > 1) {
    intentional = false;
    statusEl.textContent = "Connecting…";
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    ws = sock;

    sock.addEventListener("open", () => {
      if (ws !== sock) return;
      send({ t: "join", name: nameEl.value });
      renderPeers();
    });

    sock.addEventListener("message", (ev) => {
      if (ws !== sock) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case "you":
          myId = msg.id;
          isHost = !!msg.host;
          fillTracks();
          renderPeers();
          if (isHost && currentPreset) startBtn.disabled = false;
          break;
        case "peers":
          people.clear();
          for (const p of msg.people || []) people.set(p.id, p.name);
          firePeers();
          renderPeers();
          break;
        case "joined":
          people.set(msg.id, msg.name);
          firePeers();
          renderPeers();
          break;
        case "left":
          people.delete(msg.id);
          buffers.delete(msg.id);
          firePeers();
          renderPeers();
          break;
        case "track":
          currentPreset = msg.preset;
          sessionStorage.setItem("polytrack.current", JSON.stringify(currentPreset));
          if (!isHost) hintEl.textContent = `Track "${currentPreset?.name ?? "?"}" received — waiting for start…`;
          break;
        case "start":
          state.countdownAt = msg.countdownAt;
          sessionStorage.setItem("polytrack.mode", "mp");
          location.hash = "#race";
          break;
        case "finish":
          window.dispatchEvent(
            new CustomEvent("polytrack:mp-finish", { detail: { id: msg.from, ms: msg.ms } })
          );
          break;
        case "relay": {
          const m = msg.msg;
          if (!m || m.t !== "state" || ![m.x, m.z, m.heading].every(Number.isFinite)) return;
          let buf = buffers.get(msg.from);
          if (!buf) {
            buf = [];
            buffers.set(msg.from, buf);
          }
          buf.push({
            t: performance.now(),
            x: m.x,
            z: m.z,
            heading: m.heading,
            v: Number.isFinite(m.v) ? m.v : 0,
            lap: m.lap | 0,
            s: Number.isFinite(m.s) ? m.s : 0,
          });
          if (buf.length > 60) buf.shift();
          break;
        }
      }
    });

    sock.addEventListener("close", () => {
      if (ws !== sock) return;
      ws = null;
      window.__mp = null;
      if (intentional) return;
      const inSession =
        document.getElementById("screen-lobby").classList.contains("active") ||
        document.getElementById("screen-race").classList.contains("active");
      if (inSession) {
        toast("Disconnected from host");
        location.hash = "#menu";
      }
    });
  }
}
