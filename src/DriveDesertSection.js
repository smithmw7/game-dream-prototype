import * as THREE from 'three';
import { gsap } from 'gsap';

const DESERT_NEAR_Z = 30;
const DESERT_FAR_Z = -350;
const DESERT_LENGTH = DESERT_NEAR_Z - DESERT_FAR_Z;
const DESERT_CENTER_Z = (DESERT_NEAR_Z + DESERT_FAR_Z) * 0.5;
const RECYCLE_Z = 36;
const ARCH_RADIUS = 8.4;
const ARCH_TUBE = 1.35;
const ARCH_PILLAR_SCALE = 1.14;
const ARCH_OPENING_WIDTH = (ARCH_RADIUS - ARCH_TUBE * ARCH_PILLAR_SCALE) * 2;
const SEED = 0xd35e47a1;

function prepareMesh(mesh, castShadow = false, receiveShadow = true) {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  // Drive's world-bend shader moves distant geometry after Three.js performs
  // its normal bounds test. Pooled landmarks therefore opt out of culling.
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Pooled synthwave desert scenery for Drive Mode.
 *
 * The caller owns section timing and the road surface. This class supplies a
 * bend-ready environment that can be independently activated, reset, scrolled,
 * recycled, snapshotted, and disposed.
 */
export class DriveDesertSection {
  constructor(parent, {
    isMobile = false,
    patchMaterial = (material) => material,
    prefersReducedMotion = () => false,
  } = {}) {
    this.parent = parent;
    this.isMobile = isMobile;
    this.patchMaterial = patchMaterial;
    this.prefersReducedMotion = prefersReducedMotion;
    this.randomState = SEED;
    this.elapsed = 0;
    this.distance = 0;
    this.active = false;
    this.simulationActive = false;
    this.recycled = 0;
    this.motionPhase = { wind: 0 };
    this.windTween = gsap.to(this.motionPhase, {
      wind: Math.PI * 2,
      duration: 3.8,
      ease: 'none',
      repeat: -1,
      paused: true,
    });

    this.environment = new THREE.Group();
    this.environment.name = 'Drive desert · synthwave monument valley';
    this.environment.visible = false;
    this.environment.userData.style = 'procedural synthwave desert';
    parent.add(this.environment);

    this.createSharedResources();
    this.createDesertFloor();
    this.createDistantMesas();
    this.createRockSpires();
    this.createRockArches();
    this.createCacti();
    this.createShrubs();
    this.createTumbleweeds();
    this.createRoadSigns();
    this.reset();
    this.setActive(false);
  }

  random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  material(material, key, style = 'plain') {
    return this.patchMaterial(material, `desert-${key}`, style);
  }

  createSharedResources() {
    this.sandMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#5a1d34',
      roughness: 0.92,
      metalness: 0.02,
      emissive: '#351029',
      emissiveIntensity: 0.55,
      flatShading: true,
    }), 'rose-sand');
    this.sandHighlightMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#b84a5c',
      roughness: 0.88,
      metalness: 0.02,
      emissive: '#6e153f',
      emissiveIntensity: 0.5,
      flatShading: true,
    }), 'sunlit-sand');
    this.rockMaterials = [
      this.material(new THREE.MeshStandardMaterial({
        color: '#42133c',
        roughness: 0.88,
        metalness: 0.04,
        emissive: '#260829',
        emissiveIntensity: 0.5,
        flatShading: true,
      }), 'rock-shadow'),
      this.material(new THREE.MeshStandardMaterial({
        color: '#8b294b',
        roughness: 0.84,
        metalness: 0.025,
        emissive: '#4b0b35',
        emissiveIntensity: 0.48,
        flatShading: true,
      }), 'rock-mid'),
      this.material(new THREE.MeshStandardMaterial({
        color: '#d95b67',
        roughness: 0.8,
        metalness: 0.02,
        emissive: '#75153d',
        emissiveIntensity: 0.43,
        flatShading: true,
      }), 'rock-sun'),
    ];
    this.distantRockMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#2b1241',
      roughness: 0.96,
      metalness: 0,
      emissive: '#240c43',
      emissiveIntensity: 0.62,
      flatShading: true,
    }), 'distant-purple-mesa');
    this.cactusMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#143d3b',
      roughness: 0.76,
      metalness: 0.08,
      emissive: '#03534f',
      emissiveIntensity: 0.78,
      flatShading: true,
    }), 'cactus-teal');
    this.cactusRidgeMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#32d8be',
      transparent: true,
      opacity: 0.38,
      toneMapped: false,
    }), 'cactus-ridge');
    this.shrubMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#44304a',
      roughness: 0.92,
      emissive: '#57183d',
      emissiveIntensity: 0.52,
      flatShading: true,
    }), 'dry-shrub');
    this.tumbleweedMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ff9a72',
      wireframe: true,
      transparent: true,
      opacity: 0.74,
      toneMapped: false,
    }), 'tumbleweed-wire');
    this.signMaterial = this.material(new THREE.MeshPhysicalMaterial({
      color: '#16152b',
      roughness: 0.26,
      metalness: 0.7,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      emissive: '#140b31',
      emissiveIntensity: 0.65,
    }), 'deco-sign-metal');
    this.cyanMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#27f6ee',
      toneMapped: false,
    }), 'cyan-neon');
    this.magentaMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ff3d9d',
      toneMapped: false,
    }), 'magenta-neon');
    this.warmMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ffb15f',
      toneMapped: false,
    }), 'sunset-neon');

    this.mesaTierGeometry = new THREE.CylinderGeometry(0.72, 1, 1, 8, 1, false);
    this.spireLayerGeometry = new THREE.CylinderGeometry(0.62, 1, 1, 7, 1, false);
    this.rockCapGeometry = new THREE.DodecahedronGeometry(1, 0);
    this.cactusTrunkGeometry = new THREE.CylinderGeometry(0.7, 0.82, 1, 8, 1);
    this.cactusRidgeGeometry = new THREE.CylinderGeometry(0.75, 0.88, 1.01, 8, 1, true);
    this.shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
    this.tumbleweedGeometry = new THREE.IcosahedronGeometry(1, 1);
  }

  createDesertFloor() {
    const groundGeometry = new THREE.PlaneGeometry(
      156,
      DESERT_LENGTH,
      this.isMobile ? 8 : 14,
      this.isMobile ? 40 : 72,
    );
    this.ground = prepareMesh(new THREE.Mesh(groundGeometry, this.sandMaterial), false, true);
    this.ground.name = 'Continuous rose-sand desert floor';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.42, DESERT_CENTER_Z);
    this.environment.add(this.ground);

    this.sandShoulders = [];
    const shoulderGeometry = new THREE.PlaneGeometry(
      17,
      DESERT_LENGTH,
      2,
      this.isMobile ? 40 : 72,
    );
    for (const side of [-1, 1]) {
      const shoulder = prepareMesh(
        new THREE.Mesh(shoulderGeometry, this.sandHighlightMaterial),
        false,
        true,
      );
      shoulder.name = `${side < 0 ? 'Left' : 'Right'} sunlit sand shoulder`;
      shoulder.rotation.x = -Math.PI / 2;
      shoulder.position.set(side * 14.8, -0.38, DESERT_CENTER_Z);
      this.sandShoulders.push(shoulder);
      this.environment.add(shoulder);
    }
  }

  createMesa(index) {
    const group = new THREE.Group();
    group.name = `Pooled distant mesa ${index + 1}`;
    const tiers = [];
    for (let tierIndex = 0; tierIndex < 4; tierIndex++) {
      const tier = prepareMesh(new THREE.Mesh(
        this.mesaTierGeometry,
        tierIndex < 2 ? this.distantRockMaterial : this.rockMaterials[tierIndex % 2],
      ), false, true);
      tier.rotation.y = index * 0.47 + tierIndex * 0.31;
      tiers.push(tier);
      group.add(tier);
    }
    const cap = prepareMesh(
      new THREE.Mesh(this.rockCapGeometry, this.distantRockMaterial),
      false,
      true,
    );
    group.add(cap);
    return {
      group,
      tiers,
      cap,
      side: index % 2 ? 1 : -1,
      speedFactor: 0.34,
    };
  }

  createDistantMesas() {
    this.mesas = [];
    const count = this.isMobile ? 10 : 16;
    for (let index = 0; index < count; index++) {
      const mesa = this.createMesa(index);
      this.mesas.push(mesa);
      this.environment.add(mesa.group);
    }
  }

  recycleMesa(mesa, z, countRecycle = true) {
    const width = 11 + this.random() * 14;
    const depth = 6 + this.random() * 9;
    const height = 7 + this.random() * 12;
    const setback = 31 + this.random() * 35;
    mesa.group.position.set(mesa.side * setback, -0.24, z);
    mesa.group.rotation.y = (this.random() - 0.5) * 0.3;
    mesa.tiers.forEach((tier, tierIndex) => {
      const fraction = tierIndex / mesa.tiers.length;
      const tierHeight = height * (0.28 - fraction * 0.025);
      tier.scale.set(
        width * (1 - fraction * 0.18),
        tierHeight,
        depth * (1 - fraction * 0.12),
      );
      tier.position.y = height * (0.13 + fraction * 0.23);
      tier.position.x = Math.sin(tierIndex * 2.3 + width) * width * 0.045;
    });
    mesa.cap.scale.set(width * 0.46, height * 0.13, depth * 0.46);
    mesa.cap.position.set(0, height * 1.03, 0);
    mesa.speedFactor = 0.28 + this.random() * 0.14;
    if (countRecycle) this.recycled += 1;
  }

  createSpire(index) {
    const group = new THREE.Group();
    group.name = `Pooled layered desert rock spire ${index + 1}`;
    const layers = [];
    for (let layerIndex = 0; layerIndex < 5; layerIndex++) {
      const layer = prepareMesh(new THREE.Mesh(
        this.spireLayerGeometry,
        this.rockMaterials[(index + layerIndex) % this.rockMaterials.length],
      ), true, true);
      layers.push(layer);
      group.add(layer);
    }
    const cap = prepareMesh(new THREE.Mesh(
      this.rockCapGeometry,
      this.rockMaterials[(index + 2) % this.rockMaterials.length],
    ), true, true);
    group.add(cap);
    return {
      group,
      layers,
      cap,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
    };
  }

  createRockSpires() {
    this.spires = [];
    const count = this.isMobile ? 12 : 20;
    for (let index = 0; index < count; index++) {
      const spire = this.createSpire(index);
      this.spires.push(spire);
      this.environment.add(spire.group);
    }
  }

  recycleSpire(spire, z, countRecycle = true) {
    const height = 9 + Math.pow(this.random(), 0.58) * 18;
    const width = 2.2 + this.random() * 3.8;
    const depth = 1.8 + this.random() * 3.2;
    const setback = 12.5 + this.random() * 15;
    spire.group.position.set(spire.side * setback, -0.3, z);
    spire.group.rotation.y = (this.random() - 0.5) * 0.54;
    spire.layers.forEach((layer, layerIndex) => {
      const fraction = layerIndex / spire.layers.length;
      const layerHeight = height / spire.layers.length * 1.14;
      layer.scale.set(
        width * (1 - fraction * 0.14),
        layerHeight,
        depth * (1 - fraction * 0.11),
      );
      layer.position.set(
        Math.sin(layerIndex * 1.83 + height) * width * 0.085,
        (layerIndex + 0.5) * height / spire.layers.length,
        Math.cos(layerIndex * 2.17 + depth) * depth * 0.07,
      );
      layer.rotation.y = layerIndex * 0.41;
    });
    spire.cap.scale.set(width * 0.54, height * 0.075, depth * 0.54);
    spire.cap.position.set(0, height * 1.015, 0);
    spire.speedFactor = 0.88 + this.random() * 0.11;
    if (countRecycle) this.recycled += 1;
  }

  createArch(index) {
    const group = new THREE.Group();
    group.name = `Reusable drive-through rock arch ${index + 1}`;
    group.userData.openingWidth = ARCH_OPENING_WIDTH;
    const archMaterial = this.rockMaterials[(index + 1) % this.rockMaterials.length];
    const crown = prepareMesh(new THREE.Mesh(
      new THREE.TorusGeometry(
        ARCH_RADIUS,
        ARCH_TUBE,
        this.isMobile ? 5 : 7,
        this.isMobile ? 16 : 22,
        Math.PI,
      ),
      archMaterial,
    ), true, true);
    crown.name = 'Natural arch crown over a road-wide central opening';
    crown.position.y = 4.35;
    crown.rotation.z = index % 2 ? 0.025 : -0.025;
    group.add(crown);

    const pillars = [];
    for (const side of [-1, 1]) {
      for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
        const pillar = prepareMesh(new THREE.Mesh(
          this.spireLayerGeometry,
          this.rockMaterials[(index + layerIndex + (side > 0 ? 1 : 0)) % 3],
        ), true, true);
        const layerHeight = 1.72;
        pillar.position.set(
          side * (ARCH_RADIUS + Math.sin(layerIndex * 1.7) * 0.16),
          layerHeight * (layerIndex + 0.5),
          Math.cos(layerIndex * 2.2) * 0.14,
        );
        pillar.scale.set(
          ARCH_TUBE * (ARCH_PILLAR_SCALE - layerIndex * 0.08),
          layerHeight * 1.1,
          ARCH_TUBE * (1.45 - layerIndex * 0.1),
        );
        pillar.rotation.y = side * layerIndex * 0.16;
        pillars.push(pillar);
        group.add(pillar);
      }
    }

    const fragments = [];
    for (let fragmentIndex = 0; fragmentIndex < 4; fragmentIndex++) {
      const fragment = prepareMesh(new THREE.Mesh(
        this.rockCapGeometry,
        this.rockMaterials[(index + fragmentIndex) % 3],
      ), true, true);
      const angle = 0.45 + fragmentIndex * 0.75;
      fragment.position.set(
        Math.cos(angle) * ARCH_RADIUS,
        4.35 + Math.sin(angle) * ARCH_RADIUS,
        Math.sin(fragmentIndex * 2.1) * 0.38,
      );
      fragment.scale.set(1.75, 1.05, 1.55);
      fragment.rotation.set(fragmentIndex * 0.17, fragmentIndex * 0.52, 0);
      fragments.push(fragment);
      group.add(fragment);
    }

    return {
      group,
      crown,
      pillars,
      fragments,
      speedFactor: 1,
    };
  }

  createRockArches() {
    this.arches = [];
    const count = this.isMobile ? 2 : 3;
    for (let index = 0; index < count; index++) {
      const arch = this.createArch(index);
      this.arches.push(arch);
      this.environment.add(arch.group);
    }
  }

  recycleArch(arch, z, countRecycle = true) {
    // Never scale the opening below ARCH_OPENING_WIDTH: the full 12-unit road
    // remains comfortably clear through every recycled variation.
    const widthScale = 1 + this.random() * 0.1;
    arch.group.position.set(0, -0.22, z);
    arch.group.scale.set(widthScale, 0.96 + this.random() * 0.1, 0.82 + this.random() * 0.2);
    arch.group.rotation.y = (this.random() - 0.5) * 0.014;
    arch.group.userData.effectiveOpeningWidth = ARCH_OPENING_WIDTH * widthScale;
    arch.speedFactor = 0.995 + this.random() * 0.01;
    if (countRecycle) this.recycled += 1;
  }

  createCactus(index) {
    const group = new THREE.Group();
    group.name = `Pooled saguaro cactus ${index + 1}`;
    const pieces = [];
    const addPiece = (height, radiusScale, x, y, rotationZ = 0) => {
      const body = prepareMesh(new THREE.Mesh(this.cactusTrunkGeometry, this.cactusMaterial), true, true);
      body.scale.set(radiusScale, height, radiusScale);
      body.position.set(x, y, 0);
      body.rotation.z = rotationZ;
      const ridge = prepareMesh(
        new THREE.Mesh(this.cactusRidgeGeometry, this.cactusRidgeMaterial),
        false,
        false,
      );
      ridge.scale.copy(body.scale);
      ridge.position.copy(body.position);
      ridge.rotation.copy(body.rotation);
      pieces.push(body, ridge);
      group.add(body, ridge);
    };

    addPiece(5, 0.48, 0, 2.5);
    addPiece(1.55, 0.31, -0.83, 2.25, -Math.PI / 2);
    addPiece(2.25, 0.32, -1.53, 3.05);
    addPiece(1.25, 0.27, 0.75, 3.02, Math.PI / 2);
    addPiece(1.75, 0.28, 1.31, 3.72);
    return {
      group,
      pieces,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
    };
  }

  createCacti() {
    this.cacti = [];
    const count = this.isMobile ? 10 : 18;
    for (let index = 0; index < count; index++) {
      const cactus = this.createCactus(index);
      this.cacti.push(cactus);
      this.environment.add(cactus.group);
    }
  }

  recycleCactus(cactus, z, countRecycle = true) {
    const scale = 0.64 + this.random() * 0.72;
    cactus.group.position.set(cactus.side * (8.8 + this.random() * 8.4), -0.34, z);
    cactus.group.scale.setScalar(scale);
    cactus.group.rotation.y = (this.random() - 0.5) * 0.45;
    cactus.speedFactor = 0.92 + this.random() * 0.08;
    if (countRecycle) this.recycled += 1;
  }

  createShrub(index) {
    const group = new THREE.Group();
    group.name = `Pooled low desert shrub ${index + 1}`;
    const clumps = [];
    const clumpCount = this.isMobile ? 2 : 3;
    for (let clumpIndex = 0; clumpIndex < clumpCount; clumpIndex++) {
      const clump = prepareMesh(
        new THREE.Mesh(this.shrubGeometry, this.shrubMaterial),
        false,
        true,
      );
      clump.position.set(
        (clumpIndex - (clumpCount - 1) * 0.5) * 0.65,
        0.42 + clumpIndex * 0.05,
        (clumpIndex % 2) * 0.38,
      );
      clump.scale.set(0.82, 0.48, 0.65);
      clump.rotation.y = clumpIndex * 0.92;
      clumps.push(clump);
      group.add(clump);
    }
    return {
      group,
      clumps,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
    };
  }

  createShrubs() {
    this.shrubs = [];
    const count = this.isMobile ? 16 : 28;
    for (let index = 0; index < count; index++) {
      const shrub = this.createShrub(index);
      this.shrubs.push(shrub);
      this.environment.add(shrub.group);
    }
  }

  recycleShrub(shrub, z, countRecycle = true) {
    const scale = 0.58 + this.random() * 0.76;
    shrub.group.position.set(shrub.side * (8.2 + this.random() * 18), -0.25, z);
    shrub.group.scale.setScalar(scale);
    shrub.group.rotation.y = this.random() * Math.PI * 2;
    shrub.speedFactor = 0.9 + this.random() * 0.1;
    if (countRecycle) this.recycled += 1;
  }

  createTumbleweed(index) {
    const group = new THREE.Group();
    group.name = `Pooled rolling tumbleweed ${index + 1}`;
    const shell = prepareMesh(
      new THREE.Mesh(this.tumbleweedGeometry, this.tumbleweedMaterial),
      false,
      false,
    );
    const cross = prepareMesh(
      new THREE.Mesh(this.tumbleweedGeometry, this.tumbleweedMaterial),
      false,
      false,
    );
    cross.scale.setScalar(0.72);
    cross.rotation.set(0.54, 0.8, 0.34);
    group.add(shell, cross);
    return {
      group,
      shell,
      cross,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
      phaseOffset: index * 1.71,
    };
  }

  createTumbleweeds() {
    this.tumbleweeds = [];
    const count = this.isMobile ? 5 : 9;
    for (let index = 0; index < count; index++) {
      const tumbleweed = this.createTumbleweed(index);
      this.tumbleweeds.push(tumbleweed);
      this.environment.add(tumbleweed.group);
    }
  }

  recycleTumbleweed(tumbleweed, z, countRecycle = true) {
    const scale = 0.44 + this.random() * 0.55;
    tumbleweed.group.position.set(tumbleweed.side * (7.7 + this.random() * 11), scale, z);
    tumbleweed.group.scale.setScalar(scale);
    tumbleweed.phaseOffset = this.random() * Math.PI * 2;
    tumbleweed.speedFactor = 0.96 + this.random() * 0.06;
    if (countRecycle) this.recycled += 1;
  }

  createRoadSign(index) {
    const group = new THREE.Group();
    group.name = `Pooled desert deco road sign ${index + 1}`;
    const frame = prepareMesh(new THREE.Mesh(
      new THREE.BoxGeometry(3.7, 2.05, 0.18),
      this.signMaterial,
    ), true, true);
    frame.position.y = 4.25;
    const face = prepareMesh(new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.72, 0.195),
      index % 2 ? this.magentaMaterial : this.cyanMaterial,
    ), false, false);
    face.position.set(0, 4.25, 0.02);
    face.scale.set(1, 1, 0.25);
    const inset = prepareMesh(new THREE.Mesh(
      new THREE.BoxGeometry(3.02, 1.38, 0.205),
      this.signMaterial,
    ), false, false);
    inset.position.set(0, 4.25, 0.05);

    const postGeometry = new THREE.CylinderGeometry(0.11, 0.16, 3.5, 7);
    const posts = [-1, 1].map((side) => {
      const post = prepareMesh(new THREE.Mesh(postGeometry, this.signMaterial), true, true);
      post.position.set(side * 1.25, 1.75, 0);
      group.add(post);
      return post;
    });
    const chevrons = [];
    for (let chevronIndex = 0; chevronIndex < 3; chevronIndex++) {
      const slashA = prepareMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.82, 0.22),
        chevronIndex % 2 ? this.magentaMaterial : this.warmMaterial,
      ), false, false);
      const slashB = slashA.clone();
      slashB.material = slashA.material;
      prepareMesh(slashB, false, false);
      slashA.position.set(-0.75 + chevronIndex * 0.75, 4.47, 0.18);
      slashB.position.set(-0.75 + chevronIndex * 0.75, 4.03, 0.18);
      slashA.rotation.z = -0.64;
      slashB.rotation.z = 0.64;
      group.add(slashA, slashB);
      chevrons.push(slashA, slashB);
    }
    group.add(frame, face, inset);
    return {
      group,
      posts,
      chevrons,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
    };
  }

  createRoadSigns() {
    this.signs = [];
    const count = this.isMobile ? 4 : 7;
    for (let index = 0; index < count; index++) {
      const sign = this.createRoadSign(index);
      this.signs.push(sign);
      this.environment.add(sign.group);
    }
  }

  recycleSign(sign, z, countRecycle = true) {
    const scale = 0.76 + this.random() * 0.26;
    sign.group.position.set(sign.side * (9.1 + this.random() * 3.8), -0.34, z);
    sign.group.scale.setScalar(scale);
    sign.group.rotation.y = sign.side * (-0.07 - this.random() * 0.08);
    sign.speedFactor = 0.97 + this.random() * 0.03;
    if (countRecycle) this.recycled += 1;
  }

  setActive(active) {
    this.active = Boolean(active);
    this.environment.visible = this.active;
    this.simulationActive = this.active;
    if (this.active) this.windTween?.resume();
    else this.windTween?.pause();
  }

  reset() {
    this.randomState = SEED;
    this.elapsed = 0;
    this.distance = 0;
    this.recycled = 0;
    this.motionPhase.wind = 0;

    this.mesas.forEach((mesa, index) => {
      this.recycleMesa(mesa, -30 - index * (this.isMobile ? 34 : 23), false);
    });
    this.spires.forEach((spire, index) => {
      this.recycleSpire(spire, -18 - index * (this.isMobile ? 27 : 17), false);
    });
    this.arches.forEach((arch, index) => {
      this.recycleArch(arch, -92 - index * (this.isMobile ? 142 : 112), false);
    });
    this.cacti.forEach((cactus, index) => {
      this.recycleCactus(cactus, -14 - index * (this.isMobile ? 31 : 19), false);
    });
    this.shrubs.forEach((shrub, index) => {
      this.recycleShrub(shrub, -10 - index * (this.isMobile ? 22 : 13), false);
    });
    this.tumbleweeds.forEach((tumbleweed, index) => {
      this.recycleTumbleweed(tumbleweed, -38 - index * (this.isMobile ? 58 : 35), false);
    });
    this.signs.forEach((sign, index) => {
      this.recycleSign(sign, -62 - index * (this.isMobile ? 82 : 51), false);
    });

    this.windTween?.restart();
    this.windTween?.paused(!this.active);
  }

  recyclePool(pool, advance, spacing, recycler) {
    if (!pool.length || advance <= 0) return;
    let farthestZ = Infinity;
    for (const item of pool) farthestZ = Math.min(farthestZ, item.group.position.z);
    for (const item of pool) {
      item.group.position.z += advance * item.speedFactor;
      if (item.group.position.z > RECYCLE_Z) {
        farthestZ -= spacing[0] + this.random() * (spacing[1] - spacing[0]);
        recycler.call(this, item, farthestZ);
      }
    }
  }

  update(dt, {
    advance = 0,
    active = true,
  } = {}) {
    if (!this.active) return;
    const safeDt = THREE.MathUtils.clamp(dt, 0, 0.1);
    this.elapsed += safeDt;
    this.simulationActive = Boolean(active);
    this.windTween?.paused(!this.simulationActive);
    if (!this.simulationActive) return;

    const safeAdvance = Math.max(0, advance);
    this.distance += safeAdvance;
    this.recyclePool(this.mesas, safeAdvance, [20, 34], this.recycleMesa);
    this.recyclePool(this.spires, safeAdvance, [14, 24], this.recycleSpire);
    this.recyclePool(this.arches, safeAdvance, [92, 132], this.recycleArch);
    this.recyclePool(this.cacti, safeAdvance, [17, 28], this.recycleCactus);
    this.recyclePool(this.shrubs, safeAdvance, [10, 18], this.recycleShrub);
    this.recyclePool(this.tumbleweeds, safeAdvance, [29, 48], this.recycleTumbleweed);
    this.recyclePool(this.signs, safeAdvance, [45, 72], this.recycleSign);

    const reducedMotion = this.prefersReducedMotion();
    for (const tumbleweed of this.tumbleweeds) {
      const phase = this.motionPhase.wind + tumbleweed.phaseOffset;
      tumbleweed.group.rotation.x = reducedMotion ? 0 : phase * 1.7;
      tumbleweed.group.rotation.z = reducedMotion ? 0 : phase * 0.52;
      tumbleweed.group.position.y = tumbleweed.group.scale.y
        + (reducedMotion ? 0 : Math.abs(Math.sin(phase * 1.4)) * 0.15);
    }
  }

  nearbyLandmarks() {
    return [
      ...this.arches.map((item) => ({ kind: 'rock-arch', z: item.group.position.z })),
      ...this.spires.map((item) => ({ kind: 'rock-spire', z: item.group.position.z })),
      ...this.signs.map((item) => ({ kind: 'deco-sign', z: item.group.position.z })),
    ]
      .filter((item) => item.z > -95 && item.z < 24)
      .sort((a, b) => b.z - a.z)
      .slice(0, 6)
      .map((item) => ({
        kind: item.kind,
        z: +item.z.toFixed(1),
      }));
  }

  snapshot() {
    return {
      active: this.active,
      simulationActive: this.simulationActive,
      style: 'synthwave desert with rose sand, purple mesas, teal cacti, and neon deco',
      scenery: {
        distantMesas: this.mesas.length,
        layeredRockSpires: this.spires.length,
        driveThroughRockArches: this.arches.length,
        saguaroCacti: this.cacti.length,
        lowShrubs: this.shrubs.length,
        tumbleweeds: this.tumbleweeds.length,
        decoRoadSigns: this.signs.length,
      },
      arch: {
        roadWidth: 12,
        minimumOpeningWidth: +ARCH_OPENING_WIDTH.toFixed(1),
        clearance: +(ARCH_OPENING_WIDTH - 12).toFixed(1),
      },
      poolProfile: this.isMobile ? 'mobile-reduced' : 'desktop-full',
      traveled: +this.distance.toFixed(1),
      recycled: this.recycled,
      nearbyLandmarks: this.nearbyLandmarks(),
    };
  }

  dispose() {
    this.windTween?.kill();
    this.environment.removeFromParent();
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.environment.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) geometries.add(child.geometry);
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.filter(Boolean).forEach((material) => {
        materials.add(material);
        if (material.map) textures.add(material.map);
        if (material.normalMap) textures.add(material.normalMap);
      });
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture?.dispose?.());
  }
}
