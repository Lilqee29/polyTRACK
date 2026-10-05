import * as THREE from "./vendor/three.module.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function leftNormal(pts, i) {
  const n = pts.length;
  const prev = pts[(i - 1 + n) % n];
  const next = pts[(i + 1) % n];
  let dx = next[0] - prev[0];
  let dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  return [dz, -dx, Math.atan2(dz, dx)]; // left normal + tangent heading
}

// Strip between two signed lateral offsets (left positive), flat at y.
function buildStrip(pts, latA, latB, y, colorFn) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const [nx, nz] = leftNormal(pts, i);
    const p = pts[i];
    const c = colorFn(i);
    const o = i * 6;
    pos[o] = p[0] + nx * latA;
    pos[o + 1] = y;
    pos[o + 2] = p[1] + nz * latA;
    pos[o + 3] = p[0] + nx * latB;
    pos[o + 4] = y;
    pos[o + 5] = p[1] + nz * latB;
    col[o] = col[o + 3] = c[0];
    col[o + 1] = col[o + 4] = c[1];
    col[o + 2] = col[o + 5] = c[2];
  }
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    idx[o] = a;
    idx[o + 1] = a + 1;
    idx[o + 2] = a + 2;
    idx[o + 3] = a + 1;
    idx[o + 4] = a + 3;
    idx[o + 5] = a + 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

