import * as THREE from 'three';
import { gsap } from 'gsap';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DriveVisualGains } from './DriveVisualGains.js';
import { DriveCanalSection } from './DriveCanalSection.js';

const DRIVE_ORIGIN_X = -1000;
const ROAD_NEAR_Z = 18;
const ROAD_FAR_Z = -300;
const CAR_Z = 4;
const LANE_X = [-3.25, 0, 3.25];
const DRIVE_CYCLE_LENGTH = 1100;
const CANAL_APPROACH_START = 250;
const CANAL_ENTRY_START = 300;
const CANAL_RUN_START = 345;
const CANAL_EXIT_START = 820;
const CANAL_RETURN_START = 865;

function driveSectionAtDistance(distance) {
  const cycleIndex = Math.max(0, Math.floor(distance / DRIVE_CYCLE_LENGTH));
  const cycleDistance = ((distance % DRIVE_CYCLE_LENGTH) + DRIVE_CYCLE_LENGTH) % DRIVE_CYCLE_LENGTH;
  let phase = 'city';
  let label = 'ENDLESS CITY';
  let start = 0;
  let end = CANAL_APPROACH_START;
  let vehicle = 'car';
  let surface = 'road';

  if (cycleDistance >= CANAL_APPROACH_START && cycleDistance < CANAL_ENTRY_START) {
    phase = 'canal-approach';
    label = 'AQUA LINK';
    start = CANAL_APPROACH_START;
    end = CANAL_ENTRY_START;
  } else if (cycleDistance >= CANAL_ENTRY_START && cycleDistance < CANAL_RUN_START) {
    phase = 'canal-entry';
    label = 'AMPHIBIOUS TRANSFORM';
    start = CANAL_ENTRY_START;
    end = CANAL_RUN_START;
    vehicle = 'transforming-to-boat';
    surface = 'air';
  } else if (cycleDistance >= CANAL_RUN_START && cycleDistance < CANAL_EXIT_START) {
    phase = 'canal';
    label = 'NEON TIDEWAY';
    start = CANAL_RUN_START;
    end = CANAL_EXIT_START;
    vehicle = 'speedboat';
    surface = 'water';
  } else if (cycleDistance >= CANAL_EXIT_START && cycleDistance < CANAL_RETURN_START) {
    phase = 'canal-exit';
    label = 'ROADLINK TRANSFORM';
    start = CANAL_EXIT_START;
    end = CANAL_RETURN_START;
    vehicle = 'transforming-to-car';
    surface = 'air';
  } else if (cycleDistance >= CANAL_RETURN_START) {
    start = CANAL_RETURN_START;
    end = DRIVE_CYCLE_LENGTH;
  }

  return {
    phase,
    label,
    vehicle,
    surface,
    cycleIndex,
    cycleDistance,
    progress: THREE.MathUtils.clamp((cycleDistance - start) / Math.max(1, end - start), 0, 1),
    start,
    end,
  };
}

