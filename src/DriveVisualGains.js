import * as THREE from 'three';
import { gsap } from 'gsap';

const CAR_Z = 4;
const HIDDEN_Y = -1000;
const CYBER_COLORS = ['#19e8ff', '#ff168d', '#8858ff'];

function hashUnit(value) {
  return Math.abs(Math.sin(value * 91.345 + 17.17) * 43758.5453) % 1;
}

function smootherStep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function bridgeElevationAt(progress, variant) {
  if (progress <= 0 || progress >= 1) return 0;
  const rise = smootherStep01(progress / 0.235);
  const descent = smootherStep01((1 - progress) / 0.235);
  const highSpan = Math.min(rise, descent);
  const crown = Math.pow(Math.sin(progress * Math.PI), 2);
  const baseHeight = variant === 'desert' ? 12.2 : 13.8;
  return highSpan * (baseHeight + crown * 1.65);
}

function bridgeElevationAndGradeAtZ(state, z) {
  if (state.biome !== 'bridge') {
    return { elevation: state.roadElevation || 0, grade: 0 };
  }
  const profileProgress = (state.bridgeProgress || 0) + (CAR_Z - z) / 300;
  const epsilon = 0.0015;
  const elevation = bridgeElevationAt(profileProgress, state.bridgeVariant);
  const slope = (
    bridgeElevationAt(profileProgress + epsilon, state.bridgeVariant)
    - bridgeElevationAt(profileProgress - epsilon, state.bridgeVariant)
  ) / (epsilon * 300 * 2);
  return { elevation, grade: Math.atan(slope) };
}

function makeTrailMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float crossFade = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 2.4);
        float lengthFade = pow(max(0.0, 1.0 - abs(vUv.y - 0.5) * 1.72), 1.45);
        float rainBreakup = 0.58 + 0.42 * step(0.34, fract(vUv.y * 21.0 + vUv.x * 3.0));
        float alpha = crossFade * lengthFade * rainBreakup * uOpacity;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}

function makeContactShadowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {},
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        vec2 centered = (vUv - 0.5) * vec2(1.8, 2.0);
        float core = 1.0 - smoothstep(0.05, 0.82, dot(centered, centered));
        float grit = 0.78 + 0.22 * step(0.5, fract(sin(dot(floor(vUv * vec2(42.0, 67.0)), vec2(12.9898, 78.233))) * 43758.5453));
        gl_FragColor = vec4(vec3(0.0), core * grit * 0.58);
      }
    `,
  });
}

export class DriveVisualGains {
  constructor(root, car, {
    isMobile = false,
    prefersReducedMotion = () => false,
    patchMaterial = (material) => material,
  } = {}) {
    this.isMobile = isMobile;
    this.prefersReducedMotion = prefersReducedMotion;
    this.patchMaterial = patchMaterial;
    this.group = new THREE.Group();
    this.group.name = 'Drive visual gains · pooled feedback';
    root.add(this.group);

    this.dummy = new THREE.Object3D();
    this.euler = new THREE.Euler();
    this.quaternion = new THREE.Quaternion();
    this.color = new THREE.Color();
    this.lastState = null;
    this.lastStreakOpacity = -1;
    this.burstCursor = 0;
    this.pulseCursor = 0;
    this.eventCounts = { collectBursts: 0, roadPulses: 0, crashBursts: 0, shockwaves: 0 };
    this.boost = { value: 0 };
    this.surface = 'road';

    this.createSpeedStreaks();
    this.createBurstPool();
    this.createRoadPulsePool();
    this.createShockwavePool();
    this.createCarGrounding(car);
    this.reset();
  }

  createSpeedStreaks() {
    this.streakCount = this.isMobile ? 10 : 18;
    const material = this.patchMaterial(new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }), 'drive-speed-streaks');
    this.streakMaterial = material;
    this.streakOpacityTo = gsap.quickTo(material, 'opacity', {
      duration: 0.18,
      ease: 'power2.out',
    });
    this.streakMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, this.streakCount);
    this.streakMesh.name = 'Pooled wet-road speed streaks';
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 5;
    this.streakSeeds = [];
    for (let index = 0; index < this.streakCount; index++) {
      const seed = {
        offset: hashUnit(index + 2.1) * 88,
        x: THREE.MathUtils.lerp(-5.18, 5.18, hashUnit(index + 15.7)),
        width: THREE.MathUtils.lerp(0.025, 0.075, hashUnit(index + 28.4)),
        length: THREE.MathUtils.lerp(0.72, 1.28, hashUnit(index + 44.2)),
      };
      this.streakSeeds.push(seed);
      this.streakMesh.setColorAt(index, new THREE.Color(CYBER_COLORS[index % CYBER_COLORS.length]));
    }
    this.streakMesh.instanceColor.needsUpdate = true;
    this.group.add(this.streakMesh);
  }

  createBurstPool() {
    this.burstSlotCount = this.isMobile ? 2 : 3;
    this.particlesPerBurst = this.isMobile ? 8 : 14;
    const total = this.burstSlotCount * this.particlesPerBurst;
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.92,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.particleMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.12, 0), material, total);
    this.particleMesh.name = 'Pooled collect and crash sparks';
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.renderOrder = 8;
    this.group.add(this.particleMesh);

    this.burstSlots = Array.from({ length: this.burstSlotCount }, (_, slotIndex) => ({
      slotIndex,
      active: false,
      type: 'collect',
      progress: 1,
      origin: new THREE.Vector3(),
      velocities: Array.from({ length: this.particlesPerBurst }, () => new THREE.Vector3()),
      spins: Array.from({ length: this.particlesPerBurst }, () => new THREE.Vector3()),
      tween: null,
    }));
  }

  createRoadPulsePool() {
    const count = this.isMobile ? 2 : 3;
    this.roadPulses = Array.from({ length: count }, (_, index) => {
      const material = this.patchMaterial(new THREE.MeshBasicMaterial({
        color: index % 2 ? '#ff168d' : '#1de8ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }), `drive-road-pulse-${index}`);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(11.3, 0.15), material);
      mesh.name = `Pooled boost road pulse ${index + 1}`;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -0.024;
      mesh.renderOrder = 7;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, material, timeline: null };
    });
  }

  createShockwavePool() {
    this.shockwaves = Array.from({ length: 2 }, (_, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: index ? '#ff3a89' : '#65f4ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, this.isMobile ? 24 : 40), material);
      mesh.name = `Pooled crash shockwave ${index + 1}`;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      return { mesh, material, timeline: null };
    });
  }

  createCarGrounding(car) {
    const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 6.4), makeContactShadowMaterial());
    contactShadow.name = 'Gritty procedural car contact shadow';
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, -0.091, 0.12);
    contactShadow.renderOrder = 3;
    car.add(contactShadow);
    this.contactShadow = contactShadow;

    this.trailSetters = [];
    this.reflectionTrails = [-1, 1].map((side) => {
      const material = makeTrailMaterial(side < 0 ? '#19e8ff' : '#ff168d');
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 6.8), material);
      mesh.name = side < 0 ? 'Cyan wet tail-light reflection' : 'Magenta wet tail-light reflection';
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(side * 0.96, -0.087, 5.2);
      mesh.renderOrder = 6;
      car.add(mesh);
      this.trailSetters.push(gsap.quickTo(material.uniforms.uOpacity, 'value', {
        duration: 0.16,
        ease: 'power2.out',
      }));
      return mesh;
    });
  }

  setHiddenParticle(index) {
    this.dummy.position.set(0, HIDDEN_Y, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.particleMesh.setMatrixAt(index, this.dummy.matrix);
  }

  syncBurstSlot(slot) {
    const start = slot.slotIndex * this.particlesPerBurst;
    const progress = THREE.MathUtils.clamp(slot.progress, 0, 1);
    for (let index = 0; index < this.particlesPerBurst; index++) {
      const instanceIndex = start + index;
      if (!slot.active) {
        this.setHiddenParticle(instanceIndex);
        continue;
      }
      const velocity = slot.velocities[index];
      const spin = slot.spins[index];
      const gravity = slot.type === 'crash' ? 3.5 : 2.1;
      this.dummy.position.copy(slot.origin).addScaledVector(velocity, progress);
      this.dummy.position.y -= gravity * progress * progress;
      this.dummy.rotation.set(spin.x * progress, spin.y * progress, spin.z * progress);
      const life = Math.max(0.001, 1 - progress);
      const baseScale = slot.type === 'crash' ? 1.35 : 1;
      this.dummy.scale.set(baseScale * life, baseScale * life, baseScale * (1.6 + index % 3) * life);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  triggerBurst(type, origin) {
    const slot = this.burstSlots[this.burstCursor % this.burstSlots.length];
    this.burstCursor += 1;
    slot.tween?.kill();
    slot.type = type;
    slot.active = true;
    slot.progress = 0;
    slot.origin.copy(origin);

    for (let index = 0; index < this.particlesPerBurst; index++) {
      const angle = hashUnit(index + slot.slotIndex * 31 + (type === 'crash' ? 117 : 59)) * Math.PI * 2;
      const radial = type === 'crash'
        ? THREE.MathUtils.lerp(2.8, 7.4, hashUnit(index + 14.4))
        : THREE.MathUtils.lerp(1.5, 4.2, hashUnit(index + 9.2));
      const lift = type === 'crash'
        ? THREE.MathUtils.lerp(1.4, 6.4, hashUnit(index + 28.8))
        : THREE.MathUtils.lerp(2.4, 5.6, hashUnit(index + 21.5));
      slot.velocities[index].set(Math.cos(angle) * radial, lift, Math.sin(angle) * radial * 0.72);
      slot.spins[index].set(
        THREE.MathUtils.lerp(-8, 8, hashUnit(index + 40.1)),
        THREE.MathUtils.lerp(-10, 10, hashUnit(index + 52.9)),
        THREE.MathUtils.lerp(-8, 8, hashUnit(index + 68.3)),
      );
      const paletteIndex = type === 'crash' ? (index + 1) % CYBER_COLORS.length : index % 2;
      this.particleMesh.setColorAt(slot.slotIndex * this.particlesPerBurst + index, this.color.set(CYBER_COLORS[paletteIndex]));
    }
    this.particleMesh.instanceColor.needsUpdate = true;
    this.syncBurstSlot(slot);

    const duration = this.prefersReducedMotion() ? 0.01 : (type === 'crash' ? 0.52 : 0.38);
    slot.tween = gsap.to(slot, {
      progress: 1,
      duration,
      ease: type === 'crash' ? 'power2.out' : 'expo.out',
      overwrite: true,
      onUpdate: () => this.syncBurstSlot(slot),
      onComplete: () => {
        slot.active = false;
        this.syncBurstSlot(slot);
      },
    });
  }

  triggerRoadPulse() {
    if (this.prefersReducedMotion()) return;
    const pulse = this.roadPulses[this.pulseCursor % this.roadPulses.length];
    this.pulseCursor += 1;
    pulse.timeline?.kill();
    pulse.mesh.visible = true;
    pulse.mesh.position.set(0, -0.024, CAR_Z - 0.7);
    pulse.mesh.scale.set(1, 1, 1);
    pulse.material.opacity = 0.82;
    pulse.timeline = gsap.timeline({ defaults: { overwrite: 'auto' } });
    pulse.timeline
      .to(pulse.mesh.position, { z: -46, duration: 0.48, ease: 'power3.in' }, 0)
      .to(pulse.mesh.scale, { y: 7.5, duration: 0.48, ease: 'power2.in' }, 0)
      .to(pulse.material, { opacity: 0, duration: 0.36, ease: 'power2.in' }, 0.1)
      .set(pulse.mesh, { visible: false });
    this.boostTween?.kill();
    this.boostTween = gsap.timeline({ defaults: { overwrite: 'auto' } })
      .to(this.boost, { value: 1, duration: 0.08, ease: 'power3.out' })
      .to(this.boost, { value: 0, duration: 0.48, ease: 'power2.out' });
    this.eventCounts.roadPulses += 1;
  }

  triggerShockwave(origin) {
    if (this.prefersReducedMotion()) return;
    this.shockwaves.forEach((wave, index) => {
      wave.timeline?.kill();
      wave.mesh.visible = true;
      wave.mesh.position.copy(origin);
      wave.mesh.position.z -= 0.7 + index * 0.16;
      wave.mesh.scale.setScalar(0.18 + index * 0.06);
      wave.material.opacity = index ? 0.58 : 0.78;
      wave.timeline = gsap.timeline({ delay: index * 0.045, defaults: { overwrite: 'auto' } });
      wave.timeline
        .to(wave.mesh.scale, {
          x: 4.8 + index * 0.7,
          y: 3.7 + index * 0.55,
          z: 1,
          duration: 0.42,
          ease: 'power3.out',
        }, 0)
        .to(wave.material, { opacity: 0, duration: 0.34, ease: 'power2.in' }, 0.08)
        .set(wave.mesh, { visible: false });
    });
    this.eventCounts.shockwaves += 1;
  }

  setSurface(surface = 'road') {
    this.surface = ['road', 'water', 'air'].includes(surface) ? surface : 'road';
    const roadVisible = this.surface === 'road';
    this.contactShadow.visible = roadVisible;
    for (const trail of this.reflectionTrails) trail.visible = roadVisible;
    if (!roadVisible) {
      this.roadPulses.forEach((pulse) => {
        pulse.timeline?.kill();
        pulse.mesh.visible = false;
        pulse.material.opacity = 0;
      });
    }
  }

  collect(origin) {
    this.triggerBurst('collect', origin);
    if (this.surface === 'road') this.triggerRoadPulse();
    this.eventCounts.collectBursts += 1;
  }

  crash(origin) {
    this.triggerBurst('crash', origin);
    this.triggerShockwave(origin);
    this.eventCounts.crashBursts += 1;
  }

  updateSpeedStreaks(state, active) {
    this.lastState = state;
    const speedAmount = THREE.MathUtils.clamp((state.speed - 28) / 34, 0, 1);
    const motionAmount = this.prefersReducedMotion() || !active ? 0 : speedAmount;
    const opacityTarget = motionAmount * (0.28 + this.boost.value * 0.34);
    if (Math.abs(opacityTarget - this.lastStreakOpacity) > 0.025) {
      this.lastStreakOpacity = opacityTarget;
      this.streakOpacityTo(opacityTarget);
    }
    const travel = state.distance * (1.35 + speedAmount * 1.35);
    const span = 88;
    for (let index = 0; index < this.streakCount; index++) {
      const seed = this.streakSeeds[index];
      const z = 14 - ((travel + seed.offset) % span);
      const length = (2.2 + speedAmount * 8.6 + this.boost.value * 5.2) * seed.length;
      const roadSample = bridgeElevationAndGradeAtZ(state, z);
      this.dummy.position.set(seed.x, roadSample.elevation - 0.015, z);
      this.dummy.rotation.set(roadSample.grade, 0, 0);
      this.dummy.scale.set(seed.width, 0.012, length);
      this.dummy.updateMatrix();
      this.streakMesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;

    const trailOpacity = this.prefersReducedMotion() || !active
      ? 0
      : 0.1 + speedAmount * 0.14 + this.boost.value * 0.2;
    for (const setOpacity of this.trailSetters) setOpacity(trailOpacity);
  }

  update(state, active) {
    this.updateSpeedStreaks(state, active);
  }

  reset() {
    this.boostTween?.kill();
    this.boost.value = 0;
    this.lastStreakOpacity = -1;
    this.streakMaterial.opacity = 0;
    Object.assign(this.eventCounts, { collectBursts: 0, roadPulses: 0, crashBursts: 0, shockwaves: 0 });
    this.burstSlots.forEach((slot) => {
      slot.tween?.kill();
      slot.active = false;
      slot.progress = 1;
      this.syncBurstSlot(slot);
    });
    [...this.roadPulses, ...this.shockwaves].forEach((effect) => {
      effect.timeline?.kill();
      effect.mesh.visible = false;
      effect.material.opacity = 0;
    });
    for (const setOpacity of this.trailSetters) setOpacity(0);
    this.setSurface('road');
  }

  snapshot() {
    return {
      pooledSpeedStreaks: this.streakCount,
      pooledBurstParticles: this.burstSlotCount * this.particlesPerBurst,
      mobileBudget: this.isMobile,
      surface: this.surface,
      ...this.eventCounts,
    };
  }
}
