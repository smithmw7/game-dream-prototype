import * as THREE from 'three';
import { gsap } from 'gsap';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Water } from 'three/addons/objects/Water.js';

const CAR_Z = 4;
const LANE_X = [-3.25, 0, 3.25];
const CANAL_NEAR_Z = 22;
const CANAL_FAR_Z = -312;
const CANAL_CENTER_Z = (CANAL_NEAR_Z + CANAL_FAR_Z) * 0.5;
const CANAL_LENGTH = CANAL_NEAR_Z - CANAL_FAR_Z;
const WATER_WIDTH = 13.25;
const RECYCLE_Z = 28;

function setMaterialShadow(mesh, cast = false, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  return mesh;
}

function createWaveNormalTexture(size) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const dx = (
        Math.cos(a * 3 + b * 1.3) * 0.72
        + Math.cos(a * 7 - b * 2.2) * 0.25
        + Math.sin(a * 13 + b * 5.1) * 0.08
      );
      const dz = (
        Math.sin(b * 4 - a * 1.5) * 0.68
        + Math.sin(b * 9 + a * 2.4) * 0.24
        + Math.cos(b * 15 - a * 3.7) * 0.08
      );
      const normal = new THREE.Vector3(-dx, 2.7, -dz).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Procedural layered canal wave normals';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createWindowTexture(primary, secondary) {
  const width = 48;
  const height = 112;
  const data = new Uint8Array(width * height * 4);
  const colorA = new THREE.Color(primary);
  const colorB = new THREE.Color(secondary);
  const dark = new THREE.Color('#020713');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const column = Math.floor(x / 8);
      const row = Math.floor(y / 8);
      const frame = x % 8 < 2 || y % 8 < 2;
      const lit = ((column * 13 + row * 7 + column * row) % 9) > 2;
      const glow = (column + row) % 3 === 0 ? colorB : colorA;
      const color = frame || !lit ? dark : glow;
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(color.r * 255);
      data[offset + 1] = Math.round(color.g * 255);
      data[offset + 2] = Math.round(color.b * 255);
      data[offset + 3] = frame ? 232 : (lit ? 255 : 220);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = `Art Deco window grid ${primary}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createBillboardTexture(label, primary, secondary) {
  if (typeof document === 'undefined') {
    const color = new THREE.Color(primary);
    const bytes = new Uint8Array([
      Math.round(color.r * 255),
      Math.round(color.g * 255),
      Math.round(color.b * 255),
      255,
    ]);
    const texture = new THREE.DataTexture(bytes, 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#050318');
  gradient.addColorStop(0.44, primary);
  gradient.addColorStop(1, secondary);
  context.fillStyle = '#02020d';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = primary;
  context.lineWidth = 8;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.shadowBlur = 28;
  context.shadowColor = secondary;
  context.fillStyle = gradient;
  context.font = '900 74px Arial Black, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `Canal billboard ${label}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

/**
 * Pooled canal environment and gameplay layer for DriveMode.
 *
 * The caller owns section timing and the car-to-boat morph. `boatRig` is
 * deliberately created without a parent so DriveMode can attach it beside its
 * car visual rig and animate both with one GSAP transition.
 */
export class DriveCanalSection {
  constructor(parent, {
    isMobile = false,
    patchMaterial = (material) => material,
    onCollect = () => {},
    onCrash = () => {},
    prefersReducedMotion = () => false,
    random = null,
  } = {}) {
    this.parent = parent;
    this.isMobile = isMobile;
    this.patchMaterial = patchMaterial;
    this.onCollect = onCollect;
    this.onCrash = onCrash;
    this.prefersReducedMotion = prefersReducedMotion;
    this.randomSource = random;
    this.randomState = 0xc0ffee12;
    this.elapsed = 0;
    this.distance = 0;
    this.active = false;
    this.motionPhase = { water: 0 };
    this.waterPhaseTween = gsap.to(this.motionPhase, {
      water: Math.PI * 2,
      duration: 2.4,
      ease: 'none',
      repeat: -1,
      paused: true,
    });
    this.stats = {
      orbsCollected: 0,
      obstaclesHit: 0,
      recycledScenery: 0,
      recycledObjects: 0,
    };

    this.environment = new THREE.Group();
    this.environment.name = 'Drive canal · reflective Miami night run';
    this.environment.visible = false;
    parent.add(this.environment);

    this.createSharedMaterials();
    this.createWater();
    this.createCanalBanks();
    this.createArtDecoScenery();
    this.createPalmsAndBushes();
    this.createRunnerObjects();
    this.createBoatRig();
    this.reset();
    this.setActive(false);
  }

