import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SimulationEngine, BUILDINGS, PROBLEM_TYPES } from './simulation.js';
import * as api from './api.js';

const engine = new SimulationEngine();
const recommendations = new Map();
const buildingGroups = new Map();

let currentBuildingId = null;
let hoveredBuildingId = null;
let isApiKeyReady = false;

const container = document.querySelector('.scene-container');
const canvas = document.getElementById('scene-canvas');
const tooltip = document.getElementById('tooltip');

const clockEl = document.getElementById('clock');
const simStateEl = document.getElementById('sim-state');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnStop = document.getElementById('btn-stop');
const eventLog = document.getElementById('event-log');
const activeProblemsEl = document.getElementById('active-problems');

const simPanel = document.getElementById('sim-panel');
const toggleSimPanel = document.getElementById('toggle-sim-panel');
const closeSimPanel = document.getElementById('close-sim-panel');

const injectForm = document.getElementById('inject-form');
const injectBuilding = document.getElementById('inject-building');
const injectType = document.getElementById('inject-type');
const injectDuration = document.getElementById('inject-duration');

const dashboardModal = document.getElementById('dashboard-modal');
const dashboardTitle = document.getElementById('dashboard-title');
const closeDashboard = document.getElementById('close-dashboard');
const chartCanvas = document.getElementById('energy-chart');
const insightText = document.getElementById('insight-text');
const btnAiRecommend = document.getElementById('btn-ai-recommend');
const aiStatus = document.getElementById('ai-status');
const btnResolveAi = document.getElementById('btn-resolve-ai');
const resolveStatus = document.getElementById('resolve-status');

const apiKeyInput = document.getElementById('api-key');
const keyStatus = document.getElementById('key-status');
const navList = document.getElementById('nav-list');
const resetView = document.getElementById('reset-view');

let scene, camera, renderer, controls, raycaster, mouse;