function buildStartLine(pts, widthWorld) {
  const [nx, nz, heading] = leftNormal(pts, 0);
  const p = pts[0];
  const half = widthWorld / 2;
  const cells = Math.max(6, Math.round(widthWorld));
  const cw = widthWorld / cells;
  const positions = [];
  const colors = [];
  const pushQuad = (lat0, lat1, f0, f1, white) => {
    const c = white ? 1 : 0.06;
    const y = 0.05;
    const corner = (lat, f) => [p[0] + nx * lat + Math.cos(heading) * f, p[1] + nz * lat + Math.sin(heading) * f];
    const q = [corner(lat0, f0), corner(lat1, f0), corner(lat1, f1), corner(lat0, f1)];
    const tri = [0, 1, 2, 0, 2, 3];
    for (const t of tri) {
      positions.push(q[t][0], y, q[t][1]);
      colors.push(c, c, c);
    }
  };
  const rowLen = 1.2;
  for (let k = 0; k < cells; k++) {
    const lat0 = -half + k * cw + 0.02;
    const lat1 = -half + (k + 1) * cw - 0.02;
    pushQuad(lat0, lat1, -rowLen, -0.01, k % 2 === 0);
    pushQuad(lat0, lat1, 0.01, rowLen, k % 2 !== 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  return g;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x9ec7ff);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9ec7ff, 130, 430);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 800);
  camera.position.set(0, 12, -20);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3f7d44, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.far = 320;
  scene.add(sun);

  let trackGroup = null;
  let trackInfo = null;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    scene.remove(group);
  }

  function setTrack(world, seedStr = "polytrack") {
    disposeGroup(trackGroup);
    const g = new THREE.Group();
    const pts = world.spline.pts;
    const half = world.widthWorld / 2;
    const rand = mulberry32(hashStr(seedStr));
    trackInfo = { pts, half, world };

    // asphalt with slight value jitter
    const asphalt = buildStrip(pts, half, -half, 0.03, (i) => {
      const v = 0.2 + (i % 7) * 0.006;
      return [v, v + 0.015, v + 0.05];
    });
    g.add(new THREE.Mesh(asphalt, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));

    // shoulders
    const dirt = () => [0.4, 0.36, 0.27];
    const shL = buildStrip(pts, half + 1.5, half, 0.02, dirt);
    const shR = buildStrip(pts, -half, -(half + 1.5), 0.02, dirt);
    const dirtMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    g.add(new THREE.Mesh(shL, dirtMat));
    g.add(new THREE.Mesh(shR, dirtMat.clone()));

    // start line
    const startMesh = new THREE.Mesh(
      buildStartLine(pts, world.widthWorld),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })
    );
    g.add(startMesh);

    // pylons at start
    const pylonGeo = new THREE.BoxGeometry(0.4, 1.7, 0.4);
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xe11d42, roughness: 0.5 });
    const [snx, snz] = leftNormal(pts, 0);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(pylonGeo, pylonMat);
      m.position.set(pts[0][0] + snx * side * (half + 0.9), 0.85, pts[0][1] + snz * side * (half + 0.9));
      m.castShadow = true;
      g.add(m);
    }

    // curbs: alternating red/white instanced boxes
    const curbGeo = new THREE.BoxGeometry(2, 0.24, 0.55);
    const reds = [];
    const whites = [];
    for (let i = 0; i < pts.length; i += 6) {
      const [nx, nz, hd] = leftNormal(pts, i);
      for (const side of [1, -1]) {
        const rec = {
          x: pts[i][0] + nx * side * half,
          z: pts[i][1] + nz * side * half,
          hd,
        };
        ((i / 6) % 2 === 0 ? reds : whites).push(rec);
      }
    }
    const addCurbInst = (list, color) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
      const inst = new THREE.InstancedMesh(curbGeo, mat, list.length);
      const dummy = new THREE.Object3D();
      list.forEach((r, i) => {
        dummy.position.set(r.x, 0.13, r.z);
        dummy.rotation.set(0, -r.hd, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      g.add(inst);
    };
    addCurbInst(reds, 0xe11d42);
    addCurbInst(whites, 0xf8fafc);

    // ground with far-field jitter
    const groundGeo = new THREE.PlaneGeometry(640, 640, 44, 44);
    groundGeo.rotateX(-Math.PI / 2);
    const gp = groundGeo.attributes.position;
    const gcol = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const z = gp.getZ(i);
      // cheap distance check: nearest sample (full scan but coarse — sample every 4th)
      let bd = Infinity;
      for (let k = 0; k < pts.length; k += 4) {
        const d = (pts[k][0] - x) ** 2 + (pts[k][1] - z) ** 2;
        if (d < bd) bd = d;
      }
      bd = Math.sqrt(bd);
      if (bd > half + 6) gp.setY(i, (rand() - 0.5) * 0.7);
      const shade = 0.55 + rand() * 0.35 - Math.min(0.2, bd * 0.0008);
      gcol[i * 3] = 0.18 * shade + 0.06;
      gcol[i * 3 + 1] = 0.55 * shade;
      gcol[i * 3 + 2] = 0.25 * shade;
    }
    groundGeo.setAttribute("color", new THREE.BufferAttribute(gcol, 3));
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
    );
    ground.receiveShadow = true;
    g.add(ground);

    // props: trees + buildings, seeded, clear of track
    const treeTrunk = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafGeo = new THREE.ConeGeometry(2.3, 6, 7);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f43, roughness: 0.9 });
    const bldgMats = [0xc9d4e5, 0xaeb9cf, 0x8f9bb3].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
    );
    let placed = 0;
    let tries = 0;
    while (placed < 44 && tries < 500) {
      tries++;
      const x = (rand() - 0.5) * 300;
      const z = (rand() - 0.5) * 300;
      let bd = Infinity;
      for (let k = 0; k < pts.length; k += 3) {
        const d = (pts[k][0] - x) ** 2 + (pts[k][1] - z) ** 2;
        if (d < bd) bd = d;
      }
      if (Math.sqrt(bd) < half + 8) continue;
      placed++;
      if (rand() < 0.62) {
        const trunk = new THREE.Mesh(treeTrunk, trunkMat);
        trunk.position.set(x, 1.2, z);
        trunk.castShadow = true;
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        const s = 0.7 + rand() * 0.9;
        leaf.scale.set(s, s + rand() * 0.5, s);
        leaf.position.set(x, 3.4 + s * 1.6, z);
        leaf.castShadow = true;
        g.add(trunk, leaf);
      } else {
        const w = 5 + rand() * 8;
        const h = 5 + rand() * 12;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bldgMats[(rand() * bldgMats.length) | 0]);
        b.position.set(x, h / 2, z);
        b.rotation.y = rand() * Math.PI;
        b.castShadow = true;
        b.receiveShadow = true;
        g.add(b);
      }
    }

    scene.add(g);
    trackGroup = g;
  }

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 });

  function addCar(colorHex) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.7, 4.2),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45, metalness: 0.15 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.55, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.3 })
    );
    cabin.position.set(0, 1.45, -0.15);
    cabin.castShadow = true;
    grp.add(body, cabin);
    for (const [wx, wz] of [
      [-1.02, 1.35],
      [1.02, 1.35],
      [-1.02, -1.35],
      [1.02, -1.35],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.42, wz);
      w.castShadow = true;
      grp.add(w);
    }
    scene.add(grp);
    return grp;
  }

  function moveCar(obj, x, z, heading) {
    obj.position.set(x, 0, z);
    obj.rotation.y = Math.PI / 2 - heading; // model nose is +Z; heading 0 = +X
  }

  function removeCar(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    scene.remove(obj);
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    window.removeEventListener("resize", resize);
    disposeGroup(trackGroup);
    renderer.dispose();
  }

  return { renderer, scene, camera, setTrack, addCar, moveCar, removeCar, render, dispose, resize, get trackInfo() { return trackInfo; } };
}
