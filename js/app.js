import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SimulationEngine, BUILDINGS, PROBLEM_TYPES } from './simulation.js';
import * as api from './api.js';

const engine = new SimulationEngine();
const recommendations = new Map();
const buildingMeshes = new Map();

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
  renderer.setClearColor(0x0b1020);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 30, 90);

  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.set(0, 20, 32);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.enablePan = false;

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(15, 25, 12);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 100;
  dir.shadow.camera.left = -30;
  dir.shadow.camera.right = 30;
  dir.shadow.camera.top = 30;
  dir.shadow.camera.bottom = -30;
  scene.add(dir);

  // Ground & grid
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x0d1529, roughness: 0.8, metalness: 0.15 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(80, 40, 0x2a3a66, 0x1a2545);
  grid.position.y = 0.02;
  scene.add(grid);

  // Buildings arranged in a pentagon with more space and staggered depth
  const radius = 10;
  const positions = [
    { id: 'admin', x: radius * Math.sin(0 * (Math.PI * 2) / 5), z: radius * Math.cos(0 * (Math.PI * 2) / 5) },
    { id: 'classrooms', x: radius * Math.sin(1 * (Math.PI * 2) / 5), z: radius * Math.cos(1 * (Math.PI * 2) / 5) },
    { id: 'labs', x: radius * Math.sin(2 * (Math.PI * 2) / 5), z: radius * Math.cos(2 * (Math.PI * 2) / 5) },
    { id: 'cafeteria', x: radius * Math.sin(3 * (Math.PI * 2) / 5), z: radius * Math.cos(3 * (Math.PI * 2) / 5) },
    { id: 'hostels', x: radius * Math.sin(4 * (Math.PI * 2) / 5), z: radius * Math.cos(4 * (Math.PI * 2) / 5) }
  ];

  for (const pos of positions) {
    const b = BUILDINGS.find(b => b.id === pos.id);
    const height = 2 + b.baseEnergy / 25;
    const group = new THREE.Group();
    group.position.set(pos.x, 0, pos.z);

    const geometry = new THREE.BoxGeometry(2.4, height, 2.4);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(b.color),
      roughness: 0.5,
      metalness: 0.15
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { buildingId: b.id };
    group.add(mesh);
    buildingMeshes.set(b.id, mesh);

    const label = createLabel(b.name, b.color);
    label.position.set(0, height + 1.5, 0);
    group.add(label);

    scene.add(group);
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

function createLabel(text, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontSize = 44;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const textMetrics = ctx.measureText(text);
  const padX = 28;
  const padY = 18;
  const w = Math.ceil(textMetrics.width + padX * 2);
  const h = fontSize + padY * 2;
  c.width = w;
  c.height = h;

  // Rounded background pill
  const r = 12;
  ctx.fillStyle = 'rgba(11, 16, 32, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e7ecff';
  ctx.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(c);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(w / 48, h / 48, 1);
  return sprite;
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
  const intersects = raycaster.intersectObjects(Array.from(buildingMeshes.values()));

  if (intersects.length > 0) {
    const id = intersects[0].object.userData.buildingId;
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

function updateBuildingVisuals() {
  for (const [id, mesh] of buildingMeshes) {
    const probs = engine.problems.filter(p => p.buildingId === id);
    const severe = probs.some(p => p.severity === 'bad') ? 'bad' : (probs.some(p => p.severity === 'warn') ? 'warn' : null);
    const b = BUILDINGS.find(b => b.id === id);

    if (hoveredBuildingId === id) {
      mesh.material.emissive.setHex(severe === 'bad' ? 0xff0000 : severe === 'warn' ? 0xffaa00 : parseInt(b.color.replace('#', '0x'), 16));
      mesh.material.emissiveIntensity = severe === 'bad' ? 0.9 : 0.6;
      mesh.scale.setScalar(1.04);
    } else if (severe) {
      mesh.material.emissive.setHex(severe === 'bad' ? 0xff0000 : 0xffaa00);
      mesh.material.emissiveIntensity = severe === 'bad' ? 0.65 : 0.45;
      mesh.scale.setScalar(1.0);
    } else {
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
      mesh.scale.setScalar(1.0);
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