function initUI() {
  // Sidebar nav
  for (const b of BUILDINGS) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="color-swatch" style="background:${b.color}"></span>${b.name}`;
    btn.onclick = () => openDashboard(b.id);
    li.appendChild(btn);
    navList.appendChild(li);
  }

  // Inject form selects
  for (const b of BUILDINGS) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    injectBuilding.appendChild(opt);
  }
  for (const [key, type] of Object.entries(PROBLEM_TYPES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = type.label;
    injectType.appendChild(opt);
  }
  injectType.onchange = () => {
    const type = PROBLEM_TYPES[injectType.value];
    if (type) injectDuration.value = type.defaultDuration;
  };
  injectDuration.value = PROBLEM_TYPES[Object.keys(PROBLEM_TYPES)[0]].defaultDuration;

  // API key
  apiKeyInput.value = sessionStorage.getItem('geminiApiKey') || '';
  apiKeyInput.addEventListener('input', () => {
    sessionStorage.setItem('geminiApiKey', apiKeyInput.value);
    updateKeyStatus();
  });
  updateKeyStatus();

  updateControlState();
  updateActiveProblems();
  clockEl.textContent = engine.timeString;
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x04060d);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.65;
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  scene = new THREE.Scene();
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog(0x05070f, 50, 150);

  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 26, 44);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 12;
  controls.maxDistance = 90;
  controls.enablePan = false;

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x9fe4ff, 0x0a1020, 1.9);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 3.8);
  dir.position.set(14, 30, 30);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 140;
  dir.shadow.camera.left = -40;
  dir.shadow.camera.right = 40;
  dir.shadow.camera.top = 40;
  dir.shadow.camera.bottom = -40;
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xbfe9ff, 1.5);
  fill.position.set(-14, 18, 36);
  scene.add(fill);

  const cyanLight = new THREE.PointLight(0x4fd1c5, 3.2, 110, 2);
  cyanLight.position.set(22, 17, 22);
  scene.add(cyanLight);

  const violetLight = new THREE.PointLight(0xa855f7, 2.4, 110, 2);
  violetLight.position.set(-22, 15, -14);
  scene.add(violetLight);

  const skyLight = new THREE.PointLight(0x38bdf8, 2.0, 130, 2);
  skyLight.position.set(0, 30, 0);
  scene.add(skyLight);

  // Ground & grid
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x12233f, roughness: 0.82, metalness: 0.35 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(140, 70, 0x5bb8e8, 0x2a5f8f);
  grid.position.y = 0.02;
  if (grid.material) {
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
  }
  scene.add(grid);

  const fineGrid = new THREE.GridHelper(140, 140, 0x3f8fbf, 0x1e3a5f);
  fineGrid.position.y = 0.015;
  if (fineGrid.material) {
    fineGrid.material.transparent = true;
    fineGrid.material.opacity = 0.3;
  }
  scene.add(fineGrid);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(15.5, 16.15, 96),
    new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  scene.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(3.0, 3.25, 64),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.26, side: THREE.DoubleSide })
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.045;
  scene.add(innerRing);

  // Starfield
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 60 + Math.random() * 90;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 6;
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xbfe9ff,
    size: 0.55,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(starGeometry, starMaterial));

  // Campus grounds
  createCampusGrounds();

  // Buildings arranged in a pentagon, each facing the central quad
  const radius = 14;
  const positions = [
    { id: 'admin', x: radius * Math.sin(0 * (Math.PI * 2) / 5), z: radius * Math.cos(0 * (Math.PI * 2) / 5) },
    { id: 'classrooms', x: radius * Math.sin(1 * (Math.PI * 2) / 5), z: radius * Math.cos(1 * (Math.PI * 2) / 5) },
    { id: 'labs', x: radius * Math.sin(2 * (Math.PI * 2) / 5), z: radius * Math.cos(2 * (Math.PI * 2) / 5) },
    { id: 'cafeteria', x: radius * Math.sin(3 * (Math.PI * 2) / 5), z: radius * Math.cos(3 * (Math.PI * 2) / 5) },
    { id: 'hostels', x: radius * Math.sin(4 * (Math.PI * 2) / 5), z: radius * Math.cos(4 * (Math.PI * 2) / 5) }
  ];

  for (const pos of positions) {
    const b = BUILDINGS.find(b => b.id === pos.id);
    createBuilding(b, pos);
  }

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('click', onCanvasClick);
  renderer.domElement.addEventListener('pointerleave', () => {
    hoveredBuildingId = null;
    tooltip.classList.remove('visible');
    document.body.style.cursor = 'default';
    updateBuildingVisuals();
  });

  window.addEventListener('resize', onResize);
  animate();
}

function createSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#0a1730');
  gradient.addColorStop(0.4, '#060c1c');
  gradient.addColorStop(1, '#02040a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createLabel(text, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontSize = 40;
  const font = `600 ${fontSize}px Inter, 'Segoe UI', sans-serif`;
  ctx.font = font;
  const textMetrics = ctx.measureText(text);
  const padX = 40;
  const padY = 22;
  const w = Math.ceil(textMetrics.width + padX * 2);
  const h = fontSize + padY * 2;
  c.width = w;
  c.height = h;

  const r = 16;

  // Glow stroke
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  roundRectPath(ctx, 2, 2, w - 4, h - 4, r);
  ctx.stroke();
  ctx.restore();

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(12, 22, 42, 0.95)');
  bg.addColorStop(1, 'rgba(6, 11, 22, 0.95)');
  ctx.fillStyle = bg;
  roundRectPath(ctx, 2, 2, w - 4, h - 4, r);
  ctx.fill();

  // Accent border
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRectPath(ctx, 2, 2, w - 4, h - 4, r);
  ctx.stroke();

  // Colored dot
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(24, h / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Text
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#eaf2ff';
  ctx.fillText(text, 42, h / 2 + 1);

  const texture = new THREE.CanvasTexture(c);
  texture.minFilter = THREE.LinearFilter;
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(w / 64, h / 64, 1);
  return sprite;
}

const LABEL_HEIGHTS = { admin: 9, classrooms: 6.5, labs: 6.8, cafeteria: 5.5, hostels: 8.5 };

function mat(color, opts = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.12,
    ...opts
  });
  material.userData.baseEmissive = material.emissive.getHex();
  material.userData.baseIntensity = material.emissiveIntensity;
  return material;
}

function box(parent, w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWindows(parent, { width, depth, height, floors, cols, material }) {
  const winW = 0.26;
  const winH = 0.42;
  const winD = 0.08;
  const floorGap = height / floors;

  for (let f = 0; f < floors; f++) {
    const y = 0.55 + f * floorGap;

    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + (width / (cols + 1)) * (c + 1);
      box(parent, winW, winH, winD, material, x, y, depth / 2 + winD / 2).castShadow = false;
      box(parent, winW, winH, winD, material, x, y, -depth / 2 - winD / 2).castShadow = false;
    }

    const sideCols = Math.max(2, Math.floor(depth / 0.9));
    for (let c = 0; c < sideCols; c++) {
      const z = -depth / 2 + (depth / (sideCols + 1)) * (c + 1);
      box(parent, winD, winH, winW, material, width / 2 + winD / 2, y, z).castShadow = false;
      box(parent, winD, winH, winW, material, -width / 2 - winD / 2, y, z).castShadow = false;
    }
  }
}

function addFlatRoof(parent, width, depth, y, material, overhang = 0.18) {
  return box(parent, width + overhang * 2, 0.16, depth + overhang * 2, material, 0, y + 0.08, 0);
}

function addMass(parent, { w, h, d, x = 0, z = 0, wallMat, windowMat, floors = 2, cols = 3, roofMat }) {
  const mass = new THREE.Group();
  mass.position.set(x, 0, z);
  box(mass, w, h, d, wallMat, 0, h / 2, 0);
  addWindows(mass, { width: w, depth: d, height: h, floors, cols, material: windowMat });
  if (roofMat) addFlatRoof(mass, w, d, h, roofMat);
  parent.add(mass);
  return mass;
}

function addEntrance(parent, depth, trimMat, doorMat) {
  box(parent, 1.6, 0.14, 0.9, trimMat, 0, 0.07, depth / 2 + 0.45);
  box(parent, 1.3, 0.14, 0.7, trimMat, 0, 0.21, depth / 2 + 0.55);
  box(parent, 0.9, 1.15, 0.1, doorMat, 0, 0.72, depth / 2 + 0.07);
  box(parent, 2.0, 0.12, 1.0, trimMat, 0, 1.75, depth / 2 + 0.55);
  box(parent, 0.14, 1.75, 0.14, trimMat, -0.8, 0.875, depth / 2 + 0.95);
  box(parent, 0.14, 1.75, 0.14, trimMat, 0.8, 0.875, depth / 2 + 0.95);
}

function addTree(x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.2 * scale, 8),
    mat(0x6b4f2a, { roughness: 0.9 })
  );
  trunk.position.set(x, 0.6 * scale, z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  scene.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(0.9 * scale, 1.9 * scale, 10),
    mat(0x2f9e44, { roughness: 0.85 })
  );
  foliage.position.set(x, 1.85 * scale, z);
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  scene.add(foliage);
}

function createCampusGrounds() {
  const plazaMat = mat(0x1f2c4a, { roughness: 0.75, metalness: 0.1 });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.06, 36), plazaMat);
  plaza.position.y = 0.03;
  plaza.receiveShadow = true;
  scene.add(plaza);

  const pathMat = mat(0x243452, { roughness: 0.85, metalness: 0.05 });
  const radius = 14;
  for (let i = 0; i < 5; i++) {
    const x = radius * Math.sin(i * (Math.PI * 2) / 5);
    const z = radius * Math.cos(i * (Math.PI * 2) / 5);
    const dist = Math.sqrt(x * x + z * z);
    const length = Math.max(0.5, dist - 2.6 - 1.6);
    const dirX = x / dist;
    const dirZ = z / dist;
    const path = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, length), pathMat);
    path.position.set(dirX * (2.6 + length / 2), 0.02, dirZ * (2.6 + length / 2));
    path.rotation.y = Math.atan2(dirX, dirZ);
    path.receiveShadow = true;
    scene.add(path);
  }

  addTree(-6, -12, 1);
  addTree(6, -12, 1.1);
  addTree(-12.5, 5, 0.9);
  addTree(12.5, 5, 1);
  addTree(-3.5, 13, 1.05);
  addTree(3.5, 13, 0.95);
}

function createBuilding(b, pos) {
  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.z);
  group.rotation.y = Math.atan2(-pos.x, -pos.z);
  group.userData = { buildingId: b.id };

  const baseColor = new THREE.Color(b.color);
  const wallMat = mat(baseColor, {
    roughness: 0.52,
    metalness: 0.16,
    emissive: baseColor.clone().multiplyScalar(0.5),
    emissiveIntensity: 0.24
  });
  wallMat.userData.keepEmissive = true;
  const roofMat = mat(0x1b2538, { roughness: 0.85, metalness: 0.15 });
  const windowMat = mat(0x9fd8ff, { emissive: 0x2a6fbb, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.05 });
  windowMat.userData.keepEmissive = true;
  const trimMat = mat(0xdbe4ff, { roughness: 0.5, metalness: 0.1 });
  const doorMat = mat(0x0f172a, { roughness: 0.4, metalness: 0.3 });
  const equipmentMat = mat(0x4b5563, { roughness: 0.7, metalness: 0.3 });

  switch (b.id) {
    case 'admin':
      buildAdministration(group, wallMat, roofMat, windowMat, trimMat, doorMat, equipmentMat);
      break;
    case 'classrooms':
      buildClassrooms(group, wallMat, roofMat, windowMat, trimMat, doorMat);
      break;
    case 'labs':
      buildLabs(group, wallMat, roofMat, windowMat, trimMat, doorMat, equipmentMat);
      break;
    case 'cafeteria':
      buildCafeteria(group, wallMat, roofMat, windowMat, trimMat, doorMat);
      break;
    case 'hostels':
      buildHostels(group, wallMat, roofMat, windowMat, trimMat, doorMat);
      break;
  }

  const label = createLabel(b.name, b.color);
  label.position.set(0, LABEL_HEIGHTS[b.id] || 7, 0);
  group.add(label);

  scene.add(group);
  buildingGroups.set(b.id, group);
  return group;
}

function buildAdministration(group, wallMat, roofMat, windowMat, trimMat, doorMat) {
  const w = 3.4;
  const d = 2.8;
  const h = 4.4;
  addMass(group, { w, h, d, wallMat, windowMat, floors: 3, cols: 4, roofMat });
  addMass(group, { w: 1.3, h: 3.0, d: 2.2, x: -(w / 2 + 0.75), wallMat, windowMat, floors: 2, cols: 1, roofMat });
  addMass(group, { w: 1.3, h: 3.0, d: 2.2, x: w / 2 + 0.75, wallMat, windowMat, floors: 2, cols: 1, roofMat });

  const towerW = 1.5;
  const towerD = 1.5;
  const towerH = 2.8;
  const tower = new THREE.Group();
  tower.position.set(0, h, 0);
  box(tower, towerW, towerH, towerD, wallMat, 0, towerH / 2, 0);

  const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 4), roofMat);
  towerRoof.position.y = towerH + 0.7;
  towerRoof.rotation.y = Math.PI / 4;
  towerRoof.castShadow = true;
  tower.add(towerRoof);

  const clockMat = mat(0xf8fafc, { emissive: 0x93c5fd, emissiveIntensity: 0.5 });
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 24), clockMat);
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, towerH * 0.65, towerD / 2 + 0.04);
  tower.add(clock);
  group.add(tower);

  addEntrance(group, d, trimMat, doorMat);
}

function buildClassrooms(group, wallMat, roofMat, windowMat, trimMat, doorMat) {
  const w = 4.6;
  const d = 2.4;
  const h = 3.8;
  addMass(group, { w, h, d, wallMat, windowMat, floors: 3, cols: 6, roofMat });
  box(group, w + 0.1, 0.08, d + 0.1, trimMat, 0, h * 0.36, 0);
  box(group, w + 0.1, 0.08, d + 0.1, trimMat, 0, h * 0.68, 0);
  addMass(group, { w: 0.9, h: 4.4, d: 1.4, x: w / 2 + 0.55, wallMat, windowMat, floors: 3, cols: 1, roofMat });
  addEntrance(group, d, trimMat, doorMat);
}

function buildLabs(group, wallMat, roofMat, windowMat, trimMat, doorMat, equipmentMat) {
  const w = 3.8;
  const d = 2.8;
  const h = 4.2;
  addMass(group, { w, h, d, wallMat, windowMat, floors: 3, cols: 4, roofMat });

  const equipment = new THREE.Group();
  equipment.position.set(0, h, 0);
  const cylA = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 16), equipmentMat);
  cylA.position.set(-0.8, 0.45, 0.4);
  cylA.castShadow = true;
  equipment.add(cylA);
  const cylB = cylA.clone();
  cylB.position.set(-0.2, 0.45, -0.5);
  equipment.add(cylB);
  box(equipment, 1.1, 0.7, 0.9, equipmentMat, 0.9, 0.35, 0);
  group.add(equipment);

  addMass(group, { w: 1.1, h: 3.2, d: 1.8, x: -(w / 2 + 0.7), wallMat, windowMat, floors: 2, cols: 1, roofMat });
  addEntrance(group, d, trimMat, doorMat);
}

function buildCafeteria(group, wallMat, roofMat, windowMat, trimMat, doorMat) {
  const w = 4.8;
  const d = 3.2;
  const h = 3.0;
  addMass(group, { w, h, d, wallMat, windowMat, floors: 2, cols: 6, roofMat });

  const glassMat = mat(0x7dd3fc, { emissive: 0x0ea5e9, emissiveIntensity: 0.35, transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.1 });
  glassMat.userData.keepEmissive = true;
  box(group, w - 0.8, 1.4, 0.08, glassMat, 0, 1.5, d / 2 + 0.05);

  box(group, w - 1.0, 0.14, 1.8, trimMat, 0, 2.3, d / 2 + 1.0);
  box(group, 0.14, 2.3, 0.14, trimMat, -(w / 2 - 0.8), 1.15, d / 2 + 1.7);
  box(group, 0.14, 2.3, 0.14, trimMat, w / 2 - 0.8, 1.15, d / 2 + 1.7);
  box(group, 0.9, 1.2, 0.1, doorMat, 0, 0.72, d / 2 + 0.07);

  box(group, 0.8, 0.4, 0.8, trimMat, -w / 2 - 0.6, 0.2, d / 2 + 0.4);
  box(group, 0.8, 0.4, 0.8, trimMat, w / 2 + 0.6, 0.2, d / 2 + 0.4);
}

function buildHostels(group, wallMat, roofMat, windowMat, trimMat, doorMat) {
  const blockW = 1.9;
  const blockD = 2.6;
  const blockH = 5.6;

  for (const sign of [-1, 1]) {
    const tower = new THREE.Group();
    tower.position.set(sign * 1.9, 0, 0);
    box(tower, blockW, blockH, blockD, wallMat, 0, blockH / 2, 0);
    addWindows(tower, { width: blockW, depth: blockD, height: blockH, floors: 5, cols: 2, material: windowMat });
    addFlatRoof(tower, blockW, blockD, blockH, roofMat);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(blockW * 0.8, 1.2, 4), roofMat);
    cap.position.y = blockH + 0.7;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    tower.add(cap);

    for (let f = 1; f < 5; f += 2) {
      box(tower, blockW - 0.3, 0.08, 0.7, trimMat, 0, 1.1 + f * 1.0, blockD / 2 + 0.35);
    }
    group.add(tower);
  }

  addMass(group, { w: 1.6, h: 4.6, d: 2.0, wallMat, windowMat, floors: 4, cols: 1, roofMat });
  addEntrance(group, 2.0, trimMat, doorMat);
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  if (currentBuildingId) drawChart();
}

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(Array.from(buildingGroups.values()), true);

  if (intersects.length > 0) {
    const id = findBuildingId(intersects[0].object);
    if (!id) {
      tooltip.classList.remove('visible');
      return;
    }
    if (hoveredBuildingId !== id) {
      hoveredBuildingId = id;
      document.body.style.cursor = 'pointer';
      updateBuildingVisuals();
    }
    const b = BUILDINGS.find(b => b.id === id);
    tooltip.innerHTML = `<strong>${b.name}</strong><br>${getBuildingStatusText(id)}`;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY + 12}px`;
    tooltip.classList.add('visible');
  } else {
    if (hoveredBuildingId) {
      hoveredBuildingId = null;
      document.body.style.cursor = 'default';
      updateBuildingVisuals();
    }
    tooltip.classList.remove('visible');
  }
}

