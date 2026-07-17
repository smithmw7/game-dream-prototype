import * as THREE from 'three';
import { gsap } from 'gsap';

const SEED = 0x7a91c3e5;
const CAR_Z = 4;
const RECYCLE_Z = 38;
const ROAD_HALF_WIDTH = 6;
const LAMP_COLORS = ['#ffbd76', '#ff4db8', '#32edff'];
const GLYPH_COLORS = ['#38f5ff', '#ff4caf', '#ffcb76', '#a778ff'];
const PANEL_COLORS = ['#07151d', '#130b20', '#0b1325', '#171021'];

function clampDt(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 0.1);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function setupInstancedMesh(mesh, name) {
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Deterministic, pooled roadside furniture for Drive Mode.
 *
 * One logical pool feeds two render sets. Ordinary road biomes use materials
 * patched by Drive Mode's view-space world bend. Bridge props use unpatched
 * materials beneath a tangent-alignment rig whose pivot is the car position.
 * This keeps the gantries and light poles rigid against a climbing bridge
 * without recompiling materials when the biome changes.
 */
export class DriveRoadsideProps {
  constructor(parent, {
    isMobile = false,
    patchMaterial = (material) => material,
    prefersReducedMotion = () => false,
  } = {}) {
    this.parent = parent;
    this.isMobile = Boolean(isMobile);
    this.patchMaterial = patchMaterial;
    this.prefersReducedMotion = prefersReducedMotion;
    this.active = false;
    this.simulationActive = false;
    this.currentBiome = 'city';
    this.onBridge = false;
    this.roadElevation = 0;
    this.roadGrade = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.randomState = SEED;
    this.recycled = {
      streetlights: 0,
      gantries: 0,
      sideSigns: 0,
    };
    this.motionPhase = { pulse: 0, flicker: 0 };
    this.composeObject = new THREE.Object3D();
    this.tempColor = new THREE.Color();

    this.counts = {
      streetlightStations: this.isMobile ? 9 : 16,
      overheadGantries: this.isMobile ? 3 : 5,
      sideSigns: this.isMobile ? 5 : 8,
      practicalPointLights: this.isMobile ? 1 : 2,
    };

    this.environment = new THREE.Group();
    this.environment.name = 'Drive roadside props · cyber highway furniture';
    this.environment.visible = false;
    parent.add(this.environment);

    this.createSharedGeometry();
    this.createLogicalPools();
    this.bentSet = this.createVisualSet({
      bent: true,
      name: 'View-space bent city and desert roadside props',
    });
    this.bridgeSet = this.createVisualSet({
      bent: false,
      name: 'Unbent tangent-aligned bridge roadside props',
    });

    this.pulseTween = gsap.to(this.motionPhase, {
      pulse: Math.PI * 2,
      duration: 3.15,
      ease: 'none',
      repeat: -1,
      paused: true,
    });
    this.flickerTween = gsap.to(this.motionPhase, {
      flicker: Math.PI * 12,
      duration: 7.4,
      ease: 'none',
      repeat: -1,
      paused: true,
    });

    this.reset({ biome: 'city' });
    this.setActive(false);
  }

  random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  createSharedGeometry() {
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.haloGeometry = new THREE.IcosahedronGeometry(1, this.isMobile ? 0 : 1);
  }

  createLogicalPools() {
    this.streetlights = Array.from(
      { length: this.counts.streetlightStations },
      (_, index) => ({
        z: -10 - index * (this.isMobile ? 31 : 21),
        height: 5.7,
        armLength: 1.55,
        palette: index % LAMP_COLORS.length,
        pulseSeed: index * 1.731,
        speedFactor: 1,
      }),
    );
    this.gantries = Array.from(
      { length: this.counts.overheadGantries },
      (_, index) => ({
        z: -56 - index * (this.isMobile ? 106 : 78),
        panelCount: 2 + (index % 2),
        palette: index % GLYPH_COLORS.length,
        glyphSeed: index * 3 + 1,
        height: 6.35,
        speedFactor: 1,
      }),
    );
    this.sideSigns = Array.from(
      { length: this.counts.sideSigns },
      (_, index) => ({
        z: -30 - index * (this.isMobile ? 66 : 45),
        side: index % 2 === 0 ? -1 : 1,
        palette: (index + 1) % GLYPH_COLORS.length,
        glyphSeed: index * 5 + 2,
        height: 3.45,
        speedFactor: 1,
      }),
    );
  }

  makeMaterials({ bent, prefix }) {
    const apply = (material, key, style = 'plain') => (
      bent ? this.patchMaterial(material, `roadside-${prefix}-${key}`, style) : material
    );
    return {
      structure: apply(new THREE.MeshStandardMaterial({
        color: '#090b13',
        roughness: 0.43,
        metalness: 0.72,
        emissive: '#03030a',
        emissiveIntensity: 0.28,
      }), 'dark-metal'),
      panel: apply(new THREE.MeshPhysicalMaterial({
        color: '#30384c',
        roughness: 0.31,
        metalness: 0.56,
        clearcoat: 0.72,
        clearcoatRoughness: 0.17,
        emissive: '#050714',
        emissiveIntensity: 0.45,
        vertexColors: true,
      }), 'sign-panel'),
      lamp: apply(new THREE.MeshBasicMaterial({
        color: '#ffffff',
        toneMapped: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }), 'lamp-head'),
      halo: apply(new THREE.MeshBasicMaterial({
        color: '#ffffff',
        toneMapped: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }), 'lamp-halo'),
      glyph: apply(new THREE.MeshBasicMaterial({
        color: '#ffffff',
        toneMapped: false,
        vertexColors: true,
      }), 'diegetic-glyph'),
    };
  }

  createVisualSet({ bent, name }) {
    const group = new THREE.Group();
    group.name = name;
    group.visible = false;
    this.environment.add(group);

    const streetStructureCapacity = this.counts.streetlightStations * 4;
    const gantryStructureCapacity = this.counts.overheadGantries * 12;
    const sideStructureCapacity = this.counts.sideSigns * 3;
    const structureCapacity = streetStructureCapacity
      + gantryStructureCapacity
      + sideStructureCapacity;
    const lampCapacity = this.counts.streetlightStations * 2;
    const panelCapacity = this.counts.overheadGantries * 3 + this.counts.sideSigns;
    const glyphCapacity = this.counts.overheadGantries * 3 * 5
      + this.counts.sideSigns * 5;
    const materials = this.makeMaterials({
      bent,
      prefix: bent ? 'bent' : 'bridge',
    });

    const structureMesh = setupInstancedMesh(
      new THREE.InstancedMesh(this.boxGeometry, materials.structure, structureCapacity),
      `${name} · pooled dark metal`,
    );
    const panelMesh = setupInstancedMesh(
      new THREE.InstancedMesh(this.boxGeometry, materials.panel, panelCapacity),
      `${name} · pooled sign panels`,
    );
    const lampMesh = setupInstancedMesh(
      new THREE.InstancedMesh(this.boxGeometry, materials.lamp, lampCapacity),
      `${name} · pooled emissive lamp heads`,
    );
    const haloMesh = setupInstancedMesh(
      new THREE.InstancedMesh(this.haloGeometry, materials.halo, lampCapacity),
      `${name} · pooled additive lamp haze`,
    );
    const glyphMesh = setupInstancedMesh(
      new THREE.InstancedMesh(this.boxGeometry, materials.glyph, glyphCapacity),
      `${name} · pooled pseudo-text and lane glyphs`,
    );
    group.add(structureMesh, panelMesh, lampMesh, haloMesh, glyphMesh);

    const pointLights = [];
    for (let index = 0; index < this.counts.practicalPointLights; index++) {
      const light = new THREE.PointLight(LAMP_COLORS[index % LAMP_COLORS.length], 3.2, 13, 2);
      light.name = `${name} · practical streetlight ${index + 1}`;
      light.castShadow = false;
      pointLights.push(light);
      group.add(light);
    }

    return {
      bent,
      group,
      materials,
      structureMesh,
      panelMesh,
      lampMesh,
      haloMesh,
      glyphMesh,
      pointLights,
      cursors: {
        structure: 0,
        panel: 0,
        lamp: 0,
        halo: 0,
        glyph: 0,
      },
    };
  }

  setInstance(mesh, index, {
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    color = null,
  }) {
    this.composeObject.position.set(x, y, z);
    this.composeObject.rotation.set(rx, ry, rz);
    this.composeObject.scale.set(sx, sy, sz);
    this.composeObject.updateMatrix();
    mesh.setMatrixAt(index, this.composeObject.matrix);
    if (color !== null) {
      this.tempColor.set(color);
      mesh.setColorAt(index, this.tempColor);
    }
  }

  addStructure(set, transform) {
    this.setInstance(set.structureMesh, set.cursors.structure, transform);
    set.cursors.structure += 1;
  }

  addPanel(set, transform) {
    this.setInstance(set.panelMesh, set.cursors.panel, transform);
    set.cursors.panel += 1;
  }

  addLamp(set, transform) {
    this.setInstance(set.lampMesh, set.cursors.lamp, transform);
    set.cursors.lamp += 1;
  }

  addHalo(set, transform) {
    this.setInstance(set.haloMesh, set.cursors.halo, transform);
    set.cursors.halo += 1;
  }

  addGlyph(set, transform) {
    this.setInstance(set.glyphMesh, set.cursors.glyph, transform);
    set.cursors.glyph += 1;
  }

  localZ(set, worldZ) {
    return set.bent ? worldZ : worldZ - CAR_Z;
  }

  writeStreetlight(set, station) {
    const z = this.localZ(set, station.z);
    const reducedMotion = this.prefersReducedMotion();
    const pulse = reducedMotion
      ? 1
      : 0.94 + Math.sin(this.motionPhase.pulse + station.pulseSeed) * 0.07;
    const flickerWave = Math.sin(this.motionPhase.flicker * 1.17 + station.pulseSeed * 2.3);
    const flicker = reducedMotion || flickerWave > -0.89 ? 1 : 0.64;
    const lampColor = LAMP_COLORS[station.palette % LAMP_COLORS.length];

    for (const side of [-1, 1]) {
      const poleX = side * 7.1;
      const lampX = side * 5.72;
      const armCenterX = side * 6.4;
      const armCenterY = station.height - 0.17;
      this.addStructure(set, {
        x: poleX,
        y: station.height * 0.5,
        z,
        sx: 0.14,
        sy: station.height,
        sz: 0.14,
      });
      this.addStructure(set, {
        x: armCenterX,
        y: armCenterY,
        z,
        rz: side * 0.24,
        sx: station.armLength,
        sy: 0.11,
        sz: 0.12,
      });
      this.addLamp(set, {
        x: lampX,
        y: station.height - 0.35,
        z: z + 0.015,
        rz: side * 0.08,
        sx: 0.82 * pulse,
        sy: 0.22 * pulse,
        sz: 0.5 * pulse,
        color: lampColor,
      });
      this.addHalo(set, {
        x: lampX,
        y: station.height - 0.34,
        z: z + 0.035,
        sx: 1.18 * pulse * flicker,
        sy: 0.66 * pulse * flicker,
        sz: 0.64 * pulse * flicker,
        color: lampColor,
      });
    }
  }

  writeGantryGlyph(set, {
    x,
    y,
    z,
    width,
    color,
    seed,
  }) {
    const direction = seed % 2 === 0 ? -1 : 1;
    const lineWidthA = Math.min(width * 0.38, 1.34);
    const lineWidthB = Math.min(width * (0.2 + (seed % 3) * 0.035), 0.88);
    this.addGlyph(set, {
      x: x - width * 0.17,
      y: y + 0.38,
      z: z + 0.12,
      sx: lineWidthA,
      sy: 0.075,
      sz: 0.035,
      color,
    });
    this.addGlyph(set, {
      x: x - width * 0.24,
      y: y + 0.14,
      z: z + 0.12,
      sx: lineWidthB,
      sy: 0.065,
      sz: 0.035,
      color,
    });
    this.addGlyph(set, {
      x: x + width * 0.2,
      y: y - 0.2,
      z: z + 0.12,
      sx: 0.085,
      sy: 0.5,
      sz: 0.035,
      color,
    });
    this.addGlyph(set, {
      x: x + width * 0.2 - 0.13 * direction,
      y: y - 0.48,
      z: z + 0.12,
      rz: direction * 0.62,
      sx: 0.09,
      sy: 0.38,
      sz: 0.035,
      color,
    });
    this.addGlyph(set, {
      x: x + width * 0.2 + 0.13 * direction,
      y: y - 0.48,
      z: z + 0.12,
      rz: -direction * 0.62,
      sx: 0.09,
      sy: 0.38,
      sz: 0.035,
      color,
    });
  }

  writeGantry(set, gantry) {
    const z = this.localZ(set, gantry.z);
    const postHeight = gantry.height;
    const beamY = postHeight - 0.18;
    const topY = postHeight + 2.0;
    const panelCount = gantry.panelCount;
    const panelWidth = panelCount === 3 ? 3.55 : 4.45;
    const panelGap = panelCount === 3 ? 0.28 : 0.72;
    const totalWidth = panelWidth * panelCount + panelGap * (panelCount - 1);
    const panelStart = -totalWidth * 0.5 + panelWidth * 0.5;

    this.addStructure(set, {
      x: -7.05,
      y: postHeight * 0.5,
      z,
      sx: 0.22,
      sy: postHeight,
      sz: 0.22,
    });
    this.addStructure(set, {
      x: 7.05,
      y: postHeight * 0.5,
      z,
      sx: 0.22,
      sy: postHeight,
      sz: 0.22,
    });
    this.addStructure(set, {
      y: beamY,
      z,
      sx: 14.35,
      sy: 0.16,
      sz: 0.2,
    });
    this.addStructure(set, {
      y: beamY + 0.48,
      z,
      sx: 14.35,
      sy: 0.11,
      sz: 0.16,
    });

    for (let brace = 0; brace < 7; brace++) {
      this.addStructure(set, {
        x: -5.85 + brace * 1.95,
        y: beamY + 0.24,
        z,
        rz: brace % 2 === 0 ? 0.25 : -0.25,
        sx: 1.98,
        sy: 0.07,
        sz: 0.11,
      });
    }

    for (let panelIndex = 0; panelIndex < panelCount; panelIndex++) {
      const x = panelStart + panelIndex * (panelWidth + panelGap);
      const panelY = topY - 0.55;
      const panelColor = PANEL_COLORS[
        (gantry.glyphSeed + panelIndex) % PANEL_COLORS.length
      ];
      const glyphColor = GLYPH_COLORS[
        (gantry.palette + panelIndex) % GLYPH_COLORS.length
      ];
      this.addPanel(set, {
        x,
        y: panelY,
        z,
        sx: panelWidth,
        sy: 1.72,
        sz: 0.18,
        color: panelColor,
      });
      this.writeGantryGlyph(set, {
        x,
        y: panelY,
        z,
        width: panelWidth,
        color: glyphColor,
        seed: gantry.glyphSeed + panelIndex,
      });
    }
  }

  writeSideSign(set, sign) {
    const z = this.localZ(set, sign.z);
    const x = sign.side * 8.35;
    const panelWidth = 2.65 + (sign.glyphSeed % 3) * 0.28;
    const panelY = sign.height;
    const panelColor = PANEL_COLORS[sign.glyphSeed % PANEL_COLORS.length];
    const glyphColor = GLYPH_COLORS[sign.palette % GLYPH_COLORS.length];

    for (const offset of [-0.72, 0.72]) {
      this.addStructure(set, {
        x: x + offset,
        y: (panelY - 0.68) * 0.5,
        z,
        sx: 0.11,
        sy: panelY - 0.68,
        sz: 0.11,
      });
    }
    this.addStructure(set, {
      x,
      y: panelY - 0.73,
      z,
      sx: panelWidth + 0.24,
      sy: 0.1,
      sz: 0.13,
    });
    this.addPanel(set, {
      x,
      y: panelY,
      z,
      ry: sign.side * -0.045,
      sx: panelWidth,
      sy: 1.32,
      sz: 0.16,
      color: panelColor,
    });
    this.writeGantryGlyph(set, {
      x,
      y: panelY,
      z,
      width: panelWidth,
      color: glyphColor,
      seed: sign.glyphSeed,
    });
  }

  updateSetInstances(set) {
    Object.keys(set.cursors).forEach((key) => {
      set.cursors[key] = 0;
    });
    this.streetlights.forEach((station) => this.writeStreetlight(set, station));
    this.gantries.forEach((gantry) => this.writeGantry(set, gantry));
    this.sideSigns.forEach((sign) => this.writeSideSign(set, sign));

    const meshEntries = [
      ['structure', set.structureMesh],
      ['panel', set.panelMesh],
      ['lamp', set.lampMesh],
      ['halo', set.haloMesh],
      ['glyph', set.glyphMesh],
    ];
    meshEntries.forEach(([key, mesh]) => {
      mesh.count = set.cursors[key];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    this.updatePracticalLights(set);
  }

  updatePracticalLights(set) {
    const nearest = [...this.streetlights]
      .filter((station) => station.z > -38 && station.z < 24)
      .sort((a, b) => Math.abs(a.z - CAR_Z) - Math.abs(b.z - CAR_Z));
    const reducedMotion = this.prefersReducedMotion();
    set.pointLights.forEach((light, index) => {
      const station = nearest[index];
      if (!station) {
        light.visible = false;
        return;
      }
      light.visible = true;
      const side = index % 2 === 0 ? -1 : 1;
      const z = this.localZ(set, station.z);
      const color = LAMP_COLORS[station.palette % LAMP_COLORS.length];
      light.color.set(color);
      light.position.set(side * 5.72, station.height - 0.42, z + 0.15);
      light.intensity = reducedMotion
        ? 3.0
        : 2.8 + Math.sin(this.motionPhase.pulse + station.pulseSeed) * 0.55;
    });
  }

  recyclePool(pool, advance, spacing, category, configure) {
    if (advance <= 0 || pool.length === 0) return;
    let farthestZ = Infinity;
    pool.forEach((item) => {
      farthestZ = Math.min(farthestZ, item.z);
    });
    pool.forEach((item) => {
      item.z += advance * item.speedFactor;
      if (item.z > RECYCLE_Z) {
        farthestZ -= spacing[0] + this.random() * (spacing[1] - spacing[0]);
        configure(item, farthestZ);
        this.recycled[category] += 1;
      }
    });
  }

  configureStreetlight(station, z) {
    station.z = z;
    station.height = 5.25 + this.random() * 1.15;
    station.armLength = 1.35 + this.random() * 0.48;
    station.palette = Math.floor(this.random() * LAMP_COLORS.length);
    station.pulseSeed = this.random() * Math.PI * 2;
    station.speedFactor = 0.985 + this.random() * 0.025;
  }

  configureGantry(gantry, z) {
    gantry.z = z;
    gantry.panelCount = this.random() < 0.58 ? 3 : 2;
    gantry.palette = Math.floor(this.random() * GLYPH_COLORS.length);
    gantry.glyphSeed = Math.floor(this.random() * 10000);
    gantry.height = 6.2 + this.random() * 0.46;
    gantry.speedFactor = 0.99 + this.random() * 0.018;
  }

  configureSideSign(sign, z) {
    sign.z = z;
    sign.side = this.random() < 0.5 ? -1 : 1;
    sign.palette = Math.floor(this.random() * GLYPH_COLORS.length);
    sign.glyphSeed = Math.floor(this.random() * 10000);
    sign.height = 3.05 + this.random() * 1.15;
    sign.speedFactor = 0.985 + this.random() * 0.03;
  }

  setRenderMode(onBridge) {
    this.onBridge = Boolean(onBridge);
    this.bentSet.group.visible = this.active && !this.onBridge;
    this.bridgeSet.group.visible = this.active && this.onBridge;
  }

  alignBridgeSet(roadElevation, roadGrade) {
    this.roadElevation = Number.isFinite(roadElevation) ? roadElevation : 0;
    this.roadGrade = Number.isFinite(roadGrade) ? roadGrade : 0;
    this.bridgeSet.group.position.set(0, this.roadElevation, CAR_Z);
    this.bridgeSet.group.rotation.set(this.roadGrade, 0, 0);
  }

  setActive(active) {
    this.active = Boolean(active);
    this.environment.visible = this.active;
    this.setRenderMode(this.onBridge);
    const runMotion = this.active && this.simulationActive;
    this.pulseTween?.paused(!runMotion);
    this.flickerTween?.paused(!runMotion);
  }

  reset({ biome = 'city' } = {}) {
    this.currentBiome = typeof biome === 'string' && biome ? biome : 'city';
    this.randomState = (SEED ^ hashString(this.currentBiome)) >>> 0;
    this.distance = 0;
    this.elapsed = 0;
    this.motionPhase.pulse = 0;
    this.motionPhase.flicker = 0;
    Object.assign(this.recycled, {
      streetlights: 0,
      gantries: 0,
      sideSigns: 0,
    });

    const isDesert = this.currentBiome.includes('desert');
    const lightStep = this.isMobile ? (isDesert ? 38 : 30) : (isDesert ? 28 : 21);
    const gantryStep = this.isMobile ? (isDesert ? 126 : 104) : (isDesert ? 96 : 76);
    const signStep = this.isMobile ? (isDesert ? 78 : 63) : (isDesert ? 57 : 44);
    this.streetlights.forEach((station, index) => {
      this.configureStreetlight(station, -10 - index * lightStep);
      if (isDesert && index % 3 === 0) station.palette = 0;
    });
    this.gantries.forEach((gantry, index) => {
      this.configureGantry(gantry, -52 - index * gantryStep);
    });
    this.sideSigns.forEach((sign, index) => {
      this.configureSideSign(sign, -27 - index * signStep);
    });

    this.pulseTween?.restart();
    this.flickerTween?.restart();
    const runMotion = this.active && this.simulationActive;
    this.pulseTween?.paused(!runMotion);
    this.flickerTween?.paused(!runMotion);
    this.updateSetInstances(this.bentSet);
    this.updateSetInstances(this.bridgeSet);
  }

  update(dt, {
    advance = 0,
    active = true,
    biome = this.currentBiome,
    roadElevation = this.roadElevation,
    roadGrade = this.roadGrade,
    onBridge = false,
  } = {}) {
    const safeDt = clampDt(dt);
    this.elapsed += safeDt;
    this.simulationActive = Boolean(active);

    const nextBiome = typeof biome === 'string' && biome ? biome : 'city';
    if (nextBiome !== this.currentBiome) {
      this.reset({ biome: nextBiome });
    }
    this.setRenderMode(onBridge);
    this.alignBridgeSet(roadElevation, roadGrade);

    const runMotion = this.active && this.simulationActive;
    this.pulseTween?.paused(!runMotion);
    this.flickerTween?.paused(!runMotion);
    const safeAdvance = runMotion && Number.isFinite(advance) ? Math.max(0, advance) : 0;
    this.distance += safeAdvance;

    const isDesert = this.currentBiome.includes('desert');
    this.recyclePool(
      this.streetlights,
      safeAdvance,
      isDesert ? [24, 34] : [18, 25],
      'streetlights',
      (station, z) => this.configureStreetlight(station, z),
    );
    this.recyclePool(
      this.gantries,
      safeAdvance,
      isDesert ? [82, 112] : [66, 88],
      'gantries',
      (gantry, z) => this.configureGantry(gantry, z),
    );
    this.recyclePool(
      this.sideSigns,
      safeAdvance,
      isDesert ? [48, 70] : [38, 55],
      'sideSigns',
      (sign, z) => this.configureSideSign(sign, z),
    );
    this.updateSetInstances(this.onBridge ? this.bridgeSet : this.bentSet);
  }

  nearbyProps() {
    const props = [
      ...this.streetlights.map((item) => ({ kind: 'streetlight-pair', z: item.z })),
      ...this.gantries.map((item) => ({
        kind: `overhead-gantry-${item.panelCount}-panel`,
        z: item.z,
      })),
      ...this.sideSigns.map((item) => ({ kind: 'side-highway-sign', z: item.z })),
    ];
    return props
      .filter((item) => item.z > -105 && item.z < 30)
      .sort((a, b) => b.z - a.z)
      .slice(0, 7)
      .map((item) => ({
        kind: item.kind,
        z: +item.z.toFixed(1),
      }));
  }

  snapshot() {
    return {
      active: this.active,
      simulationActive: this.simulationActive,
      biome: this.currentBiome,
      traveled: +this.distance.toFixed(1),
      renderMode: this.onBridge ? 'bridge-unbent' : 'world-bent',
      alignment: {
        unbentForBridge: this.onBridge,
        pivotZ: CAR_Z,
        elevation: +this.roadElevation.toFixed(3),
        grade: +this.roadGrade.toFixed(4),
      },
      style: 'dark high-contrast cyber highway with neon practical streetlights',
      lighting: {
        pairedStreetlightStations: this.streetlights.length,
        emissiveLampHeads: this.streetlights.length * 2,
        practicalPointLights: this.counts.practicalPointLights,
        reducedMotion: Boolean(this.prefersReducedMotion()),
      },
      signage: {
        overheadGantries: this.gantries.length,
        sideHighwaySigns: this.sideSigns.length,
        pseudoText: 'instanced geometric bars, chevrons, and lane arrows',
        spansRoadWidth: ROAD_HALF_WIDTH * 2,
      },
      performance: {
        poolProfile: this.isMobile ? 'mobile-reduced' : 'desktop-full',
        instanced: true,
        visibleInstancedDrawCalls: 5,
        hiddenAlternateRenderSet: true,
      },
      recycled: { ...this.recycled },
      nearbyProps: this.nearbyProps(),
    };
  }

  dispose() {
    this.pulseTween?.kill();
    this.flickerTween?.kill();
    this.environment.removeFromParent();
    const geometries = new Set([this.boxGeometry, this.haloGeometry]);
    const materials = new Set();
    this.environment.traverse((child) => {
      if (child.isMesh && child.geometry) geometries.add(child.geometry);
      if (!child.material) return;
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.filter(Boolean).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}