function smoothDamp(current, target, rate, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

export class DriveMode {
  constructor(scene, {
    isMobile = false,
    onCollect = () => {},
    onCrash = () => {},
    onSectionChange = () => {},
    prefersReducedMotion = () => false,
  } = {}) {
    this.scene = scene;
    this.isMobile = isMobile;
    this.viewportAspect = innerWidth / Math.max(1, innerHeight);
    this.onCollect = onCollect;
    this.onCrash = onCrash;
    this.onSectionChange = onSectionChange;
    this.prefersReducedMotion = prefersReducedMotion;
    this.noise = new ImprovedNoise();
    this.randomState = 0x5f3759df;
    this.terrainAccumulator = 0;
    this.cameraTarget = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.worldCarPosition = new THREE.Vector3();
    this.state = {
      laneIndex: 1,
      targetLane: 1,
      lateralX: 0,
      distance: 0,
      speed: 0,
      shards: 0,
      orbs: 0,
      score: 0,
      elapsed: 0,
      crashed: false,
      laneChanges: 0,
      phase: 'city',
      sectionLabel: 'ENDLESS CITY',
      cycleIndex: 0,
      cycleDistance: 0,
      sectionProgress: 0,
      vehicle: 'car',
      surface: 'road',
      airborne: false,
    };
    this.bendUniforms = {
      uDriveTime: { value: 0 },
      uDriveTravel: { value: 0 },
      uBendStart: { value: 15 },
      uBendMaxDepth: { value: 285 },
      uBendX: { value: 0.00018 },
      uBendY: { value: 0.00128 },
      uDriveOriginX: { value: DRIVE_ORIGIN_X },
    };
    this.motionPhase = { shard: 0 };
    this.shardPhaseTween = gsap.to(this.motionPhase, {
      shard: Math.PI * 2,
      duration: 1.65,
      ease: 'none',
      repeat: -1,
    });

    this.root = new THREE.Group();
    this.root.name = 'Drive Mode · Neon City';
    this.root.position.x = DRIVE_ORIGIN_X;
    this.root.visible = false;
    scene.add(this.root);

    this.createSky();
    this.createRoad();
    this.createTerrain();
    this.createCity();
    this.createRunnerObjects();
    this.createCar();
    this.canalSection = new DriveCanalSection(this.root, {
      isMobile: this.isMobile,
      patchMaterial: (material, key, style) => this.patchBend(material, key, style),
      onCollect: (event) => this.handleCanalCollect(event),
      onCrash: (event) => this.handleCanalCrash(event),
      prefersReducedMotion: this.prefersReducedMotion,
    });
    this.boatRig = this.canalSection.boatRig;
    this.carImpactRig.add(this.boatRig);
    this.createMorphEffects();
    this.createVehicleMorphTimelines();
    this.createTransitionRamps();
    this.createLights();
    this.visualGains = new DriveVisualGains(this.root, this.car, {
      isMobile: this.isMobile,
      prefersReducedMotion: this.prefersReducedMotion,
      patchMaterial: (material, key) => this.patchBend(material, key),
    });
    this.reset();
  }

  random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  patchBend(material, key, style = 'plain') {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.bendUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uBendStart;
          uniform float uBendMaxDepth;
          uniform float uBendX;
          uniform float uBendY;
          varying vec3 vDriveWorldPosition;
          varying vec2 vDriveUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vDriveUv = uv;
          vDriveWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`,
        )
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            mvPosition = batchingMatrix * mvPosition;
          #endif
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          float driveBendDistance = clamp(-mvPosition.z - uBendStart, 0.0, uBendMaxDepth);
          float driveBendSquared = driveBendDistance * driveBendDistance;
          mvPosition.x += uBendX * driveBendSquared;
          mvPosition.y -= uBendY * driveBendSquared;
          gl_Position = projectionMatrix * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uDriveTime;
        uniform float uDriveTravel;
        uniform float uDriveOriginX;
        varying vec3 vDriveWorldPosition;
        varying vec2 vDriveUv;`,
      );

      if (style === 'road') {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float driveRoadX = vDriveWorldPosition.x - uDriveOriginX;
            float driveRoadZ = -vDriveWorldPosition.z + uDriveTravel;
            float laneA = 1.0 - smoothstep(0.035, 0.11, abs(abs(driveRoadX) - 1.63));
            float edgeLine = 1.0 - smoothstep(0.04, 0.13, abs(abs(driveRoadX) - 5.55));
            float dash = step(0.48, fract(driveRoadZ / 8.0));
            float marker = laneA * dash;
            vec2 puddleCell = floor(vec2(driveRoadX * 1.7, driveRoadZ * 0.18));
            float puddleNoise = fract(sin(dot(puddleCell, vec2(12.9898, 78.233))) * 43758.5453);
            float puddle = smoothstep(0.61, 0.94, puddleNoise) * (0.36 + 0.64 * (1.0 - smoothstep(1.2, 5.4, abs(driveRoadX))));
            vec2 gritCell = floor(vec2(driveRoadX * 21.0, driveRoadZ * 3.2));
            float microGrit = fract(sin(dot(gritCell, vec2(18.9898, 63.7264))) * 31758.5453);
            float tireWear = exp(-abs(abs(driveRoadX) - 1.62) * 0.7);
            float rainRill = pow(0.5 + 0.5 * sin(driveRoadZ * 0.36 + driveRoadX * 8.0), 26.0);
            float neonStreak = pow(max(0.0, sin(driveRoadZ * 0.11 + driveRoadX * 0.7)), 18.0) * 0.2;
            float wetPulse = 0.15 + 0.85 * pow(0.5 + 0.5 * sin(driveRoadZ * 0.075), 8.0);
            float cyanReflection = exp(-abs(driveRoadX + 4.75) * 1.12) * wetPulse;
            float pinkReflection = exp(-abs(driveRoadX - 4.75) * 1.12) * wetPulse;
            vec3 asphalt = mix(vec3(0.004, 0.006, 0.013), vec3(0.018, 0.03, 0.052), puddle);
            asphalt *= 0.78 + microGrit * 0.26;
            asphalt += tireWear * vec3(0.005, 0.008, 0.014) + rainRill * vec3(0.002, 0.008, 0.014);
            diffuseColor.rgb = asphalt;
            diffuseColor.rgb += marker * vec3(0.08, 0.82, 1.0) * 0.52;
            diffuseColor.rgb += edgeLine * vec3(1.0, 0.02, 0.47) * 0.62;
            diffuseColor.rgb += cyanReflection * vec3(0.0, 0.34, 0.48) * (0.18 + puddle * 0.5);
            diffuseColor.rgb += pinkReflection * vec3(0.48, 0.0, 0.22) * (0.18 + puddle * 0.5);
            diffuseColor.rgb += neonStreak * mix(vec3(0.0, 0.72, 1.0), vec3(1.0, 0.0, 0.48), step(0.0, driveRoadX));`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = clamp(mix(0.48, 0.055, puddle) + (microGrit - 0.5) * 0.11 - rainRill * 0.08, 0.045, 0.58);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            totalEmissiveRadiance += marker * vec3(0.02, 0.32, 0.58) + edgeLine * vec3(0.72, 0.0, 0.2) + neonStreak * vec3(0.14, 0.015, 0.25);
            totalEmissiveRadiance += cyanReflection * vec3(0.0, 0.18, 0.28) + pinkReflection * vec3(0.25, 0.0, 0.12);`,
          )
          .replace(
            '#include <opaque_fragment>',
            `outgoingLight *= 0.26;
            outgoingLight += marker * vec3(0.03, 0.42, 0.72) + edgeLine * vec3(0.82, 0.0, 0.24);
            outgoingLight += cyanReflection * vec3(0.0, 0.17, 0.28) + pinkReflection * vec3(0.24, 0.0, 0.12);
            #include <opaque_fragment>`,
          );
      } else if (style === 'building') {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            vec2 driveWindowCell = fract(vDriveUv * vec2(6.0, 17.0));
            float driveWindowX = step(0.18, driveWindowCell.x) * step(driveWindowCell.x, 0.74);
            float driveWindowY = step(0.2, driveWindowCell.y) * step(driveWindowCell.y, 0.68);
            float driveWindows = driveWindowX * driveWindowY * step(1.0, vDriveWorldPosition.y);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            vec3 windowColor = mix(vec3(0.0, 0.48, 0.82), vec3(0.9, 0.012, 0.34), step(0.5, fract(vDriveWorldPosition.y * 0.071)));
            totalEmissiveRadiance += driveWindows * windowColor * 0.62;`,
          );
      } else if (style === 'terrain') {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float ridgeGlow = pow(1.0 - abs(normal.y), 3.0);
          totalEmissiveRadiance += ridgeGlow * vec3(0.08, 0.0, 0.18);`,
        );
      }
    };
    material.customProgramCacheKey = () => `game-dream-drive-${key}-v4`;
    return material;
  }

  createSky() {
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { time: this.bendUniforms.uDriveTime },
      vertexShader: `varying vec3 vSkyDirection; void main(){ vSkyDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vSkyDirection;
        uniform float time;
        float hash(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
        void main(){
          vec3 d=normalize(vSkyDirection);
          float horizon=pow(clamp(1.0-abs(d.y+0.08),0.0,1.0),5.0);
          float stars=step(0.994,hash(floor(d*520.0)))*smoothstep(-0.05,0.25,d.y);
          vec3 color=mix(vec3(0.002,0.004,0.018),vec3(0.025,0.012,0.09),max(d.y,0.0));
          color+=horizon*vec3(0.22,0.0,0.19);
          color+=stars*mix(vec3(0.1,0.8,1.0),vec3(1.0,0.1,0.5),hash(floor(d*311.0)))*2.4;
          gl_FragColor=vec4(color,1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(235, 28, 18), skyMaterial);
    this.sky.renderOrder = -20;
    this.root.add(this.sky);

    const sunMaterial = new THREE.MeshBasicMaterial({ color: '#ff287f', fog: false });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(23, 64), sunMaterial);
    this.sunDisc.position.set(0, 28, -205);
    this.root.add(this.sunDisc);
    const barMaterial = new THREE.MeshBasicMaterial({ color: '#18051f', fog: false });
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(49, 1.05 + i * 0.11), barMaterial);
      bar.position.set(0, 18 + i * 3.2, -204.8);
      this.root.add(bar);
    }
  }

  createRoad() {
    this.roadEnvironment = new THREE.Group();
    this.roadEnvironment.name = 'Drive road deck and neon edges';
    this.root.add(this.roadEnvironment);
    const roadMaterial = this.patchBend(new THREE.MeshPhysicalMaterial({
      color: '#02040a', roughness: 0.26, metalness: 0.08,
      clearcoat: 1, clearcoatRoughness: 0.055, envMapIntensity: 0.58,
      specularIntensity: 0.9, ior: 1.42,
    }), 'wet-road', 'road');
    const roadGeometry = new THREE.BoxGeometry(12, 0.24, 320, 1, 1, this.isMobile ? 80 : 144);
    this.road = new THREE.Mesh(roadGeometry, roadMaterial);
    this.road.position.set(0, -0.16, -141);
    this.road.frustumCulled = false;
    this.road.receiveShadow = true;
    this.roadEnvironment.add(this.road);

    const curbMaterial = this.patchBend(new THREE.MeshStandardMaterial({
      color: '#030611', roughness: 0.72, metalness: 0.12, emissive: '#020713', emissiveIntensity: 0.18,
    }), 'curb');
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 320, 1, 1, this.isMobile ? 64 : 128), curbMaterial);
      curb.position.set(side * 6.8, -0.04, -141);
      curb.frustumCulled = false;
      curb.receiveShadow = true;
      this.roadEnvironment.add(curb);

      const railMaterial = this.patchBend(new THREE.MeshBasicMaterial({
        color: side < 0 ? '#14dcff' : '#ff1b8d', toneMapped: false,
      }), `road-edge-${side}`);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 320, 1, 1, this.isMobile ? 64 : 128), railMaterial);
      rail.position.set(side * 6.03, 0.05, -141);
      rail.frustumCulled = false;
      this.roadEnvironment.add(rail);
    }
  }

  createTerrainGeometry(side) {
    const xSegments = this.isMobile ? 6 : 10;
    const zSegments = this.isMobile ? 36 : 56;
    const positions = [];
    const indices = [];
    const baseX = [];
    const baseZ = [];
    for (let zIndex = 0; zIndex <= zSegments; zIndex++) {
      const z = THREE.MathUtils.lerp(ROAD_NEAR_Z, ROAD_FAR_Z, zIndex / zSegments);
      for (let xIndex = 0; xIndex <= xSegments; xIndex++) {
        const magnitude = THREE.MathUtils.lerp(7.6, 76, xIndex / xSegments);
        const x = magnitude * side;
        positions.push(x, -0.45, z);
        baseX.push(x);
        baseZ.push(z);
      }
    }
    const row = xSegments + 1;
    for (let zIndex = 0; zIndex < zSegments; zIndex++) {
      for (let xIndex = 0; xIndex < xSegments; xIndex++) {
        const a = zIndex * row + xIndex;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.baseX = baseX;
    geometry.userData.baseZ = baseZ;
    return geometry;
  }

  createTerrain() {
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'Drive procedural terrain';
    this.root.add(this.terrainGroup);
    const terrainMaterial = this.patchBend(new THREE.MeshStandardMaterial({
      color: '#090919', roughness: 0.78, metalness: 0.2, emissive: '#100018', emissiveIntensity: 0.3,
      flatShading: true, side: THREE.DoubleSide,
    }), 'dynamic-terrain', 'terrain');
    const wireMaterial = this.patchBend(new THREE.MeshBasicMaterial({
      color: '#5b1dff', wireframe: true, transparent: true, opacity: 0.24, toneMapped: false,
    }), 'terrain-wire');
    this.terrainMeshes = [];
    for (const side of [-1, 1]) {
      const geometry = this.createTerrainGeometry(side);
      const surface = new THREE.Mesh(geometry, terrainMaterial);
      const wire = new THREE.Mesh(geometry, wireMaterial);
      surface.frustumCulled = false;
      surface.receiveShadow = true;
      wire.frustumCulled = false;
      wire.renderOrder = 1;
      this.terrainGroup.add(surface, wire);
      this.terrainMeshes.push({ geometry, surface, wire });
    }
    this.updateTerrain(true);
  }

  updateTerrain(force = false) {
    const updateInterval = this.isMobile ? 0.1 : 0.05;
    if (!force && this.terrainAccumulator < updateInterval) return;
    this.terrainAccumulator %= updateInterval;
    for (const { geometry } of this.terrainMeshes) {
      const position = geometry.attributes.position;
      const { baseX, baseZ } = geometry.userData;
      for (let index = 0; index < position.count; index++) {
        const x = baseX[index];
        const z = baseZ[index];
        const worldZ = this.state.distance + Math.max(0, -z);
        const falloff = THREE.MathUtils.smoothstep(Math.abs(x), 7.5, 55);
        const broad = Math.abs(this.noise.noise(x * 0.018, worldZ * 0.009, 2.1));
        const ridge = Math.abs(this.noise.noise(x * 0.052 + 8.0, worldZ * 0.024, 5.3));
        const detail = this.noise.noise(x * 0.11, worldZ * 0.055, 9.7) * 0.5 + 0.5;
        const height = -0.42 + falloff * (2.2 + broad * 18 + ridge * 7 + detail * 2.4);
        position.setY(index, height);
      }
      position.needsUpdate = true;
    }
  }

  createCity() {
    this.cityGroup = new THREE.Group();
    this.cityGroup.name = 'Drive recycled cyber city';
    this.root.add(this.cityGroup);
    this.buildingMaterials = [
      this.patchBend(new THREE.MeshStandardMaterial({ color: '#080d1d', roughness: 0.7, metalness: 0.25, emissive: '#02040c', emissiveIntensity: 0.2 }), 'building-a', 'building'),
      this.patchBend(new THREE.MeshStandardMaterial({ color: '#111126', roughness: 0.62, metalness: 0.32, emissive: '#080314', emissiveIntensity: 0.25 }), 'building-b', 'building'),
      this.patchBend(new THREE.MeshStandardMaterial({ color: '#07151f', roughness: 0.68, metalness: 0.22, emissive: '#001018', emissiveIntensity: 0.22 }), 'building-c', 'building'),
    ];
    this.neonMaterials = [
      this.patchBend(new THREE.MeshBasicMaterial({ color: '#ff168d', toneMapped: false }), 'sign-magenta'),
      this.patchBend(new THREE.MeshBasicMaterial({ color: '#1ee9ff', toneMapped: false }), 'sign-cyan'),
      this.patchBend(new THREE.MeshBasicMaterial({ color: '#8154ff', toneMapped: false }), 'sign-violet'),
    ];
    const bodyGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 7, 3);
    const signGeometry = new THREE.BoxGeometry(0.18, 1, 1);
    this.buildings = [];
    const count = this.isMobile ? 28 : 44;
    for (let index = 0; index < count; index++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, this.buildingMaterials[index % this.buildingMaterials.length]);
      const sign = new THREE.Mesh(signGeometry, this.neonMaterials[index % this.neonMaterials.length]);
      body.frustumCulled = false;
      sign.frustumCulled = false;
      group.add(body, sign);
      this.cityGroup.add(group);
      const building = { group, body, sign, side: index % 2 ? 1 : -1, speedFactor: 1 };
      this.buildings.push(building);
      this.recycleBuilding(building, -18 - index * (this.isMobile ? 10 : 7.2));
    }
  }

  recycleBuilding(building, z) {
    const width = 4.2 + this.random() * 4.8;
    const depth = 4 + this.random() * 8;
    const height = 9 + Math.pow(this.random(), 0.62) * 29;
    const setback = 12.5 + this.random() * 10.5;
    building.group.position.set(building.side * setback, 0, z);
    building.body.scale.set(width, height, depth);
    building.body.position.y = height / 2 - 0.1;
    building.sign.scale.set(1, Math.max(3, height * (0.25 + this.random() * 0.25)), 0.65 + this.random() * 0.9);
    building.sign.position.set(-building.side * (width / 2 + 0.1), height * (0.38 + this.random() * 0.34), depth * (this.random() - 0.5) * 0.55);
    building.speedFactor = 0.94 + this.random() * 0.1;
  }

  createRunnerObjects() {
    this.runnerGroup = new THREE.Group();
    this.runnerGroup.name = 'Drive road pickups and barriers';
    this.root.add(this.runnerGroup);
    const barrierMaterial = this.patchBend(new THREE.MeshPhysicalMaterial({
      color: '#5b0a2d', emissive: '#ff056f', emissiveIntensity: 2.4,
      roughness: 0.18, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.08,
    }), 'barrier');
    const shardMaterial = this.patchBend(new THREE.MeshPhysicalMaterial({
      color: '#5bf6ff', emissive: '#00b8ff', emissiveIntensity: 3.3,
      roughness: 0.12, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06,
    }), 'shard');
    const barrierGeometry = new RoundedBoxGeometry(2.15, 1.2, 0.75, 4, 0.16);
    const shardGeometry = new THREE.OctahedronGeometry(0.52, 0);
    this.runnerObjects = [];
    const count = this.isMobile ? 11 : 15;
    for (let index = 0; index < count; index++) {
      const barrier = new THREE.Mesh(barrierGeometry, barrierMaterial);
      const shard = new THREE.Mesh(shardGeometry, shardMaterial);
      barrier.frustumCulled = false;
      shard.frustumCulled = false;
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      this.runnerGroup.add(barrier, shard);
      const object = { barrier, shard, kind: 'shard', lane: 1, z: -30, resolved: false };
      this.runnerObjects.push(object);
      this.recycleRunnerObject(object, -34 - index * 19);
    }
  }

  recycleRunnerObject(object, z) {
    gsap.killTweensOf(object.shard.scale);
    object.kind = this.random() < 0.46 ? 'barrier' : 'shard';
    object.lane = Math.floor(this.random() * 3);
    object.z = z;
    object.resolved = false;
    object.barrier.visible = object.kind === 'barrier';
    object.shard.visible = object.kind === 'shard';
    object.shard.scale.setScalar(1);
    object.barrier.position.set(LANE_X[object.lane], 0.62, z);
    object.shard.position.set(LANE_X[object.lane], 1.05, z);
  }

  createCar() {
    this.car = new THREE.Group();
    this.car.name = 'Neon Cyber Runner';
    this.car.position.set(0, 0.06, CAR_Z);
    this.root.add(this.car);

    this.vehicleLiftRig = new THREE.Group();
    this.vehicleLiftRig.name = 'GSAP amphibious jump presentation';
    this.carMotionRig = new THREE.Group();
    this.carMotionRig.name = 'GSAP lane and hover presentation';
    this.carImpactRig = new THREE.Group();
    this.carImpactRig.name = 'GSAP impact presentation';
    this.carVisualRig = new THREE.Group();
    this.carVisualRig.name = 'Cyber coupe visual';
    this.car.add(this.vehicleLiftRig);
    this.vehicleLiftRig.add(this.carMotionRig);
    this.carMotionRig.add(this.carImpactRig);
    this.carImpactRig.add(this.carVisualRig);

    const paint = new THREE.MeshPhysicalMaterial({
      color: '#09071d', metalness: 0.46, roughness: 0.24,
      clearcoat: 0.82, clearcoatRoughness: 0.1, envMapIntensity: 0.09,
      iridescence: 0.42, iridescenceIOR: 1.8,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#061724', metalness: 0.2, roughness: 0.08,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.28,
    });
    const tire = new THREE.MeshStandardMaterial({ color: '#030307', roughness: 0.72, metalness: 0.15 });
    const cyan = new THREE.MeshBasicMaterial({ color: '#20e8ff', toneMapped: false });
    const magenta = new THREE.MeshBasicMaterial({ color: '#ff167f', toneMapped: false });
    const red = new THREE.MeshBasicMaterial({ color: '#ff203f', toneMapped: false });

    const lower = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.68, 5.1, 5, 0.22), paint);
    lower.position.y = 0.45;
    const hood = new THREE.Mesh(new RoundedBoxGeometry(3.15, 0.42, 2.15, 4, 0.14), paint);
    hood.position.set(0, 0.83, -1.35);
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.62, 0.84, 2.15, 5, 0.2), glass);
    cabin.position.set(0, 1.23, 0.2);
    cabin.scale.set(0.92, 1, 0.95);
    this.carVisualRig.add(lower, hood, cabin);

    for (const side of [-1, 1]) {
      for (const z of [-1.45, 1.45]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.34, 18), tire);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 1.72, 0.38, z);
        this.carVisualRig.add(wheel);
      }
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.08), red);
      tail.position.set(side * 0.95, 0.72, 2.57);
      this.carVisualRig.add(tail);
      const sideStrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 3.9), side < 0 ? cyan : magenta);
      sideStrip.position.set(side * 1.72, 0.55, 0.1);
      this.carVisualRig.add(sideStrip);
    }
    const rearStrip = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 0.08), magenta);
    rearStrip.position.set(0, 0.92, 2.59);
    this.carVisualRig.add(rearStrip);
    const underglow = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 4.5), new THREE.MeshBasicMaterial({
      color: '#ff0e8d', transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
    underglow.rotation.x = -Math.PI / 2;
    underglow.position.y = 0.01;
    this.carVisualRig.add(underglow);
    this.underglow = underglow;
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.12, 0.36), paint);
    spoiler.position.set(0, 1.25, 2.15);
    this.carVisualRig.add(spoiler);

    this.carVisualRig.traverse((child) => {
      if (!child.isMesh || child.material?.transparent) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });

    const hoverAmount = this.prefersReducedMotion() ? 0 : 0.022;
    this.carIdleTimeline = gsap.timeline({ repeat: -1, yoyo: true });
    this.carIdleTimeline.to(this.carMotionRig.position, {
      y: hoverAmount,
      duration: 0.28,
      ease: 'sine.inOut',
    }).to(this.underglow.material, {
      opacity: this.prefersReducedMotion() ? 0.26 : 0.38,
      duration: 0.28,
      ease: 'sine.inOut',
    }, 0);
  }

  createTransitionRamps() {
    this.transitionGroup = new THREE.Group();
    this.transitionGroup.name = 'Amphibious transition ramps';
    this.root.add(this.transitionGroup);

    const deckMaterial = this.patchBend(new THREE.MeshPhysicalMaterial({
      color: '#080918',
      emissive: '#07132a',
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.58,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }), 'amphibious-ramp-deck');
    const cyan = this.patchBend(new THREE.MeshBasicMaterial({
      color: '#28f6ff', toneMapped: false,
    }), 'amphibious-ramp-cyan');
    const magenta = this.patchBend(new THREE.MeshBasicMaterial({
      color: '#ff1c93', toneMapped: false,
    }), 'amphibious-ramp-magenta');

    const makeRamp = (name, accentMaterial) => {
      const group = new THREE.Group();
      group.name = name;
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(11.8, 0.5, 15, 1, 1, this.isMobile ? 12 : 24),
        deckMaterial,
      );
      deck.position.y = 0.72;
      deck.rotation.x = -0.135;
      deck.castShadow = true;
      deck.receiveShadow = true;
      group.add(deck);

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 15), side < 0 ? cyan : magenta);
        rail.position.set(side * 5.78, 1.02, 0);
        rail.rotation.x = -0.135;
        group.add(rail);
      }
      for (let index = 0; index < 5; index++) {
        const chevron = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.045, 0.18), accentMaterial);
        chevron.position.set(0, 1.08 + index * 0.08, 4.7 - index * 2.35);
        chevron.rotation.x = -0.135;
        group.add(chevron);
      }
      const portal = new THREE.Group();
      const portalPostGeometry = new THREE.BoxGeometry(0.22, 5.8, 0.24);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(portalPostGeometry, side < 0 ? cyan : magenta);
        post.position.set(side * 6.05, 3.0, -5.4);
        portal.add(post);
      }
      const header = new THREE.Mesh(new THREE.BoxGeometry(12.3, 0.24, 0.24), accentMaterial);
      header.position.set(0, 5.86, -5.4);
      portal.add(header);
      group.add(portal);
      this.transitionGroup.add(group);
      return group;
    };

    this.entryRamp = makeRamp('Road to canal launch ramp', cyan);
    this.exitRamp = makeRamp('Canal to road launch ramp', magenta);
  }

  createMorphEffects() {
    this.morphFxGroup = new THREE.Group();
    this.morphFxGroup.name = 'GSAP amphibious transformation energy';
    this.morphFxGroup.position.y = 0.85;
    this.morphFxGroup.visible = false;
    this.carImpactRig.add(this.morphFxGroup);

    this.morphCoreMaterial = new THREE.MeshBasicMaterial({
      color: '#f3ffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.72, 18, 12), this.morphCoreMaterial);
    core.scale.set(1.1, 0.62, 1.45);
    this.morphFxGroup.add(core);

    this.morphRingMaterials = ['#25efff', '#ff2d9b'].map((color) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }));
    this.morphRingMaterials.forEach((material, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05 + index * 0.32, 0.045, 8, 42), material);
      ring.rotation.set(index ? 0.45 : -0.32, index ? 0.25 : -0.22, index * Math.PI / 2);
      this.morphFxGroup.add(ring);
    });
  }

  createVehicleMorphTimelines() {
    this.vehiclePose = {
      lift: 0,
      pitch: 0,
      roll: 0,
      carScale: 1,
      carSpin: 0,
      boatScale: 0.001,
      boatSpin: -Math.PI,
      morphEnergy: 0,
    };
    this.entryMorphTimeline = gsap.timeline({ paused: true });
    this.entryMorphTimeline
      .fromTo(this.vehiclePose, {
        lift: 0, pitch: 0, roll: 0,
        carScale: 1, carSpin: 0,
        boatScale: 0.001, boatSpin: -0.9,
        morphEnergy: 0,
      }, {
        lift: this.prefersReducedMotion() ? 1.4 : 3.4,
        pitch: this.prefersReducedMotion() ? -0.09 : -0.28,
        roll: this.prefersReducedMotion() ? 0 : 0.08,
        carScale: 0.24,
        carSpin: this.prefersReducedMotion() ? 0.12 : 0.58,
        boatScale: 0.58,
        boatSpin: this.prefersReducedMotion() ? -0.12 : -0.72,
        morphEnergy: 1,
        duration: 0.48,
        ease: 'power2.out',
        immediateRender: false,
      })
      .to(this.vehiclePose, {
        lift: 0.12,
        pitch: 0,
        roll: 0,
        carScale: 0.001,
        carSpin: 0.9,
        boatScale: 1,
        boatSpin: 0,
        morphEnergy: 0,
        duration: 0.52,
        ease: 'power2.in',
      });

    this.exitMorphTimeline = gsap.timeline({ paused: true });
    this.exitMorphTimeline
      .fromTo(this.vehiclePose, {
        lift: 0.12, pitch: 0, roll: 0,
        carScale: 0.001, carSpin: 0.9,
        boatScale: 1, boatSpin: 0,
        morphEnergy: 0,
      }, {
        lift: this.prefersReducedMotion() ? 1.4 : 3.25,
        pitch: this.prefersReducedMotion() ? -0.08 : -0.25,
        roll: this.prefersReducedMotion() ? 0 : -0.08,
        carScale: 0.58,
        carSpin: this.prefersReducedMotion() ? 0.12 : -0.7,
        boatScale: 0.24,
        boatSpin: this.prefersReducedMotion() ? 0.12 : 0.62,
        morphEnergy: 1,
        duration: 0.48,
        ease: 'power2.out',
        immediateRender: false,
      })
      .to(this.vehiclePose, {
        lift: 0,
        pitch: 0,
        roll: 0,
        carScale: 1,
        carSpin: 0,
        boatScale: 0.001,
        boatSpin: 0.9,
        morphEnergy: 0,
        duration: 0.52,
        ease: 'power2.in',
      });
    this.syncVehiclePose(driveSectionAtDistance(0));
  }

  applyVehiclePose(section) {
    const pose = this.vehiclePose;
    this.vehicleLiftRig.position.y = pose.lift;
    this.vehicleLiftRig.rotation.set(pose.pitch, 0, pose.roll);
    this.carVisualRig.scale.setScalar(Math.max(0.001, pose.carScale));
    this.carVisualRig.rotation.y = pose.carSpin;
    if (this.boatRig) {
      this.boatRig.scale.setScalar(Math.max(0.001, pose.boatScale));
      this.boatRig.rotation.y = pose.boatSpin;
      this.boatRig.visible = section.phase === 'canal'
        || section.phase === 'canal-entry'
        || section.phase === 'canal-exit';
    }
    this.carVisualRig.visible = section.phase !== 'canal';
    if (this.morphFxGroup) {
      const energy = THREE.MathUtils.clamp(pose.morphEnergy, 0, 1);
      this.morphFxGroup.visible = energy > 0.01;
      this.morphFxGroup.scale.setScalar(0.62 + energy * 0.5);
      this.morphFxGroup.rotation.z = energy * 0.72;
      this.morphCoreMaterial.opacity = energy * (this.prefersReducedMotion() ? 0.12 : 0.23);
      this.morphRingMaterials[0].opacity = energy * 0.74;
      this.morphRingMaterials[1].opacity = energy * 0.5;
    }
  }

  syncVehiclePose(section) {
    if (!this.vehiclePose) return;
    if (section.phase === 'canal-entry') {
      this.entryMorphTimeline.progress(section.progress, true);
    } else if (section.phase === 'canal') {
      Object.assign(this.vehiclePose, {
        lift: 0.12, pitch: 0, roll: 0,
        carScale: 0.001, carSpin: Math.PI,
        boatScale: 1, boatSpin: 0, morphEnergy: 0,
      });
    } else if (section.phase === 'canal-exit') {
      this.exitMorphTimeline.progress(section.progress, true);
    } else {
      Object.assign(this.vehiclePose, {
        lift: 0, pitch: 0, roll: 0,
        carScale: 1, carSpin: 0,
        boatScale: 0.001, boatSpin: -0.9, morphEnergy: 0,
      });
    }
    this.applyVehiclePose(section);
  }

  updateTransitionRamps(section) {
    const localDistance = section.cycleDistance;
    const entryDelta = CANAL_ENTRY_START - localDistance;
    const exitDelta = CANAL_EXIT_START - localDistance;
    this.entryRamp.position.z = CAR_Z - entryDelta;
    this.exitRamp.position.z = CAR_Z - exitDelta;
    this.entryRamp.visible = localDistance > CANAL_APPROACH_START - 110 && localDistance < CANAL_RUN_START + 28;
    this.exitRamp.visible = localDistance > CANAL_EXIT_START - 145 && localDistance < CANAL_RETURN_START + 32;
    this.transitionGroup.visible = this.entryRamp.visible || this.exitRamp.visible;
  }

  createLights() {
    this.root.add(new THREE.HemisphereLight('#242c62', '#07020d', 0.72));
    const cyanLight = new THREE.PointLight('#19dfff', 18, 22, 2);
    cyanLight.position.set(-5, 3.5, 7);
    const magentaLight = new THREE.PointLight('#ff127f', 24, 26, 2);
    magentaLight.position.set(5, 3.2, 4);
    this.root.add(cyanLight, magentaLight);
  }

  applySectionState(section, { emit = false } = {}) {
    const previousPhase = this.state.phase;
    Object.assign(this.state, {
      phase: section.phase,
      sectionLabel: section.label,
      cycleIndex: section.cycleIndex,
      cycleDistance: section.cycleDistance,
      sectionProgress: section.progress,
      vehicle: section.vehicle,
      surface: section.surface,
      airborne: section.surface === 'air',
    });

    const exitRoadVisible = section.phase === 'canal-exit' && section.progress >= 0.44;
    const roadVisible = section.phase === 'city'
      || section.phase === 'canal-approach'
      || exitRoadVisible;
    if (previousPhase === 'city' && section.phase === 'canal-approach') {
      this.canalSection.reset();
    }
    if (previousPhase === 'canal-exit' && section.phase === 'city') {
      // The hidden city pool keeps recycling during the canal. Re-seed its
      // collision lane well ahead of the car so the restored road always
      // gives the player a readable reaction window.
      this.runnerObjects.forEach((object, index) => {
        this.recycleRunnerObject(object, -42 - index * 19);
      });
    }
    this.roadEnvironment.visible = roadVisible;
    this.terrainGroup.visible = roadVisible;
    this.cityGroup.visible = roadVisible;
    this.runnerGroup.visible = section.phase === 'city';
    this.canalSection.setActive(section.phase !== 'city');
    this.updateTransitionRamps(section);
    this.syncVehiclePose(section);
    this.visualGains?.setSurface?.(section.surface);

    if (emit && previousPhase !== section.phase) {
      const eventByPhase = {
        'canal-approach': 'canal-ahead',
        'canal-entry': 'entry-takeoff',
        canal: 'boat-deployed',
        'canal-exit': 'exit-takeoff',
        city: previousPhase === 'canal-exit' ? 'car-restored' : 'city-loop',
      };
      this.onSectionChange({
        event: eventByPhase[section.phase],
        previousPhase,
        ...section,
      });
    }
  }

  reset(startDistance = 0) {
    this.randomState = 0x5f3759df;
    const safeStartDistance = Math.max(0, Number.isFinite(startDistance) ? startDistance : 0);
    const startSection = driveSectionAtDistance(safeStartDistance);
    Object.assign(this.state, {
      laneIndex: 1, targetLane: 1, lateralX: 0, distance: safeStartDistance, speed: 0,
      shards: 0, orbs: 0, score: Math.floor(safeStartDistance * 2),
      elapsed: 0, crashed: false, laneChanges: 0,
      phase: startSection.phase,
      sectionLabel: startSection.label,
      cycleIndex: startSection.cycleIndex,
      cycleDistance: startSection.cycleDistance,
      sectionProgress: startSection.progress,
      vehicle: startSection.vehicle,
      surface: startSection.surface,
      airborne: startSection.surface === 'air',
    });
    this.car.position.set(0, 0.06, CAR_Z);
    this.car.rotation.set(0, 0, 0);
    this.laneTimeline?.kill();
    this.impactTimeline?.kill();
    this.carIdleTimeline.pause(0);
    gsap.killTweensOf([
      this.carMotionRig.rotation,
      this.vehicleLiftRig.position,
      this.vehicleLiftRig.rotation,
      this.carImpactRig.position,
      this.carImpactRig.rotation,
      this.carImpactRig.scale,
    ]);
    this.carMotionRig.position.set(0, 0, 0);
    this.carMotionRig.rotation.set(0, 0, 0);
    this.vehicleLiftRig.position.set(0, 0, 0);
    this.vehicleLiftRig.rotation.set(0, 0, 0);
    this.carImpactRig.position.set(0, 0, 0);
    this.carImpactRig.rotation.set(0, 0, 0);
    this.carImpactRig.scale.setScalar(1);
    this.underglow.material.opacity = 0.26;
    this.visualGains?.reset();
    this.canalSection.reset();
    this.carIdleTimeline.restart();
    this.carIdleTimeline.paused(!this.root.visible);
    this.buildings.forEach((building, index) => this.recycleBuilding(building, -18 - index * (this.isMobile ? 10 : 7.2)));
    this.runnerObjects.forEach((object, index) => this.recycleRunnerObject(object, -34 - index * 19));
    this.bendUniforms.uDriveTravel.value = safeStartDistance;
    this.bendUniforms.uBendX.value = 0.00018;
    this.updateTerrain(true);
    this.applySectionState(startSection);
  }

  setVisible(visible) {
    this.root.visible = visible;
    this.carIdleTimeline?.paused(!visible);
    this.canalSection?.setActive(Boolean(visible && this.state.phase !== 'city'));
  }

  shiftLane(direction) {
    if (this.state.crashed) return false;
    const next = THREE.MathUtils.clamp(this.state.targetLane + Math.sign(direction), 0, 2);
    if (next === this.state.targetLane) return false;
    this.state.targetLane = next;
    this.state.laneChanges += 1;
    this.animateLaneChange(Math.sign(direction));
    return true;
  }

  animateLaneChange(direction) {
    this.laneTimeline?.kill();
    gsap.killTweensOf(this.carMotionRig.rotation);
    const tilt = this.prefersReducedMotion() ? 0 : direction;
    this.laneTimeline = gsap.timeline({ defaults: { overwrite: 'auto' } });
    this.laneTimeline.to(this.carMotionRig.rotation, {
      z: -tilt * 0.12,
      y: -tilt * 0.065,
      duration: 0.1,
      ease: 'power2.out',
    }).to(this.carMotionRig.rotation, {
      z: 0,
      y: 0,
      duration: 0.27,
      ease: 'back.out(1.8)',
    });
  }

  animateShardCollect(object) {
    const shard = object.shard;
    this.visualGains?.collect(shard.position);
    gsap.killTweensOf(shard.scale);
    gsap.timeline()
      .to(shard.scale, {
        x: this.prefersReducedMotion() ? 1 : 1.7,
        y: this.prefersReducedMotion() ? 1 : 1.7,
        z: this.prefersReducedMotion() ? 1 : 1.7,
        duration: 0.1,
        ease: 'power3.out',
      })
      .to(shard.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.16,
        ease: 'power2.in',
        onComplete: () => {
          if (object.resolved && object.kind === 'shard') shard.visible = false;
        },
      });
  }

  handleCanalCollect(event) {
    if (this.state.crashed || this.state.phase !== 'canal') return;
    this.state.orbs += 1;
    // Keep the legacy pickup total and record key compatible while exposing
    // water orbs independently in semantic state and the adaptive HUD.
    this.state.shards += 1;
    this.state.score = Math.floor(this.state.distance * 2 + this.state.shards * 125);
    const origin = new THREE.Vector3(LANE_X[event.lane], 0.65, event.z);
    this.visualGains?.collect(origin);
    this.onCollect(this.state, 'orb');
  }

  handleCanalCrash(event) {
    if (this.state.crashed || this.state.phase !== 'canal') return;
    this.state.crashed = true;
    this.state.speed = 0;
    this.animateCrash();
    this.onCrash(this.state, event.kind);
  }

  animateCrash() {
    this.laneTimeline?.kill();
    this.impactTimeline?.kill();
    this.carIdleTimeline.pause();
    this.visualGains?.crash(new THREE.Vector3(this.state.lateralX, 0.82, CAR_Z - 0.9));
    gsap.killTweensOf([this.carMotionRig.rotation, this.carImpactRig.position, this.carImpactRig.rotation, this.carImpactRig.scale]);
    const amount = this.prefersReducedMotion() ? 0.2 : 1;
    this.impactTimeline = gsap.timeline({ defaults: { overwrite: 'auto' } });
    this.impactTimeline
      .to(this.carImpactRig.position, { z: 0.45 * amount, y: -0.08 * amount, duration: 0.08, ease: 'power3.out' }, 0)
      .to(this.carImpactRig.rotation, { y: -0.2 * amount, z: 0.13 * amount, x: 0.04 * amount, duration: 0.09, ease: 'power3.out' }, 0)
      .to(this.carImpactRig.scale, { x: 1.08, y: 0.82, z: 1.05, duration: 0.09, ease: 'power3.out' }, 0)
      .to(this.carImpactRig.position, { z: 0, y: 0, duration: 0.34, ease: 'elastic.out(1, 0.42)' })
      .to(this.carImpactRig.rotation, { x: 0, y: 0, z: 0, duration: 0.38, ease: 'elastic.out(1, 0.42)' }, '<')
      .to(this.carImpactRig.scale, { x: 1, y: 1, z: 1, duration: 0.34, ease: 'elastic.out(1, 0.42)' }, '<');
  }

  start(startDistance = 0) {
    this.reset(startDistance);
    this.state.speed = 34;
  }

  update(dt, active) {
    this.bendUniforms.uDriveTime.value += dt;
    this.terrainAccumulator += dt;
    if (!active || this.state.crashed) {
      this.canalSection.update(dt, { active: false });
      this.visualGains?.update(this.state, false);
      return;
    }

    this.state.elapsed += dt;
    this.state.speed = Math.min(62, this.state.speed + dt * 0.72);
    const advance = this.state.speed * dt;
    this.state.distance += advance;
    const section = driveSectionAtDistance(this.state.distance);
    this.applySectionState(section, { emit: true });
    const roadGameplayActive = section.phase === 'city';
    const canalGameplayActive = section.phase === 'canal';
    const targetX = LANE_X[this.state.targetLane];
    this.state.lateralX = smoothDamp(this.state.lateralX, targetX, 11.5, dt);
    this.car.position.x = this.state.lateralX;
    if (Math.abs(this.state.lateralX - targetX) < 0.08) this.state.laneIndex = this.state.targetLane;

    this.bendUniforms.uDriveTravel.value = this.state.distance;
    this.bendUniforms.uBendX.value = Math.sin(this.state.distance * 0.0042) * 0.00031 + Math.sin(this.state.distance * 0.0013 + 1.4) * 0.00011;
    this.bendUniforms.uBendY.value = 0.00122 + Math.sin(this.state.distance * 0.0018) * 0.00013;

    let farthestBuildingZ = Infinity;
    for (const building of this.buildings) farthestBuildingZ = Math.min(farthestBuildingZ, building.group.position.z);
    for (const building of this.buildings) {
      building.group.position.z += advance * building.speedFactor;
      if (building.group.position.z > 24) {
        farthestBuildingZ -= 7 + this.random() * 7;
        this.recycleBuilding(building, farthestBuildingZ);
      }
    }

    let farthestObjectZ = Infinity;
    for (const object of this.runnerObjects) farthestObjectZ = Math.min(farthestObjectZ, object.z);
    for (const object of this.runnerObjects) {
      object.z += advance;
      object.barrier.position.z = object.z;
      object.shard.position.z = object.z;
      if (object.kind === 'shard') {
        const phase = this.motionPhase.shard + object.z * 0.07;
        object.shard.rotation.y = phase;
        object.shard.rotation.x = phase * 0.37;
        object.shard.position.y = 1.05 + Math.sin(phase * 1.3) * (this.prefersReducedMotion() ? 0 : 0.12);
      }
      if (!object.resolved && roadGameplayActive) {
        const longitudinalDistance = Math.abs(object.z - CAR_Z);
        const lateralDistance = Math.abs(this.state.lateralX - LANE_X[object.lane]);
        if (object.kind === 'shard' && longitudinalDistance < 1.8 && lateralDistance < 1.85) {
          object.resolved = true;
          this.state.shards += 1;
          this.animateShardCollect(object);
          this.onCollect(this.state, 'shard');
        } else if (object.kind === 'barrier' && longitudinalDistance < 2.9 && lateralDistance < 2.66) {
          object.resolved = true;
          this.state.crashed = true;
          this.state.speed = 0;
          this.animateCrash();
          this.onCrash(this.state);
        } else if (object.z > CAR_Z + 3.1) {
          object.resolved = true;
        }
      }
      if (object.z > 18) {
        farthestObjectZ -= 16 + this.random() * 9;
        this.recycleRunnerObject(object, farthestObjectZ);
      }
    }

    this.canalSection.update(dt, {
      advance,
      lateralX: this.state.lateralX,
      speed: this.state.speed,
      active: section.phase !== 'city',
      collisionsEnabled: canalGameplayActive,
    });
    this.state.score = Math.floor(this.state.distance * 2 + this.state.shards * 125);
    if (this.terrainGroup.visible) this.updateTerrain();
    this.visualGains?.update(this.state, !this.state.crashed);
  }

  getCameraPose(target, position) {
    const portrait = this.viewportAspect < 0.78;
    const targetFollow = this.isMobile ? 0.88 : 0.38;
    const cameraFollow = this.isMobile ? 0.98 : 0.82;
    target.set(DRIVE_ORIGIN_X + this.state.lateralX * targetFollow, portrait ? 1.65 : 1.3, portrait ? -10.7 : -9.5);
    position.set(DRIVE_ORIGIN_X + this.state.lateralX * cameraFollow, portrait ? 7.25 : 6.4, portrait ? 20.8 : 18.2);
    return { target, position };
  }

  setViewport(width, height) {
    this.viewportAspect = Math.max(1, width) / Math.max(1, height);
  }

  getCarWorldPosition(target = this.worldCarPosition) {
    return target.set(
      DRIVE_ORIGIN_X + this.state.lateralX,
      this.car.position.y + this.vehicleLiftRig.position.y,
      CAR_Z,
    );
  }

  nearbyObjects() {
    if (this.state.phase === 'canal') {
      return this.canalSection.nearbyObjects().map((object) => ({ ...object, surface: 'water' }));
    }
    return this.runnerObjects
      .filter((object) => object.z > -70 && object.z < 16)
      .sort((a, b) => b.z - a.z)
      .slice(0, 6)
      .map((object) => ({
        kind: object.kind,
        lane: object.lane,
        z: +object.z.toFixed(1),
        resolved: object.resolved,
        surface: 'road',
      }));
  }

  snapshot() {
    return {
      laneIndex: this.state.laneIndex,
      targetLane: this.state.targetLane,
      laneX: +this.state.lateralX.toFixed(2),
      laneCenters: LANE_X,
      speed: +this.state.speed.toFixed(2),
      distance: +this.state.distance.toFixed(1),
      score: this.state.score,
      shards: this.state.shards,
      orbs: this.state.orbs,
      pickups: this.state.shards,
      crashed: this.state.crashed,
      laneChanges: this.state.laneChanges,
      phase: this.state.phase,
      sectionLabel: this.state.sectionLabel,
      sectionProgress: +this.state.sectionProgress.toFixed(3),
      cycleIndex: this.state.cycleIndex,
      cycleDistance: +this.state.cycleDistance.toFixed(1),
      cycleLength: DRIVE_CYCLE_LENGTH,
      vehicle: this.state.vehicle,
      surface: this.state.surface,
      airborne: this.state.airborne,
      transitionMarkers: {
        canalApproach: CANAL_APPROACH_START,
        entryRamp: CANAL_ENTRY_START,
        canalRun: CANAL_RUN_START,
        exitRamp: CANAL_EXIT_START,
        roadReturn: CANAL_RETURN_START,
      },
      bendX: +this.bendUniforms.uBendX.value.toFixed(6),
      bendY: +this.bendUniforms.uBendY.value.toFixed(6),
      terrain: 'camera-centered ImprovedNoise FBM mesh resampled during travel',
      visualGains: this.visualGains?.snapshot(),
      canal: this.canalSection.snapshot(),
      nearbyObjects: this.nearbyObjects(),
    };
  }
}