function onCanvasClick() {
  if (hoveredBuildingId) openDashboard(hoveredBuildingId);
}

function getBuildingStatusText(id) {
  const probs = engine.problems.filter(p => p.buildingId === id);
  if (!probs.length) return 'Status: Normal';
  return `Status: ${probs.map(p => p.type).join(', ')}`;
}

function findBuildingId(object) {
  let node = object;
  while (node) {
    if (node.userData && node.userData.buildingId) return node.userData.buildingId;
    node = node.parent;
  }
  return null;
}

function applyGroupEmissive(group, hex, intensity) {
  group.traverse((child) => {
    if (child.isMesh && child.material && child.material.emissive) {
      if (intensity === 0 && child.material.userData && child.material.userData.keepEmissive) {
        child.material.emissive.setHex(child.material.userData.baseEmissive);
        child.material.emissiveIntensity = child.material.userData.baseIntensity;
      } else {
        child.material.emissive.setHex(hex);
        child.material.emissiveIntensity = intensity;
      }
    }
  });
}

function updateBuildingVisuals() {
  for (const [id, group] of buildingGroups) {
    const probs = engine.problems.filter(p => p.buildingId === id);
    const severe = probs.some(p => p.severity === 'bad') ? 'bad' : (probs.some(p => p.severity === 'warn') ? 'warn' : null);
    const b = BUILDINGS.find(b => b.id === id);

    if (hoveredBuildingId === id) {
      applyGroupEmissive(group, severe === 'bad' ? 0xff0000 : severe === 'warn' ? 0xffaa00 : parseInt(b.color.replace('#', '0x'), 16), severe === 'bad' ? 0.9 : 0.6);
      group.scale.setScalar(1.03);
    } else if (severe) {
      applyGroupEmissive(group, severe === 'bad' ? 0xff0000 : 0xffaa00, severe === 'bad' ? 0.65 : 0.45);
      group.scale.setScalar(1.0);
    } else {
      applyGroupEmissive(group, 0x000000, 0);
      group.scale.setScalar(1.0);
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function addEvent(message) {
  const entry = document.createElement('div');
  entry.className = 'event-log-entry';
  entry.innerHTML = `<span class="event-time">${engine.timeString}</span>${message}`;
  eventLog.appendChild(entry);
  eventLog.scrollTop = eventLog.scrollHeight;
  while (eventLog.children.length > 200) {
    eventLog.removeChild(eventLog.firstChild);
  }
}

function updateActiveProblems() {
  activeProblemsEl.innerHTML = '';
  if (!engine.problems.length) {
    activeProblemsEl.innerHTML = '<div class="problem-item">No active problems</div>';
    return;
  }
  for (const p of engine.problems) {
    const item = document.createElement('div');
    item.className = `problem-item ${p.severity}`;
    item.innerHTML = `
      <div class="problem-info">
        <strong>${p.buildingName}</strong>
        <span>${p.type} · ${Math.ceil(p.remainingMinutes)}m left</span>
      </div>
      <button data-id="${p.id}">Resolve</button>
    `;
    activeProblemsEl.appendChild(item);
  }
}

activeProblemsEl.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' && e.target.dataset.id) {
    engine.resolveProblem(e.target.dataset.id);
  }
});