  random() {
    if (this.randomSource) return this.randomSource();
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  material(material, key, style = 'plain') {
    return this.patchMaterial(material, `canal-${key}`, style);
  }

  createSharedMaterials() {
    this.concreteMaterial = this.material(new THREE.MeshPhysicalMaterial({
      color: '#080d19',
      roughness: 0.58,
      metalness: 0.24,
      clearcoat: 0.42,
      clearcoatRoughness: 0.22,
      emissive: '#03101a',
      emissiveIntensity: 0.24,
    }), 'wet-concrete');
    this.dockMaterial = this.material(new THREE.MeshPhysicalMaterial({
      color: '#121a24',
      roughness: 0.45,
      metalness: 0.45,
      clearcoat: 0.75,
      clearcoatRoughness: 0.15,
    }), 'dock-metal');
    this.cyanMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#25f4ef',
      toneMapped: false,
    }), 'cyan-neon');
    this.magentaMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ff2a91',
      toneMapped: false,
    }), 'magenta-neon');
    this.warmMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ffb34f',
      toneMapped: false,
    }), 'warm-neon');
    this.buildingMaterials = [
      this.material(new THREE.MeshPhysicalMaterial({
        color: '#071324', roughness: 0.48, metalness: 0.28,
        clearcoat: 0.62, clearcoatRoughness: 0.2,
        emissive: '#021021', emissiveIntensity: 0.3,
      }), 'hotel-navy'),
      this.material(new THREE.MeshPhysicalMaterial({
        color: '#12213a', roughness: 0.42, metalness: 0.32,
        clearcoat: 0.7, clearcoatRoughness: 0.15,
        emissive: '#0b0820', emissiveIntensity: 0.36,
      }), 'hotel-blue'),
      this.material(new THREE.MeshPhysicalMaterial({
        color: '#20102e', roughness: 0.46, metalness: 0.26,
        clearcoat: 0.62, clearcoatRoughness: 0.18,
        emissive: '#17051f', emissiveIntensity: 0.36,
      }), 'hotel-violet'),
    ];
    this.windowTextures = [
      createWindowTexture('#20e7ff', '#ff2495'),
      createWindowTexture('#ff2b99', '#ffbd61'),
      createWindowTexture('#5bf8e8', '#8058ff'),
    ];
    this.windowMaterials = this.windowTextures.map((map, index) => this.material(new THREE.MeshBasicMaterial({
      map,
      color: '#ffffff',
      toneMapped: false,
    }), `window-grid-${index}`));
    this.billboardTextures = [
      createBillboardTexture('AQUA', '#22f3ee', '#845cff'),
      createBillboardTexture('NITE', '#ff248f', '#ffad54'),
      createBillboardTexture('WAVE', '#26e9ff', '#ff2a96'),
      createBillboardTexture('VICE', '#8e5aff', '#22f1e8'),
    ];
    this.billboardMaterials = this.billboardTextures.map((map, index) => this.material(new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      alphaTest: 0.05,
      toneMapped: false,
      side: THREE.DoubleSide,
    }), `billboard-${index}`));
    this.trunkMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#211221',
      roughness: 0.88,
      metalness: 0.04,
      emissive: '#19081a',
      emissiveIntensity: 0.28,
    }), 'palm-trunk');
    this.leafMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#062824',
      roughness: 0.74,
      metalness: 0.04,
      emissive: '#003f3f',
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    }), 'palm-leaf');
    this.bushMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#13243a',
      roughness: 0.7,
      emissive: '#4c0737',
      emissiveIntensity: 0.66,
      flatShading: true,
    }), 'canal-bush');
  }

  createWater() {
    this.waterNormals = createWaveNormalTexture(this.isMobile ? 64 : 128);
    this.water = new Water(
      new THREE.PlaneGeometry(WATER_WIDTH, CANAL_LENGTH, 1, 1),
      {
        textureWidth: this.isMobile ? 256 : 512,
        textureHeight: this.isMobile ? 256 : 512,
        clipBias: 0.001,
        alpha: 1,
        waterNormals: this.waterNormals,
        sunDirection: new THREE.Vector3(-0.22, 0.84, -0.5).normalize(),
        sunColor: '#ffb8df',
        waterColor: '#003f51',
        distortionScale: this.isMobile ? 3.6 : 4.8,
        fog: true,
      },
    );
    this.water.name = 'Official Three.js Water · turquoise planar reflections';
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -0.12, CANAL_CENTER_Z);
    this.water.frustumCulled = false;
    this.water.receiveShadow = true;
    this.water.renderOrder = -1;
    this.water.material.uniforms.size.value = this.isMobile ? 2.2 : 2.8;
    this.water.userData.reflectionTextureSize = this.isMobile ? 256 : 512;
    this.environment.add(this.water);

    this.gleamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        time: { value: 0 },
        cyan: { value: new THREE.Color('#4bffff') },
        magenta: { value: new THREE.Color('#ff329e') },
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
        uniform float time;
        uniform vec3 cyan;
        uniform vec3 magenta;
        void main() {
          float rippleA = pow(max(0.0, sin(vUv.y * 210.0 + sin(vUv.x * 24.0 + time) * 2.1 - time * 2.8)), 18.0);
          float rippleB = pow(max(0.0, sin(vUv.y * 118.0 - vUv.x * 31.0 + time * 1.7)), 26.0);
          float edge = pow(abs(vUv.x - 0.5) * 2.0, 5.0);
          float distanceFade = smoothstep(0.02, 0.72, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
          vec3 color = mix(cyan, magenta, smoothstep(0.42, 0.58, vUv.x));
          float alpha = (rippleA * 0.11 + rippleB * 0.08 + edge * 0.055) * distanceFade;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.waterGleam = new THREE.Mesh(
      new THREE.PlaneGeometry(WATER_WIDTH - 0.12, CANAL_LENGTH),
      this.gleamMaterial,
    );
    this.waterGleam.name = 'Animated neon ripple highlights';
    this.waterGleam.rotation.x = -Math.PI / 2;
    this.waterGleam.position.set(0, -0.105, CANAL_CENTER_Z);
    this.waterGleam.renderOrder = 2;
    this.waterGleam.frustumCulled = false;
    this.environment.add(this.waterGleam);

    const depthMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#001b2a',
      roughness: 0.2,
      metalness: 0.12,
      emissive: '#002a3c',
      emissiveIntensity: 0.42,
    }), 'water-depth');
    this.waterDepth = new THREE.Mesh(
      new THREE.BoxGeometry(WATER_WIDTH + 0.4, 0.22, CANAL_LENGTH),
      depthMaterial,
    );
    this.waterDepth.name = 'Deep teal canal underlay';
    this.waterDepth.position.set(0, -0.35, CANAL_CENTER_Z);
    this.waterDepth.frustumCulled = false;
    this.environment.add(this.waterDepth);
  }

  createCanalBanks() {
    const bankGeometry = new THREE.BoxGeometry(2.55, 0.62, CANAL_LENGTH, 1, 1, this.isMobile ? 40 : 72);
    const promenadeGeometry = new THREE.BoxGeometry(1.25, 0.14, CANAL_LENGTH, 1, 1, this.isMobile ? 40 : 72);
    const edgeGeometry = new THREE.BoxGeometry(0.09, 0.1, CANAL_LENGTH, 1, 1, this.isMobile ? 40 : 72);
    this.banks = [];
    for (const side of [-1, 1]) {
      const waterfrontGround = setMaterialShadow(new THREE.Mesh(
        new THREE.BoxGeometry(18, 0.4, CANAL_LENGTH, 1, 1, this.isMobile ? 32 : 64),
        this.concreteMaterial,
      ));
      waterfrontGround.name = `${side < 0 ? 'Left' : 'Right'} continuous waterfront ground`;
      waterfrontGround.position.set(side * 15.5, -0.19, CANAL_CENTER_Z);

      const bank = setMaterialShadow(new THREE.Mesh(bankGeometry, this.concreteMaterial));
      bank.name = `${side < 0 ? 'Left' : 'Right'} wet concrete canal bank`;
      bank.position.set(side * 7.72, -0.03, CANAL_CENTER_Z);

      const promenade = setMaterialShadow(new THREE.Mesh(promenadeGeometry, this.dockMaterial));
      promenade.position.set(side * 8.82, 0.3, CANAL_CENTER_Z);

      const edge = new THREE.Mesh(edgeGeometry, side < 0 ? this.cyanMaterial : this.magentaMaterial);
      edge.position.set(side * 6.68, 0.16, CANAL_CENTER_Z);
      edge.frustumCulled = false;

      const innerGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, CANAL_LENGTH),
        new THREE.MeshBasicMaterial({
          color: side < 0 ? '#22eaff' : '#ff2b93',
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      innerGlow.rotation.x = -Math.PI / 2;
      innerGlow.position.set(side * 6.4, -0.105, CANAL_CENTER_Z);
      innerGlow.frustumCulled = false;

      this.environment.add(waterfrontGround, bank, promenade, edge, innerGlow);
      this.banks.push({ waterfrontGround, bank, promenade, edge, innerGlow });
    }
  }

  createArtDecoBuilding(index) {
    const group = new THREE.Group();
    group.name = `Pooled Art Deco ${index % 3 === 0 ? 'nightclub' : (index % 2 ? 'condo' : 'hotel')}`;
    const body = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(1, 1, 1, 3, 0.08),
      this.buildingMaterials[index % this.buildingMaterials.length],
    ), true, true);
    const facade = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.windowMaterials[index % this.windowMaterials.length],
    );
    facade.frustumCulled = false;
    const roof = setMaterialShadow(new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.08), this.concreteMaterial));
    const billboard = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1),
      this.billboardMaterials[index % this.billboardMaterials.length],
    );
    billboard.frustumCulled = false;
    const trims = Array.from({ length: index % 3 === 0 ? 4 : 3 }, (_, trimIndex) => {
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.045, 1),
        (index + trimIndex) % 2 ? this.magentaMaterial : this.cyanMaterial,
      );
      trim.frustumCulled = false;
      group.add(trim);
      return trim;
    });
    group.add(body, facade, roof, billboard);
    return {
      group,
      body,
      facade,
      roof,
      billboard,
      trims,
      side: index % 2 ? 1 : -1,
      speedFactor: 1,
      kind: index % 3 === 0 ? 'nightclub' : (index % 2 ? 'condo' : 'hotel'),
    };
  }

  createArtDecoScenery() {
    this.buildings = [];
    const count = this.isMobile ? 14 : 22;
    for (let index = 0; index < count; index++) {
      const building = this.createArtDecoBuilding(index);
      this.buildings.push(building);
      this.environment.add(building.group);
      this.recycleBuilding(building, -12 - index * (this.isMobile ? 17 : 11.5), false);
    }
  }

  recycleBuilding(building, z, countRecycle = true) {
    const width = 5.4 + this.random() * 4.2;
    const depth = 5.2 + this.random() * 5.8;
    const heightBase = building.kind === 'nightclub' ? 6.5 : 10.5;
    const heightRange = building.kind === 'nightclub' ? 7.5 : 20;
    const height = heightBase + Math.pow(this.random(), 0.65) * heightRange;
    const setback = 11.4 + this.random() * 6.8;
    building.group.position.set(building.side * setback, 0.12, z);
    building.group.rotation.y = (this.random() - 0.5) * 0.035;
    building.body.scale.set(width, height, depth);
    building.body.position.y = height * 0.5;
    building.facade.scale.set(width * 0.78, height * 0.76, 1);
    building.facade.position.set(0, height * 0.52, depth * 0.501);
    building.roof.scale.set(width * 1.05, 0.42, depth * 1.05);
    building.roof.position.set(0, height + 0.19, 0);
    building.billboard.scale.setScalar(building.kind === 'nightclub' ? 1.35 : 0.92);
    building.billboard.position.set(
      (this.random() - 0.5) * width * 0.28,
      height * (building.kind === 'nightclub' ? 0.72 : 0.86),
      depth * 0.516,
    );
    building.trims.forEach((trim, trimIndex) => {
      trim.scale.set(width * 1.035, 1, depth * 1.025);
      trim.position.set(0, height * ((trimIndex + 1) / (building.trims.length + 1)), 0);
    });
    building.speedFactor = 0.96 + this.random() * 0.07;
    if (countRecycle) this.stats.recycledScenery += 1;
  }

  createPalm(index) {
    const group = new THREE.Group();
    group.name = `Pooled leaning canal palm ${index + 1}`;
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 2.6, this.isMobile ? 7 : 9);
    const leafGeometry = new THREE.ConeGeometry(0.28, 3.8, 5, 1, true);
    const crown = new THREE.Group();
    for (let segment = 0; segment < 3; segment++) {
      const trunk = setMaterialShadow(new THREE.Mesh(trunkGeometry, this.trunkMaterial), true, true);
      trunk.position.set(segment * 0.14, 1.25 + segment * 2.42, 0);
      trunk.rotation.z = -0.055;
      group.add(trunk);
    }
    crown.position.set(0.48, 7.65, 0);
    const leafCount = this.isMobile ? 5 : 7;
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex++) {
      const leaf = new THREE.Mesh(leafGeometry, this.leafMaterial);
      const angle = (leafIndex / leafCount) * Math.PI * 2;
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = angle;
      leaf.rotation.z = Math.PI / 2.7;
      leaf.position.set(Math.cos(angle) * 1.05, -0.3, Math.sin(angle) * 1.05);
      leaf.frustumCulled = false;
      crown.add(leaf);
    }
    group.add(crown);

    const bushGeometry = new THREE.IcosahedronGeometry(0.68, 1);
    for (let bushIndex = 0; bushIndex < 3; bushIndex++) {
      const bush = setMaterialShadow(new THREE.Mesh(bushGeometry, this.bushMaterial), false, true);
      bush.position.set((bushIndex - 1) * 0.78, 0.45, (bushIndex % 2) * 0.42);
      bush.scale.set(1.2, 0.82 + bushIndex * 0.07, 1);
      group.add(bush);
    }
    return { group, side: index % 2 ? 1 : -1, speedFactor: 1 };
  }

  createPalmsAndBushes() {
    this.palms = [];
    const count = this.isMobile ? 10 : 16;
    for (let index = 0; index < count; index++) {
      const palm = this.createPalm(index);
      this.palms.push(palm);
      this.environment.add(palm.group);
      this.recyclePalm(palm, -20 - index * (this.isMobile ? 24 : 15.5), false);
    }
  }

  recyclePalm(palm, z, countRecycle = true) {
    const scale = 0.72 + this.random() * 0.42;
    palm.group.position.set(palm.side * (7.65 + this.random() * 2.2), 0.28, z);
    palm.group.scale.setScalar(scale);
    palm.group.rotation.set(0, (this.random() - 0.5) * 0.45, palm.side * (0.12 + this.random() * 0.08));
    palm.speedFactor = 0.97 + this.random() * 0.06;
    if (countRecycle) this.stats.recycledScenery += 1;
  }

  createOrbVisual() {
    const group = new THREE.Group();
    group.name = 'Bobbing collectible water orb';
    const coreMaterial = this.material(new THREE.MeshPhysicalMaterial({
      color: '#b9ffff',
      emissive: '#25edff',
      emissiveIntensity: 4.1,
      roughness: 0.06,
      metalness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transmission: 0.18,
      thickness: 0.4,
    }), 'orb-core');
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52, 1), coreMaterial);
    core.frustumCulled = false;
    const ringMaterial = this.material(new THREE.MeshBasicMaterial({
      color: '#ff43a5',
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }), 'orb-ring');
    const rings = [0, Math.PI / 2].map((angle) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 6, 26), ringMaterial);
      ring.rotation.x = angle;
      ring.frustumCulled = false;
      group.add(ring);
      return ring;
    });
    group.add(core);
    return { group, core, rings };
  }

  createBuoyVisual() {
    const group = new THREE.Group();
    group.name = 'Neon channel buoy obstacle';
    const body = setMaterialShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.66, 1.45, 12),
      this.material(new THREE.MeshPhysicalMaterial({
        color: '#ff2a64',
        emissive: '#ff094d',
        emissiveIntensity: 2,
        roughness: 0.28,
        metalness: 0.46,
        clearcoat: 0.8,
      }), 'buoy-body'),
    ), true, true);
    body.position.y = 0.66;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.warmMaterial);
    beacon.position.y = 1.55;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 7, 18), this.cyanMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22;
    group.add(body, beacon, ring);
    return group;
  }

  createSkiffVisual() {
    const group = new THREE.Group();
    group.name = 'Cross-channel neon skiff obstacle';
    const hull = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(2.45, 0.52, 3.6, 3, 0.18),
      this.material(new THREE.MeshPhysicalMaterial({
        color: '#190d2a',
        roughness: 0.21,
        metalness: 0.62,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        emissive: '#1a0728',
        emissiveIntensity: 0.35,
      }), 'skiff-hull'),
    ), true, true);
    hull.position.y = 0.34;
    const windshield = new THREE.Mesh(
      new RoundedBoxGeometry(1.65, 0.48, 0.75, 3, 0.12),
      new THREE.MeshPhysicalMaterial({
        color: '#073346',
        roughness: 0.04,
        metalness: 0.18,
        transparent: true,
        opacity: 0.74,
        transmission: 0.16,
      }),
    );
    windshield.position.set(0, 0.86, -0.25);
    const sideGlow = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 2.7), this.magentaMaterial);
    sideGlow.position.y = 0.42;
    group.add(hull, windshield, sideGlow);
    group.rotation.y = Math.PI / 2;
    return group;
  }

  createRunnerObjects() {
    this.runnerObjects = [];
    const count = this.isMobile ? 10 : 14;
    for (let index = 0; index < count; index++) {
      const group = new THREE.Group();
      const orb = this.createOrbVisual();
      const buoy = this.createBuoyVisual();
      const skiff = this.createSkiffVisual();
      group.add(orb.group, buoy, skiff);
      this.environment.add(group);
      const object = {
        group,
        orb,
        buoy,
        skiff,
        kind: 'orb',
        lane: 1,
        z: -30,
        resolved: false,
        bobSeed: index * 1.73,
        collectTimeline: null,
      };
      this.runnerObjects.push(object);
      this.recycleRunnerObject(object, -30 - index * 20, false);
    }
  }

  recycleRunnerObject(object, z, countRecycle = true) {
    object.collectTimeline?.kill();
    gsap.killTweensOf(object.orb.group.scale);
    const roll = this.random();
    object.kind = roll < 0.55 ? 'orb' : (roll < 0.84 ? 'buoy' : 'skiff');
    object.lane = Math.floor(this.random() * 3);
    object.z = z;
    object.resolved = false;
    object.bobSeed = this.random() * Math.PI * 2;
    object.group.visible = true;
    object.group.position.set(LANE_X[object.lane], 0, z);
    object.orb.group.visible = object.kind === 'orb';
    object.buoy.visible = object.kind === 'buoy';
    object.skiff.visible = object.kind === 'skiff';
    object.orb.group.scale.setScalar(1);
    if (countRecycle) this.stats.recycledObjects += 1;
  }

  createBoatRig() {
    this.boatRig = new THREE.Group();
    this.boatRig.name = 'Canal vehicle · transformable neon speedboat';
    this.boatRig.visible = false;
    this.boatVisual = new THREE.Group();
    this.boatVisual.name = 'GSAP speedboat bob presentation';
    this.boatRig.add(this.boatVisual);

    const hullMaterial = new THREE.MeshPhysicalMaterial({
      color: '#5f0a45',
      roughness: 0.18,
      metalness: 0.58,
      clearcoat: 1,
      clearcoatRoughness: 0.065,
      iridescence: 0.32,
      iridescenceIOR: 1.65,
      envMapIntensity: 0.75,
    });
    const hull = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(3.25, 0.68, 4.6, 5, 0.22),
      hullMaterial,
    ), true, true);
    hull.position.set(0, 0.43, 0.3);
    const bow = setMaterialShadow(new THREE.Mesh(
      new THREE.ConeGeometry(1.69, 2.8, 4, 1, false, Math.PI / 4),
      hullMaterial,
    ), true, true);
    bow.rotation.x = -Math.PI / 2;
    bow.position.set(0, 0.38, -2.72);
    bow.scale.y = 0.72;

    const deck = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(2.85, 0.22, 2.8, 4, 0.12),
      new THREE.MeshPhysicalMaterial({
        color: '#ff4e9d',
        roughness: 0.2,
        metalness: 0.22,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
    ), true, true);
    deck.position.set(0, 0.85, 0.45);
    const cockpit = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(2.2, 0.66, 1.75, 4, 0.18),
      new THREE.MeshPhysicalMaterial({
        color: '#031d31',
        roughness: 0.045,
        metalness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.025,
        transmission: 0.22,
        transparent: true,
        opacity: 0.86,
      }),
    ), true, true);
    cockpit.position.set(0, 1.19, 0.36);
    cockpit.rotation.x = -0.06;

    const rearDeck = setMaterialShadow(new THREE.Mesh(
      new RoundedBoxGeometry(2.92, 0.3, 1.25, 3, 0.12),
      hullMaterial,
    ), true, true);
    rearDeck.position.set(0, 0.92, 1.9);

    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.09, 4.2),
        side < 0 ? this.cyanMaterial : this.magentaMaterial,
      );
      strip.position.set(side * 1.58, 0.56, 0.1);
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(0.82, 0.16, 0.08),
        side < 0 ? this.cyanMaterial : this.magentaMaterial,
      );
      tail.position.set(side * 0.88, 0.79, 2.63);
      const intake = setMaterialShadow(new THREE.Mesh(
        new RoundedBoxGeometry(0.54, 0.42, 0.85, 3, 0.1),
        new THREE.MeshStandardMaterial({ color: '#03040a', roughness: 0.52, metalness: 0.7 }),
      ), true, true);
      intake.position.set(side * 0.85, 1.12, 1.83);
      this.boatVisual.add(strip, tail, intake);
    }

    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: '#d6ffff',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.wakes = [-1, 1].map((side) => {
      const wake = new THREE.Mesh(new THREE.ConeGeometry(0.72, 6.5, 3, 1, true), wakeMaterial.clone());
      wake.name = `${side < 0 ? 'Port' : 'starboard'} GSAP boat wake`;
      wake.rotation.x = Math.PI / 2;
      wake.rotation.z = side * 0.22;
      wake.scale.set(0.72, 1, 0.06);
      wake.position.set(side * 0.75, -0.08, 5.3);
      wake.frustumCulled = false;
      this.boatVisual.add(wake);
      return wake;
    });
    this.wakeOpacitySetters = this.wakes.map((wake) => gsap.quickTo(wake.material, 'opacity', {
      duration: 0.18,
      ease: 'power2.out',
    }));
    this.wakeLengthSetters = this.wakes.map((wake) => gsap.quickTo(wake.scale, 'y', {
      duration: 0.2,
      ease: 'power2.out',
    }));

    this.boatVisual.add(hull, bow, deck, cockpit, rearDeck);
    this.boatVisual.traverse((child) => {
      if (!child.isMesh || child.material?.transparent) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    this.boatRig.userData.canalVehicle = true;
    this.boatRig.userData.waterlineY = 0.04;

    const bobAmount = this.prefersReducedMotion() ? 0 : 1;
    this.boatIdleTimeline = gsap.timeline({ repeat: -1, yoyo: true, paused: true });
    this.boatIdleTimeline
      .to(this.boatVisual.position, {
        y: 0.055 * bobAmount,
        duration: 0.46,
        ease: 'sine.inOut',
      }, 0)
      .to(this.boatVisual.rotation, {
        z: 0.014 * bobAmount,
        x: -0.009 * bobAmount,
        duration: 0.46,
        ease: 'sine.inOut',
      }, 0);
  }

  animateOrbCollect(object) {
    object.collectTimeline?.kill();
    gsap.killTweensOf(object.orb.group.scale);
    object.collectTimeline = gsap.timeline({ defaults: { overwrite: 'auto' } })
      .to(object.orb.group.scale, {
        x: this.prefersReducedMotion() ? 1.06 : 1.85,
        y: this.prefersReducedMotion() ? 1.06 : 1.85,
        z: this.prefersReducedMotion() ? 1.06 : 1.85,
        duration: 0.1,
        ease: 'power3.out',
      })
      .to(object.orb.group.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 0.17,
        ease: 'power2.in',
        onComplete: () => {
          if (object.resolved && object.kind === 'orb') object.group.visible = false;
        },
      });
  }

  setActive(active) {
    this.active = Boolean(active);
    this.environment.visible = this.active;
    if (this.active) {
      this.boatIdleTimeline?.resume();
      this.waterPhaseTween?.resume();
    } else {
      this.boatIdleTimeline?.pause();
      this.waterPhaseTween?.pause();
    }
  }

  reset() {
    this.randomState = 0xc0ffee12;
    this.elapsed = 0;
    this.distance = 0;
    this.motionPhase.water = 0;
    Object.assign(this.stats, {
      orbsCollected: 0,
      obstaclesHit: 0,
      recycledScenery: 0,
      recycledObjects: 0,
    });
    this.water.material.uniforms.time.value = 0;
    this.gleamMaterial.uniforms.time.value = 0;
    this.buildings.forEach((building, index) => {
      this.recycleBuilding(building, -12 - index * (this.isMobile ? 17 : 11.5), false);
    });
    this.palms.forEach((palm, index) => {
      this.recyclePalm(palm, -20 - index * (this.isMobile ? 24 : 15.5), false);
    });
    this.runnerObjects.forEach((object, index) => {
      this.recycleRunnerObject(object, -30 - index * 20, false);
    });
    this.boatIdleTimeline?.restart();
    this.boatIdleTimeline?.paused(!this.active);
    this.waterPhaseTween?.restart();
    this.waterPhaseTween?.paused(!this.active);
    this.boatVisual.position.set(0, 0, 0);
    this.boatVisual.rotation.set(0, 0, 0);
    this.wakes.forEach((wake) => {
      gsap.killTweensOf([wake.material, wake.scale]);
      wake.material.opacity = 0.32;
      wake.scale.y = 1;
    });
  }

  update(dt, {
    advance = 0,
    lateralX = 0,
    speed = 0,
    active = true,
    collisionsEnabled = active,
  } = {}) {
    if (!this.active) return;
    const safeDt = Math.max(0, Math.min(dt, 0.1));
    this.elapsed += safeDt;
    this.water.material.uniforms.time.value += safeDt * (active ? 0.72 : 0.18);
    this.gleamMaterial.uniforms.time.value += safeDt * (active ? 1 : 0.25);
    if (!active) return;

    const safeAdvance = Math.max(0, advance);
    this.distance += safeAdvance;
    let farthestBuildingZ = Infinity;
    for (const building of this.buildings) {
      farthestBuildingZ = Math.min(farthestBuildingZ, building.group.position.z);
    }
    for (const building of this.buildings) {
      building.group.position.z += safeAdvance * building.speedFactor;
      if (building.group.position.z > RECYCLE_Z) {
        farthestBuildingZ -= 9.5 + this.random() * 7.5;
        this.recycleBuilding(building, farthestBuildingZ);
      }
    }

    let farthestPalmZ = Infinity;
    for (const palm of this.palms) farthestPalmZ = Math.min(farthestPalmZ, palm.group.position.z);
    for (const palm of this.palms) {
      palm.group.position.z += safeAdvance * palm.speedFactor;
      if (palm.group.position.z > RECYCLE_Z) {
        farthestPalmZ -= 13 + this.random() * 11;
        this.recyclePalm(palm, farthestPalmZ);
      }
    }

    let farthestObjectZ = Infinity;
    for (const object of this.runnerObjects) farthestObjectZ = Math.min(farthestObjectZ, object.z);
    for (const object of this.runnerObjects) {
      object.z += safeAdvance;
      object.group.position.z = object.z;
      const bobAmplitude = this.prefersReducedMotion() ? 0.025 : 0.12;
      const phase = this.motionPhase.water * (object.kind === 'orb' ? 1.08 : 0.64) + object.bobSeed;
      object.group.position.y = Math.sin(phase) * bobAmplitude;
      object.group.rotation.z = Math.sin(phase * 0.73) * (object.kind === 'skiff' ? 0.045 : 0.025);

      if (object.kind === 'orb') {
        object.orb.core.rotation.y = phase * 0.7;
        object.orb.core.rotation.x = phase * 0.24;
        object.orb.rings[0].rotation.z = phase * 0.82;
        object.orb.rings[1].rotation.y = -phase * 0.65;
      }

      if (!object.resolved && collisionsEnabled) {
        const longitudinalDistance = Math.abs(object.z - CAR_Z);
        const lateralDistance = Math.abs(lateralX - LANE_X[object.lane]);
        if (object.kind === 'orb' && longitudinalDistance < 1.9 && lateralDistance < 1.82) {
          object.resolved = true;
          this.stats.orbsCollected += 1;
          this.animateOrbCollect(object);
          this.onCollect({
            kind: 'orb',
            lane: object.lane,
            z: object.z,
            total: this.stats.orbsCollected,
          });
        } else if (object.kind !== 'orb'
          && longitudinalDistance < (object.kind === 'skiff' ? 3.1 : 2.35)
          && lateralDistance < (object.kind === 'skiff' ? 2.75 : 2.1)) {
          object.resolved = true;
          this.stats.obstaclesHit += 1;
          this.onCrash({
            kind: object.kind,
            lane: object.lane,
            z: object.z,
          });
        } else if (object.z > CAR_Z + 3.4) {
          object.resolved = true;
        }
      }

      if (object.z > RECYCLE_Z) {
        farthestObjectZ -= 16 + this.random() * 10;
        this.recycleRunnerObject(object, farthestObjectZ);
      }
    }

    const speedAmount = THREE.MathUtils.clamp((speed - 28) / 34, 0, 1);
    const wakeOpacity = this.prefersReducedMotion() ? 0.24 : 0.25 + speedAmount * 0.28;
    for (let index = 0; index < this.wakes.length; index++) {
      this.wakeOpacitySetters[index](wakeOpacity);
      this.wakeLengthSetters[index](0.84 + speedAmount * 0.5);
    }
  }

  nearbyObjects() {
    return this.runnerObjects
      .filter((object) => object.z > -72 && object.z < 18)
      .sort((a, b) => b.z - a.z)
      .slice(0, 6)
      .map((object) => ({
        kind: object.kind,
        lane: object.lane,
        z: +object.z.toFixed(1),
        resolved: object.resolved,
      }));
  }

  snapshot() {
    return {
      active: this.active,
      water: {
        implementation: 'three/addons/objects/Water.js',
        style: 'procedural normals, planar reflections, turquoise canal',
        reflectionTexture: this.water.userData.reflectionTextureSize,
        distortionScale: this.water.material.uniforms.distortionScale.value,
      },
      scenery: {
        artDecoBuildings: this.buildings.length,
        leaningPalms: this.palms.length,
        wetBanks: this.banks.length,
      },
      pool: {
        runnerObjects: this.runnerObjects.length,
        kinds: ['orb', 'buoy', 'skiff'],
      },
      traveled: +this.distance.toFixed(1),
      ...this.stats,
      nearbyObjects: this.nearbyObjects(),
    };
  }

  dispose() {
    this.boatIdleTimeline?.kill();
    this.waterPhaseTween?.kill();
    [...this.wakeOpacitySetters, ...this.wakeLengthSetters].forEach((setter) => {
      setter?.tween?.kill?.();
    });
    this.runnerObjects.forEach((object) => {
      object.collectTimeline?.kill();
      gsap.killTweensOf(object.orb.group.scale);
    });
    this.environment.removeFromParent();
    this.boatRig.removeFromParent();

    const geometries = new Set();
    const materials = new Set();
    const textures = new Set([
      this.waterNormals,
      ...this.windowTextures,
      ...this.billboardTextures,
    ]);
    const collectResources = (root) => root.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) geometries.add(child.geometry);
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.filter(Boolean).forEach((material) => {
        materials.add(material);
        if (material.map) textures.add(material.map);
        if (material.normalMap) textures.add(material.normalMap);
      });
    });
    collectResources(this.environment);
    collectResources(this.boatRig);
    const reflectionTexture = this.water.material.uniforms.mirrorSampler?.value;
    if (reflectionTexture) textures.add(reflectionTexture);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture?.dispose?.());
  }
}
