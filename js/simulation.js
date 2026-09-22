export const PROBLEM_TYPES = {
  hvacFailure: {
    label: 'HVAC Failure',
    severity: 'bad',
    effects: { energy: 0.75, water: 0.95, occupancy: 0.9, co2: 1.25 },
    defaultDuration: 40
  },
  waterLeak: {
    label: 'Water Leak',
    severity: 'warn',
    effects: { water: 1.7, energy: 1.05 },
    defaultDuration: 30
  },
  powerSurge: {
    label: 'Power Surge',
    severity: 'bad',
    effects: { energy: 1.9 },
    defaultDuration: 20
  },
  occupancySpike: {
    label: 'Occupancy Spike',
    severity: 'warn',
    effects: { occupancy: 1.6, energy: 1.2, water: 1.15, co2: 1.25 },
    defaultDuration: 30
  },
  equipmentMalfunction: {
    label: 'Equipment Malfunction',
    severity: 'warn',
    effects: { energy: 1.15, co2: 1.1 },
    defaultDuration: 50
  },
  lightingFailure: {
    label: 'Lighting Failure',
    severity: 'warn',
    effects: { energy: 0.85 },
    defaultDuration: 60
  }
};

export const BUILDINGS = [
  {
    id: 'admin',
    name: 'Administration',
    color: '#22d3ee',
    baseEnergy: 40,
    baseWater: 100,
    baseOccupancy: 30,
    baseCO2: 10,
    peakHours: [9, 10, 11, 14, 15],
    thresholds: { energy: 80, water: 220, occupancy: 80, co2: 35 }
  },
  {
    id: 'classrooms',
    name: 'Classrooms',
    color: '#3b82f6',
    baseEnergy: 55,
    baseWater: 140,
    baseOccupancy: 70,
    baseCO2: 18,
    peakHours: [9, 10, 11, 13, 14, 15, 16],
    thresholds: { energy: 110, water: 300, occupancy: 95, co2: 45 }
  },
  {
    id: 'labs',
    name: 'Labs',
    color: '#10b981',
    baseEnergy: 90,
    baseWater: 200,
    baseOccupancy: 45,
    baseCO2: 28,
    peakHours: [10, 11, 14, 15, 16],
    thresholds: { energy: 160, water: 400, occupancy: 85, co2: 60 }
  },
  {
    id: 'cafeteria',
    name: 'Cafeteria',
    color: '#f59e0b',
    baseEnergy: 65,
    baseWater: 260,
    baseOccupancy: 85,
    baseCO2: 22,
    peakHours: [8, 12, 13, 18, 19],
    thresholds: { energy: 120, water: 500, occupancy: 98, co2: 50 }
  },
  {
    id: 'hostels',
    name: 'Hostels',
    color: '#a855f7',
    baseEnergy: 70,
    baseWater: 240,
    baseOccupancy: 80,
    baseCO2: 20,
    peakHours: [7, 8, 19, 20, 21, 22],
    thresholds: { energy: 130, water: 450, occupancy: 98, co2: 45 }
  }
];

const START_HOUR = 8;
const START_MINUTE = 0;
const TICK_SIM_MINUTES = 10;
const SIM_MINUTES_PER_REAL_SECOND_AT_1X = 2;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function pad2(n) {
  return n.toString().padStart(2, '0');
}

export class SimulationEngine extends EventTarget {
  constructor() {
    super();
    this.state = 'stopped';
    this.speed = 1;
    this.simTime = START_HOUR * 60 + START_MINUTE;
    this.startSimTime = this.simTime;
    this.metrics = new Map();
    this.history = new Map();
    this.problems = [];
    this.alertStates = new Map();
    this.intervalId = null;
    this.initialMetrics = new Map();
    this.baselineMetrics = new Map();

    for (const b of BUILDINGS) {
      this.metrics.set(b.id, this.computeBuildingMetrics(b));
      this.baselineMetrics.set(b.id, this.computeExpectedMetrics(b));
      this.history.set(b.id, []);
      this.alertStates.set(b.id, { energy: 'good', water: 'good', occupancy: 'good', co2: 'good' });
    }
    this.initialMetrics = this.snapshotMetrics();
  }