function updateControlState() {
  simStateEl.textContent = engine.state;
  clockEl.textContent = engine.timeString;
  btnStart.disabled = engine.state !== 'stopped';
  btnPause.disabled = engine.state !== 'running';
  btnResume.disabled = engine.state !== 'paused';
  btnStop.disabled = engine.state === 'stopped';
  updateAIState();
}

function getMetricStatusClass(buildingId, metric, value) {
  const b = BUILDINGS.find(b => b.id === buildingId);
  const threshold = b.thresholds[metric];
  if (value > threshold * 1.25) return 'bad';
  if (value > threshold) return 'warn';
  return 'good';
}

function openDashboard(id) {
  currentBuildingId = id;
  dashboardModal.classList.add('open');
  updateDashboard();
}

function closeDashboardFn() {
  dashboardModal.classList.remove('open');
  currentBuildingId = null;
}

function updateResolveButtonState() {
  if (!currentBuildingId) return;
  const probs = engine.problems.filter(p => p.buildingId === currentBuildingId);
  const hasRec = recommendations.has(currentBuildingId);
  if (probs.length && hasRec) {
    btnResolveAi.disabled = false;
    resolveStatus.textContent = `${probs.length} active issue${probs.length > 1 ? 's' : ''} — resolve based on AI recommendation`;
  } else if (probs.length) {
    btnResolveAi.disabled = true;
    resolveStatus.textContent = `${probs.length} active issue${probs.length > 1 ? 's' : ''} — get AI recommendation first`;
  } else {
    btnResolveAi.disabled = true;
    resolveStatus.textContent = 'No active issues to resolve';
  }
}