  get timeString() {
    const total = Math.floor(this.simTime);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  get runDurationMinutes() {
    return Math.max(0, this.simTime - this.startSimTime);
  }

  setSpeed(value) {
    const prev = this.speed;
    this.speed = clamp(Number(value) || 1, 1, 10);
    if (this.state === 'running' && prev !== this.speed) {
      this.clearTick();
      this.startTick();
    }
  }

  start() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.simTime = START_HOUR * 60 + START_MINUTE;
    this.startSimTime = this.simTime;
    this.problems = [];
    this.history.clear();
    this.initialMetrics = new Map();

    for (const b of BUILDINGS) {
      const metrics = this.computeBuildingMetrics(b);
      this.metrics.set(b.id, metrics);
      this.baselineMetrics.set(b.id, this.computeExpectedMetrics(b));
      this.history.set(b.id, [{ time: this.simTime, value: metrics.energy }]);
      this.alertStates.set(b.id, { energy: 'good', water: 'good', occupancy: 'good', co2: 'good' });
    }
    this.initialMetrics = this.snapshotMetrics();

    this.startTick();
    this.emit('start', { time: this.timeString });
    this.emit('tick', { time: this.timeString, metrics: this.snapshotMetrics(), problems: [] });
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.clearTick();
    this.emit('pause', { time: this.timeString });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.startTick();
    this.emit('resume', { time: this.timeString });
  }

  stop() {
    this.state = 'stopped';
    this.clearTick();
    this.simTime = START_HOUR * 60 + START_MINUTE;
    this.problems = [];
    this.emit('stop', { time: this.timeString });
  }

  injectProblem(buildingId, typeKey, durationMinutes) {
    const building = BUILDINGS.find(b => b.id === buildingId);
    const type = PROBLEM_TYPES[typeKey];
    if (!building || !type) return false;

    const duration = clamp(Number(durationMinutes) || type.defaultDuration, 10, 600);
    const problem = {
      id: `${buildingId}-${typeKey}-${Date.now()}`,
      buildingId,
      buildingName: building.name,
      type: type.label,
      typeKey,
      severity: type.severity,
      effects: { ...type.effects },
      durationMinutes: duration,
      remainingMinutes: duration,
      startTime: this.simTime
    };

    this.problems.push(problem);
    this.emit('problemInjected', { problem, time: this.timeString });
    if (this.state === 'running') this.tick(false, false);
    return true;
  }

  resolveProblem(problemId) {
    const idx = this.problems.findIndex(p => p.id === problemId);
    if (idx === -1) return false;
    const [problem] = this.problems.splice(idx, 1);
    this.emit('problemResolved', { problem, time: this.timeString });
    if (this.state === 'running') this.tick(false, false);
    return true;
  }

  clearTick() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  startTick() {
    this.clearTick();
    const realSecondsPerSimMinute = SIM_MINUTES_PER_REAL_SECOND_AT_1X / this.speed;
    const intervalMs = TICK_SIM_MINUTES * realSecondsPerSimMinute * 1000;
    this.intervalId = setInterval(() => this.tick(true), intervalMs);
  }

  tick(advanceTime, recordHistory = true) {
    if (advanceTime) {
      this.simTime += TICK_SIM_MINUTES;
    }

    // Auto-expire problems
    const expired = [];
    for (let i = this.problems.length - 1; i >= 0; i--) {
      const p = this.problems[i];
      p.remainingMinutes = Math.max(0, p.durationMinutes - (this.simTime - p.startTime));
      if (p.remainingMinutes <= 0) {
        expired.push(...this.problems.splice(i, 1));
      }
    }
    for (const p of expired) {
      this.emit('problemResolved', { problem: p, time: this.timeString, auto: true });
    }

    const snapshot = new Map();
    const baselineSnapshot = new Map();
    for (const b of BUILDINGS) {
      const baseline = this.computeExpectedMetrics(b);
      this.baselineMetrics.set(b.id, baseline);
      baselineSnapshot.set(b.id, baseline);

      const metrics = this.computeBuildingMetrics(b);
      this.metrics.set(b.id, metrics);
      snapshot.set(b.id, metrics);

      const hist = this.history.get(b.id);
      if (recordHistory) hist.push({ time: this.simTime, value: metrics.energy });
      if (hist.length > 288) hist.shift(); // keep last 48 hours at 10-min ticks

      this.checkThresholds(b, metrics);
    }

    this.emit('tick', { time: this.timeString, metrics: snapshot, baseline: baselineSnapshot, problems: [...this.problems] });
  }