function updateDashboard() {
  if (!currentBuildingId) return;
  const b = BUILDINGS.find(b => b.id === currentBuildingId);
  const metrics = engine.metrics.get(currentBuildingId);

  dashboardTitle.innerHTML = `<span class="color-swatch" style="background:${b.color}"></span>${b.name} <span style="font-size:0.7em;color:#95a3c7">(${engine.state})</span>`;

  const deviation = engine.getDeviation(currentBuildingId);
  const defs = [
    { key: 'energy', decimals: 2 },
    { key: 'water', decimals: 1 },
    { key: 'occupancy', decimals: 1 },
    { key: 'co2', decimals: 2 }
  ];
  for (const { key, decimals } of defs) {
    const card = document.getElementById(`metric-${key}`);
    const valEl = document.getElementById(`val-${key}`);
    const devEl = document.getElementById(`dev-${key}`);
    valEl.textContent = metrics[key].toFixed(decimals);
    card.className = 'metric-card ' + getMetricStatusClass(currentBuildingId, key, metrics[key]);

    const dev = deviation ? deviation[key] : 0;
    if (!isFinite(dev) || dev > 20) {
      devEl.textContent = isFinite(dev) ? `+${dev.toFixed(0)}% vs baseline` : 'Above baseline';
      devEl.className = 'metric-deviation spike';
    } else if (dev < -20) {
      devEl.textContent = `${dev.toFixed(0)}% vs baseline`;
      devEl.className = 'metric-deviation drop';
    } else {
      devEl.textContent = 'Within baseline';
      devEl.className = 'metric-deviation neutral';
    }
  }

  const probs = engine.problems.filter(p => p.buildingId === currentBuildingId);
  const section = document.getElementById('active-problems-dashboard');
  const container = document.getElementById('dashboard-problems');
  if (probs.length) {
    section.style.display = 'block';
    container.innerHTML = probs.map(p => `<span class="problem-tag ${p.severity}">${p.type} (${Math.ceil(p.remainingMinutes)}m)</span>`).join('');
  } else {
    section.style.display = 'none';
    container.innerHTML = '';
  }

  updateResolveButtonState();

  drawChart();
  updateAIState();

  const cached = recommendations.get(currentBuildingId);
  if (cached) {
    insightText.classList.remove('placeholder');
    insightText.textContent = cached;
  }
}