  computeExpectedMetrics(building) {
    const hour = (this.simTime / 60) % 24;
    const inPeak = building.peakHours.includes(Math.floor(hour));

    // Diurnal campus activity curve: zero at 08:00, ramp to peak ~15:00, back to zero by 22:00
    const dayFactor = Math.max(0, Math.sin(((hour - 8) / 14) * Math.PI));
    const peakMult = inPeak ? 1.175 : 1.0;

    let occupancy = building.baseOccupancy * dayFactor * peakMult;
    let energy = building.baseEnergy * dayFactor * peakMult * (1 + occupancy / 250);
    let water = building.baseWater * dayFactor * (1 + occupancy / 350);
    let co2 = building.baseCO2 * dayFactor * (1 + occupancy / 180);

    occupancy = clamp(occupancy, 0, 100);

    return {
      energy: Math.max(0, energy),
      water: Math.max(0, water),
      occupancy,
      co2: Math.max(0, co2)
    };
  }

  computeBuildingMetrics(building) {
    const expected = this.computeExpectedMetrics(building);
    const noise = randRange(0.92, 1.08);

    let occupancy = clamp(expected.occupancy * noise, 0, 100);
    let energy = expected.energy * noise;
    let water = expected.water * noise;
    let co2 = expected.co2 * noise;

    // Apply active problem effects
    for (const p of this.problems) {
      if (p.buildingId !== building.id) continue;
      const e = p.effects;
      if (e.energy) energy *= e.energy;
      if (e.water) water *= e.water;
      if (e.occupancy) occupancy *= e.occupancy;
      if (e.co2) co2 *= e.co2;
    }

    occupancy = clamp(occupancy, 0, 100);

    return {
      energy: Math.max(0, energy),
      water: Math.max(0, water),
      occupancy,
      co2: Math.max(0, co2)
    };
  }

  checkThresholds(building, metrics) {
    const prev = this.alertStates.get(building.id);
    const next = {};
    const alerts = [];

    for (const key of ['energy', 'water', 'occupancy', 'co2']) {
      const threshold = building.thresholds[key];
      const value = metrics[key];
      let status = 'good';
      if (value > threshold * 1.25) status = 'bad';
      else if (value > threshold) status = 'warn';
      next[key] = status;

      if (status !== 'good' && prev[key] !== status) {
        alerts.push({ building: building.name, metric: key, value, status, threshold });
      }
    }

    this.alertStates.set(building.id, next);
    if (alerts.length) {
      this.emit('alert', { alerts, time: this.timeString });
    }
  }

  snapshotMetrics() {
    const snap = new Map();
    for (const [id, m] of this.metrics) snap.set(id, { ...m });
    return snap;
  }

  getDelta(buildingId) {
    const initial = this.initialMetrics.get(buildingId);
    const current = this.metrics.get(buildingId);
    if (!initial || !current) return null;
    return {
      energy: current.energy - initial.energy,
      water: current.water - initial.water,
      occupancy: current.occupancy - initial.occupancy,
      co2: current.co2 - initial.co2
    };
  }

  getDeviation(buildingId) {
    const baseline = this.baselineMetrics.get(buildingId);
    const current = this.metrics.get(buildingId);
    if (!baseline || !current) return null;
    const pct = (key) => {
      if (baseline[key] === 0) return current[key] > 0 ? Infinity : 0;
      return ((current[key] - baseline[key]) / baseline[key]) * 100;
    };
    return {
      energy: pct('energy'),
      water: pct('water'),
      occupancy: pct('occupancy'),
      co2: pct('co2')
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