function drawChart() {
  const ctx = chartCanvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio, 2);
  const rect = chartCanvas.getBoundingClientRect();
  chartCanvas.width = Math.floor(rect.width * dpr);
  chartCanvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#080c1a';
  ctx.fillRect(0, 0, w, h);

  const hist = engine.history.get(currentBuildingId) || [];
  if (hist.length < 2) {
    ctx.fillStyle = '#95a3c7';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Collecting energy data...', w / 2, h / 2);
    return;
  }

  const values = hist.map(p => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const range = max - min || 1;
  min = Math.max(0, min - range * 0.1);
  max = max + range * 0.1;

  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  // Grid lines & Y labels
  ctx.strokeStyle = '#1a2545';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + chartH * (i / 4);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    const val = max - (max - min) * (i / 4);
    ctx.fillStyle = '#95a3c7';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(val.toFixed(0), padding.left - 6, y);
  }
  ctx.stroke();

  // Line
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  hist.forEach((p, i) => {
    const x = padding.left + (i / (hist.length - 1)) * chartW;
    const y = padding.top + chartH * (1 - (p.value - min) / (max - min));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Area fill
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(79, 209, 197, 0.12)';
  ctx.fill();

  // X label
  ctx.fillStyle = '#95a3c7';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Time →', w / 2, h - 6);
}

function updateKeyStatus() {
  const key = apiKeyInput.value.trim();
  isApiKeyReady = key.length >= 10;
  keyStatus.classList.toggle('ready', isApiKeyReady);
  keyStatus.title = isApiKeyReady ? 'Ready' : 'No key';
  updateAIState();
}

function updateAIState() {
  const canRequest = isApiKeyReady && (engine.state === 'paused' || engine.state === 'stopped');
  btnAiRecommend.disabled = !canRequest;
  if (!isApiKeyReady) {
    aiStatus.textContent = 'Enter a valid-looking API key to enable AI recommendations.';
  } else if (engine.state !== 'paused' && engine.state !== 'stopped') {
    aiStatus.textContent = 'Pause or stop the simulation to request a recommendation.';
  } else {
    aiStatus.textContent = 'Ready to request AI recommendation.';
  }
}

async function onAiRecommend() {
  if (!currentBuildingId) return;
  const b = BUILDINGS.find(b => b.id === currentBuildingId);
  const metrics = engine.metrics.get(currentBuildingId);
  const delta = engine.getDelta(currentBuildingId);
  const activeProblems = engine.problems
    .filter(p => p.buildingId === currentBuildingId)
    .map(p => ({ type: p.type, severity: p.severity, remainingMinutes: Math.ceil(p.remainingMinutes) }));
  const hist = engine.history.get(currentBuildingId) || [];

  const payload = {
    building: b.name,
    timestamp: engine.timeString,
    metrics,
    delta,
    activeProblems,
    simulationTime: Math.floor(engine.simTime),
    runDuration: engine.runDurationMinutes,
    energyHistory: hist.slice(-30)
  };

  btnAiRecommend.disabled = true;
  aiStatus.textContent = 'Asking Gemini...';
  insightText.classList.remove('placeholder');
  insightText.textContent = 'Loading recommendation...';

  try {
    const key = apiKeyInput.value.trim();
    const data = await api.fetchInsight(key, payload);
    recommendations.set(currentBuildingId, data.recommendation);
    insightText.textContent = data.recommendation;
    aiStatus.textContent = data.cached ? 'Served from server cache.' : 'Generated by Gemini.';
    updateResolveButtonState();
  } catch (err) {
    insightText.textContent = `Error: ${err.message}`;
    aiStatus.textContent = 'Recommendation failed.';
  } finally {
    updateAIState();
  }
}

// Event wiring
btnStart.onclick = () => engine.start();
btnPause.onclick = () => engine.pause();
btnResume.onclick = () => engine.resume();
btnStop.onclick = () => engine.stop();

speedSlider.oninput = (e) => {
  engine.setSpeed(e.target.value);
  speedValue.textContent = `${e.target.value}x`;
};

toggleSimPanel.onclick = () => simPanel.classList.add('open');
closeSimPanel.onclick = () => simPanel.classList.remove('open');
resetView.onclick = () => {
  camera.position.set(0, 20, 32);
  controls.target.set(0, 0, 0);
  controls.update();
};

closeDashboard.onclick = closeDashboardFn;
dashboardModal.onclick = (e) => {
  if (e.target === dashboardModal) closeDashboardFn();
};

injectForm.onsubmit = (e) => {
  e.preventDefault();
  const building = injectBuilding.value;
  const type = injectType.value;
  const duration = parseInt(injectDuration.value, 10);
  engine.injectProblem(building, type, duration);
};

btnAiRecommend.onclick = onAiRecommend;

btnResolveAi.onclick = () => {
  if (!currentBuildingId) return;
  const rec = recommendations.get(currentBuildingId);
  const probs = engine.problems.filter(p => p.buildingId === currentBuildingId);
  if (!probs.length) return;
  if (!rec) {
    resolveStatus.textContent = 'Get an AI recommendation first.';
    return;
  }

  const recLower = rec.toLowerCase();
  const keywordMap = {
    'Water Leak': ['water leak', 'leak', 'water'],
    'Power Surge': ['power surge', 'surge', 'power'],
    'HVAC Failure': ['hvac', 'air conditioning', 'heating', 'ventilation'],
    'Occupancy Spike': ['occupancy spike', 'crowding', 'occupancy spike', 'occupancy'],
    'Equipment Malfunction': ['equipment malfunction', 'equipment', 'malfunction'],
    'Lighting Failure': ['lighting failure', 'lighting', 'lights']
  };

  const resolved = [];
  const unresolved = [];
  for (const p of [...probs]) {
    const keywords = keywordMap[p.type] || [];
    const match = keywords.some(k => recLower.includes(k));
    if (match) {
      engine.resolveProblem(p.id);
      resolved.push(p.type);
    } else {
      unresolved.push(p);
    }
  }

  if (!resolved.length) {
    for (const p of [...probs]) engine.resolveProblem(p.id);
    resolveStatus.textContent = 'No specific issue matched the recommendation — resolved all active issues.';
  } else if (unresolved.length) {
    resolveStatus.textContent = `Resolved ${resolved.join(', ')}. Remaining: ${unresolved.map(p => p.type).join(', ')}.`;
  } else {
    resolveStatus.textContent = `Resolved ${resolved.join(', ')} based on the AI recommendation.`;
  }
  updateDashboard();
};

// Engine events
engine.addEventListener('tick', (e) => {
  clockEl.textContent = e.detail.time;
  updateBuildingVisuals();
  if (currentBuildingId) updateDashboard();
});

engine.addEventListener('start', (e) => {
  addEvent(`Simulation started at ${e.detail.time}`);
  updateControlState();
  updateActiveProblems();
  updateBuildingVisuals();
});

engine.addEventListener('pause', (e) => {
  addEvent(`Simulation paused at ${e.detail.time}`);
  updateControlState();
});

engine.addEventListener('resume', (e) => {
  addEvent(`Simulation resumed at ${e.detail.time}`);
  updateControlState();
});

engine.addEventListener('stop', (e) => {
  addEvent(`Simulation stopped at ${e.detail.time}`);
  updateControlState();
  updateActiveProblems();
  updateBuildingVisuals();
  if (currentBuildingId) updateDashboard();
});

engine.addEventListener('problemInjected', (e) => {
  addEvent(`Injected ${e.detail.problem.type} in ${e.detail.problem.buildingName}`);
  updateActiveProblems();
  updateBuildingVisuals();
  if (currentBuildingId) updateDashboard();
});

engine.addEventListener('problemResolved', (e) => {
  addEvent(`${e.detail.problem.type} resolved in ${e.detail.problem.buildingName}${e.detail.auto ? ' (expired)' : ''}`);
  updateActiveProblems();
  updateBuildingVisuals();
  if (currentBuildingId) updateDashboard();
});

engine.addEventListener('alert', (e) => {
  for (const a of e.detail.alerts) {
    addEvent(`${a.building} ${a.metric.toUpperCase()} is ${a.status}: ${a.value.toFixed(1)}`);
  }
  if (currentBuildingId) updateDashboard();
});

initUI();
initThree();
updateBuildingVisuals();
