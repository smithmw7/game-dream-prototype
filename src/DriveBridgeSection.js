import * as THREE from 'three';
import { gsap } from 'gsap';

const DECK_WIDTH = 12;
const CAR_Z = 4;
const BRIDGE_NEAR_Z = 28;
const BRIDGE_FAR_Z = -320;
const BRIDGE_VISIBLE_LENGTH = BRIDGE_NEAR_Z - BRIDGE_FAR_Z;
const PROFILE_WORLD_LENGTH = 300;
const RECYCLE_Z = 42;
const WATER_GROUND_Y = -4.2;
const LAND_GROUND_Y = -4.7;

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smootherStep(value) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function setMeshShadows(mesh, cast = false, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  return mesh;
}

function createAsphaltTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  let state = 0x8e4d17a3;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = random();
      const aggregate = random() > 0.93 ? 18 + random() * 18 : 0;
      const rainRill = Math.pow(Math.max(0, Math.sin(y * 0.43 + x * 0.11)), 12) * 12;
      const value = Math.round(72 + grain * 48 + aggregate + rainRill);
      const offset = (y * size + x) * 4;
      data[offset] = value * 0.68;
      data[offset + 1] = value * 0.76;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Procedural wet bridge asphalt grit';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 42);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createHorizontalRibbonGeometry(xMin, xMax, segments) {
  const rows = segments + 1;
  const positions = new Float32Array(rows * 2 * 3);
  const uvs = new Float32Array(rows * 2 * 2);
  const indices = [];

  for (let row = 0; row < rows; row++) {
    const t = row / segments;
    const z = THREE.MathUtils.lerp(BRIDGE_NEAR_Z, BRIDGE_FAR_Z, t);
    const positionOffset = row * 6;
    positions[positionOffset] = xMin;
    positions[positionOffset + 1] = 0;
    positions[positionOffset + 2] = z;
    positions[positionOffset + 3] = xMax;
    positions[positionOffset + 4] = 0;
    positions[positionOffset + 5] = z;

    const uvOffset = row * 4;
    uvs[uvOffset] = 0;
    uvs[uvOffset + 1] = t;
    uvs[uvOffset + 2] = 1;
    uvs[uvOffset + 3] = t;

    if (row < segments) {
      const a = row * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData.ribbon = {
    type: 'horizontal',
    segments,
    xMin,
    xMax,
  };
  geometry.computeVertexNormals();
  return geometry;
}

function createVerticalRibbonGeometry(x, lowerOffset, upperOffset, segments) {
  const geometry = createHorizontalRibbonGeometry(x, x, segments);
  geometry.userData.ribbon = {
    type: 'vertical',
    segments,
    x,
    lowerOffset,
    upperOffset,
  };
  return geometry;
}

function createCableGeometry(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(points * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  return geometry;
}

function createLandGeometry(isMobile) {
  const geometry = new THREE.PlaneGeometry(
    190,
    BRIDGE_VISIBLE_LENGTH + 36,
    isMobile ? 8 : 13,
    isMobile ? 28 : 46,
  );
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color('#35122e');
  const high = new THREE.Color('#a84552');
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const sideRise = smootherStep((Math.abs(x) - 16) / 72) * 5.6;
    const dune = Math.sin(x * 0.11 + z * 0.035) * 0.58
      + Math.cos(x * 0.037 - z * 0.071) * 0.34;
    const strata = Math.sin(z * 0.018 + Math.abs(x) * 0.045) * 0.42;
    const y = LAND_GROUND_Y + sideRise + dune + strata;
    position.setY(index, y);
    color.copy(low).lerp(high, clamp01((y - LAND_GROUND_Y) / 7));
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Procedural elevated bridge environment for Drive Mode.
 *
 * `sectionProgress` is always normalized across the complete bridge: 0 at the
 * first climb joint, 0.5 at the crown, and 1 at the final road joint. The deck
 * is rebuilt from that same sampled profile every update, so callers can apply
 * the numeric return value from `update()` directly to the car/camera lift.
 */
export class DriveBridgeSection {
  constructor(parent, {
    isMobile = false,
    patchMaterial = (material) => material,
    prefersReducedMotion = () => false,
  } = {}) {
    this.parent = parent;
    this.isMobile = isMobile;
    this.patchMaterial = patchMaterial;
    this.prefersReducedMotion = prefersReducedMotion;
    this.active = false;
    this.elapsed = 0;
    this.distance = 0;
    this.sectionProgress = 0;
    this.phase = 'bridge-span';
    this.cycleIndex = 0;
    this.currentElevation = 0;
    this.currentGrade = 0;
    this.variantMode = 'water';
    this.variant = 'water';
    this.waterKind = 'lake';
    this.randomState = 0x6a09e667;
    this.lastGeometryProgress = Number.NaN;
    this.motionPhase = { pulse: 0 };
    this.stats = {
      supportsRecycled: 0,
      lightsRecycled: 0,
      sceneryRecycled: 0,
    };

    this.environment = new THREE.Group();
    this.environment.name = 'Drive bridge · procedural elevated crossing';
    this.environment.visible = false;
    parent.add(this.environment);

    this.pulseTween = gsap.to(this.motionPhase, {
      pulse: Math.PI * 2,
      duration: 2.35,
      ease: 'none',
      repeat: -1,
      paused: true,
    });

    this.createMaterials();
    this.createUnderlyingEnvironment();
    this.createDeck();
    this.createSupports();
    this.createRoadLights();
    this.createDistantScenery();
    this.reset();
    this.setActive(false);
  }

  random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  material(material, key, style = 'plain') {
    return this.patchMaterial(material, `bridge-${key}`, style);
  }

  createMaterials() {
    this.asphaltTexture = createAsphaltTexture(this.isMobile ? 32 : 64);
    this.deckMaterial = new THREE.MeshPhysicalMaterial({
      color: '#68758d',
      map: this.asphaltTexture,
      roughness: 0.3,
      metalness: 0.38,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      emissive: '#07101d',
      emissiveIntensity: 0.34,
      envMapIntensity: 0.72,
      side: THREE.DoubleSide,
    });
    this.deckMaterial.name = 'Unbent bridge road material';

    this.undersideMaterial = new THREE.MeshPhysicalMaterial({
      color: '#111522',
      roughness: 0.44,
      metalness: 0.48,
      clearcoat: 0.45,
      clearcoatRoughness: 0.2,
      emissive: '#08041a',
      emissiveIntensity: 0.24,
      side: THREE.DoubleSide,
    });
    this.undersideMaterial.name = 'Unbent bridge deck structure';

    // The bridge deck is CPU-deformed without the global world bend. Keep all
    // connected structure in that same coordinate model so piers, towers, and
    // road-light poles cannot drift away from the sampled deck profile.
    this.concreteMaterial = new THREE.MeshStandardMaterial({
      color: '#24263a',
      roughness: 0.62,
      metalness: 0.22,
      emissive: '#090518',
      emissiveIntensity: 0.28,
      flatShading: true,
    });
    this.concreteMaterial.name = 'Unbent bridge monolithic concrete';
    this.darkMetalMaterial = new THREE.MeshPhysicalMaterial({
      color: '#101526',
      roughness: 0.32,
      metalness: 0.68,
      clearcoat: 0.62,
      clearcoatRoughness: 0.16,
    });
    this.darkMetalMaterial.name = 'Unbent bridge support metal';
    this.cyanMaterial = new THREE.MeshBasicMaterial({
      color: '#27f5ff',
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.magentaMaterial = new THREE.MeshBasicMaterial({
      color: '#ff2d9d',
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.warmMaterial = new THREE.MeshBasicMaterial({
      color: '#ffb567',
      toneMapped: false,
    });
    this.cableMaterial = new THREE.LineBasicMaterial({
      color: '#49eaff',
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.landMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#8b3150',
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true,
      flatShading: true,
      emissive: '#2b071f',
      emissiveIntensity: 0.24,
    }), 'canyon-floor', 'terrain');
    this.mesaMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#723047',
      roughness: 0.9,
      metalness: 0.02,
      flatShading: true,
      emissive: '#29071f',
      emissiveIntensity: 0.2,
    }), 'distant-mesas', 'terrain');
    this.islandMaterial = this.material(new THREE.MeshStandardMaterial({
      color: '#172c3f',
      roughness: 0.86,
      metalness: 0.05,
      flatShading: true,
      emissive: '#07172a',
      emissiveIntensity: 0.3,
    }), 'distant-islands', 'terrain');
  }

  createUnderlyingEnvironment() {
    this.waterGroup = new THREE.Group();
    this.waterGroup.name = 'Bridge underlay · stylized lake or river';
    this.landGroup = new THREE.Group();
    this.landGroup.name = 'Bridge underlay · procedural canyon land';
    this.environment.add(this.waterGroup, this.landGroup);

    this.waterMaterial = new THREE.ShaderMaterial({
      name: 'Non-reflective procedural bridge water shader',
      depthWrite: true,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uTravel: { value: 0 },
        uRiver: { value: 0 },
        uCyan: { value: new THREE.Color('#23d9ef') },
        uMagenta: { value: new THREE.Color('#ff2a99') },
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
        uniform float uTime;
        uniform float uTravel;
        uniform float uRiver;
        uniform vec3 uCyan;
        uniform vec3 uMagenta;

        float wave(vec2 p, float frequency, float speed) {
          return sin((p.x * 0.7 + p.y) * frequency + uTime * speed + uTravel);
        }

        void main() {
          vec2 p = vUv * vec2(mix(9.0, 15.0, uRiver), 34.0);
          float a = wave(p, 1.7, 1.35);
          float b = wave(p.yx + vec2(a * 0.18), 2.9, -0.92);
          float c = wave(p + vec2(b * 0.22), 5.2, 0.58);
          float surface = a * 0.42 + b * 0.34 + c * 0.24;
          float glint = pow(max(0.0, surface * 0.5 + 0.5), 18.0);
          float reflection = pow(max(0.0, sin((vUv.y + uTravel * 0.008) * 112.0 + a)), 24.0);
          float centerLight = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 5.0);
          vec3 deep = mix(vec3(0.002, 0.025, 0.07), vec3(0.004, 0.11, 0.14), surface * 0.5 + 0.5);
          vec3 reflectedNeon = mix(uCyan, uMagenta, smoothstep(0.35, 0.7, vUv.x));
          vec3 color = deep + reflectedNeon * (glint * 0.28 + reflection * 0.1) * (0.35 + centerLight);
          color += vec3(0.16, 0.2, 0.28) * pow(max(0.0, surface), 12.0) * 0.25;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(190, BRIDGE_VISIBLE_LENGTH + 40, 1, 1),
      this.waterMaterial,
    );
    this.water.name = 'Cheap stylized water · no reflector or refractor';
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, WATER_GROUND_Y, (BRIDGE_NEAR_Z + BRIDGE_FAR_Z) * 0.5);
    this.water.receiveShadow = true;
    this.water.frustumCulled = false;
    this.waterGroup.add(this.water);

    this.riverBanks = [];
    for (const side of [-1, 1]) {
      const bank = setMeshShadows(new THREE.Mesh(
        new THREE.BoxGeometry(58, 2.2, BRIDGE_VISIBLE_LENGTH + 44),
        this.mesaMaterial,
      ));
      bank.name = `${side < 0 ? 'Left' : 'Right'} procedural river bank`;
      bank.position.set(side * 68, WATER_GROUND_Y - 0.2, (BRIDGE_NEAR_Z + BRIDGE_FAR_Z) * 0.5);
      this.riverBanks.push(bank);
      this.waterGroup.add(bank);
    }

    this.land = setMeshShadows(new THREE.Mesh(createLandGeometry(this.isMobile), this.landMaterial));
    this.land.name = 'Procedural land below elevated bridge';
    this.land.position.z = (BRIDGE_NEAR_Z + BRIDGE_FAR_Z) * 0.5;
    this.landGroup.add(this.land);
  }

  createDeck() {
    const segments = this.isMobile ? 48 : 80;
    this.dynamicRibbons = [];

    const addHorizontal = (name, xMin, xMax, offset, material, normals = false) => {
      const geometry = createHorizontalRibbonGeometry(xMin, xMax, segments);
      const mesh = setMeshShadows(new THREE.Mesh(geometry, material), false, true);
      mesh.name = name;
      mesh.renderOrder = material.transparent ? 3 : 0;
      this.environment.add(mesh);
      this.dynamicRibbons.push({
        geometry,
        offset,
        normals,
      });
      return mesh;
    };
    const addVertical = (name, x, lowerOffset, upperOffset, material, normals = false) => {
      const geometry = createVerticalRibbonGeometry(x, lowerOffset, upperOffset, segments);
      const mesh = setMeshShadows(new THREE.Mesh(geometry, material), false, true);
      mesh.name = name;
      mesh.renderOrder = material.transparent ? 4 : 0;
      this.environment.add(mesh);
      this.dynamicRibbons.push({
        geometry,
        lowerOffset,
        upperOffset,
        normals,
      });
      return mesh;
    };

    this.deck = addHorizontal(
      'Dynamic three-lane bridge deck · 12 unit width',
      -DECK_WIDTH * 0.5,
      DECK_WIDTH * 0.5,
      0,
      this.deckMaterial,
      true,
    );
    this.deckUnderside = addHorizontal(
      'Dynamic bridge structural underside',
      -DECK_WIDTH * 0.54,
      DECK_WIDTH * 0.54,
      -0.52,
      this.undersideMaterial,
      true,
    );

    this.fascias = [
      addVertical('Left monolithic deck fascia', -6.46, -0.58, -0.04, this.undersideMaterial, true),
      addVertical('Right monolithic deck fascia', 6.46, -0.58, -0.04, this.undersideMaterial, true),
    ];
    this.rails = [
      addVertical('Left cyan neon bridge rail', -6.34, 0.72, 0.88, this.cyanMaterial),
      addVertical('Right magenta neon bridge rail', 6.34, 0.72, 0.88, this.magentaMaterial),
    ];

    this.laneLines = [];
    for (const x of [-1.625, 1.625]) {
      this.laneLines.push(addHorizontal(
        `${x < 0 ? 'Left' : 'Right'} bridge lane guide`,
        x - 0.045,
        x + 0.045,
        0.045,
        x < 0 ? this.cyanMaterial : this.magentaMaterial,
      ));
    }
    for (const x of [-5.62, 5.62]) {
      this.laneLines.push(addHorizontal(
        `${x < 0 ? 'Left' : 'Right'} bridge edge guide`,
        x - 0.055,
        x + 0.055,
        0.052,
        x < 0 ? this.cyanMaterial : this.magentaMaterial,
      ));
    }

    this.updateDynamicDeck(true);
  }

  createSupport(index) {
    const group = new THREE.Group();
    group.name = `Pooled bridge support ${index + 1}`;
    const pierGeometry = new THREE.BoxGeometry(1.15, 1, 1.55);
    const piers = [-4.7, 4.7].map((x) => {
      const pier = setMeshShadows(new THREE.Mesh(pierGeometry, this.concreteMaterial), true, true);
      pier.position.x = x;
      group.add(pier);
      return pier;
    });
    const cap = setMeshShadows(new THREE.Mesh(
      new THREE.BoxGeometry(11.2, 0.62, 2.05),
      this.darkMetalMaterial,
    ), true, true);
    group.add(cap);

    const caissons = [-4.7, 4.7].map((x) => {
      const caisson = setMeshShadows(new THREE.Mesh(
        new THREE.CylinderGeometry(1.18, 1.52, 1.6, this.isMobile ? 7 : 10),
        this.darkMetalMaterial,
      ), true, true);
      caisson.position.x = x;
      group.add(caisson);
      return caisson;
    });

    const tower = new THREE.Group();
    const towerLegs = [-5.3, 5.3].map((x) => {
      const leg = setMeshShadows(new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 6.4, 0.68),
        this.darkMetalMaterial,
      ), true, true);
      leg.position.x = x;
      tower.add(leg);
      return leg;
    });
    const towerCap = setMeshShadows(new THREE.Mesh(
      new THREE.BoxGeometry(11.3, 0.48, 0.72),
      this.darkMetalMaterial,
    ), true, true);
    tower.add(towerCap);

    const cablePoints = this.isMobile ? 9 : 15;
    const cables = [-1, 1].map((side) => {
      const line = new THREE.Line(createCableGeometry(cablePoints), this.cableMaterial);
      line.name = `${side < 0 ? 'Left' : 'Right'} suspension half-span cable`;
      line.frustumCulled = false;
      tower.add(line);
      return line;
    });
    group.add(tower);
    this.environment.add(group);

    return {
      group,
      piers,
      cap,
      caissons,
      tower,
      towerLegs,
      towerCap,
      cables,
      cablePoints,
      isTower: index % 3 === 0,
      z: 0,
      speedFactor: 1,
    };
  }

  createSupports() {
    this.supports = [];
    const count = this.isMobile ? 6 : 9;
    const spacing = BRIDGE_VISIBLE_LENGTH / Math.max(1, count - 1);
    for (let index = 0; index < count; index++) {
      const support = this.createSupport(index);
      this.supports.push(support);
      this.recycleSupport(support, BRIDGE_NEAR_Z - 22 - index * spacing, false);
    }
  }

  createRoadLight(index) {
    const group = new THREE.Group();
    group.name = `Pooled bridge light pair ${index + 1}`;
    const poles = [];
    const lamps = [];
    for (const side of [-1, 1]) {
      const pole = setMeshShadows(new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.075, 1.5, 6),
        this.darkMetalMaterial,
      ), true, true);
      pole.position.set(side * 6.2, 0.75, 0);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 8, 6),
        side < 0 ? this.cyanMaterial : this.magentaMaterial,
      );
      lamp.position.set(side * 6.2, 1.52, 0);
      lamp.frustumCulled = false;
      group.add(pole, lamp);
      poles.push(pole);
      lamps.push(lamp);
    }
    this.environment.add(group);
    return {
      group,
      poles,
      lamps,
      z: 0,
      pulseSeed: index * 1.73,
      speedFactor: 1,
    };
  }

  createRoadLights() {
    this.roadLights = [];
    const count = this.isMobile ? 10 : 16;
    const spacing = BRIDGE_VISIBLE_LENGTH / count;
    for (let index = 0; index < count; index++) {
      const light = this.createRoadLight(index);
      this.roadLights.push(light);
      this.recycleRoadLight(light, BRIDGE_NEAR_Z - 8 - index * spacing, false);
    }
  }

  createDistantFeature(index) {
    const group = new THREE.Group();
    group.name = `Pooled bridge horizon feature ${index + 1}`;
    const island = setMeshShadows(new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      this.islandMaterial,
    ), false, true);
    const mesa = setMeshShadows(new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 1, 1, 7, 2),
      this.mesaMaterial,
    ), true, true);
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1, 0.08),
      index % 2 ? this.magentaMaterial : this.cyanMaterial,
    );
    marker.frustumCulled = false;
    group.add(island, mesa, marker);
    this.environment.add(group);
    return {
      group,
      island,
      mesa,
      marker,
      side: index % 2 ? 1 : -1,
      z: 0,
      speedFactor: 0.32,
    };
  }

  createDistantScenery() {
    this.distantFeatures = [];
    const count = this.isMobile ? 10 : 18;
    for (let index = 0; index < count; index++) {
      const feature = this.createDistantFeature(index);
      this.distantFeatures.push(feature);
      this.recycleDistantFeature(feature, -18 - index * (this.isMobile ? 32 : 19), false);
    }
  }

  recycleSupport(support, z, countRecycle = true) {
    support.z = z;
    support.speedFactor = 0.995 + this.random() * 0.01;
    support.group.position.z = z;
    if (countRecycle) this.stats.supportsRecycled += 1;
  }

  recycleRoadLight(light, z, countRecycle = true) {
    light.z = z;
    light.speedFactor = 0.997 + this.random() * 0.006;
    light.group.position.z = z;
    light.pulseSeed = this.random() * Math.PI * 2;
    if (countRecycle) this.stats.lightsRecycled += 1;
  }

  recycleDistantFeature(feature, z, countRecycle = true) {
    feature.z = z;
    feature.speedFactor = 0.24 + this.random() * 0.22;
    const distance = 28 + this.random() * 54;
    const scale = 2.2 + this.random() * 4.7;
    feature.group.position.set(feature.side * distance, 0, z);
    feature.group.rotation.y = (this.random() - 0.5) * 0.48;
    feature.island.scale.set(scale * 1.9, scale * 0.52, scale * 1.15);
    feature.island.position.y = WATER_GROUND_Y + scale * 0.3;
    feature.mesa.scale.set(scale * 0.85, scale * (1.15 + this.random() * 1.7), scale * 0.72);
    feature.mesa.position.y = LAND_GROUND_Y + feature.mesa.scale.y * 0.5;
    feature.marker.scale.y = 1.5 + scale * 0.8;
    feature.marker.position.set(
      0,
      (this.variant === 'water' ? WATER_GROUND_Y : LAND_GROUND_Y)
        + feature.marker.scale.y * 0.5
        + (this.variant === 'water' ? scale * 0.45 : feature.mesa.scale.y),
      0,
    );
    feature.group.position.z = z;
    if (countRecycle) this.stats.sceneryRecycled += 1;
  }

  resolveVariant(cycleIndex = this.cycleIndex) {
    if (this.variantMode === 'auto') {
      return cycleIndex % 2 === 0
        ? { variant: 'water', waterKind: cycleIndex % 4 === 0 ? 'lake' : 'river' }
        : { variant: 'land', waterKind: 'none' };
    }
    if (this.variantMode === 'river' || this.variantMode === 'lake') {
      return { variant: 'water', waterKind: this.variantMode };
    }
    if (this.variantMode === 'desert' || this.variantMode === 'land') {
      return { variant: 'land', waterKind: 'none' };
    }
    return {
      variant: 'water',
      waterKind: cycleIndex % 2 === 0 ? 'lake' : 'river',
    };
  }

  applyVariant(variant, waterKind = 'lake') {
    const changed = this.variant !== variant || this.waterKind !== waterKind;
    this.variant = variant;
    this.waterKind = variant === 'water' ? waterKind : 'none';
    this.waterGroup.visible = variant === 'water';
    this.landGroup.visible = variant === 'land';
    const river = variant === 'water' && this.waterKind === 'river';
    this.water.scale.x = river ? 0.5 : 1;
    this.waterMaterial.uniforms.uRiver.value = river ? 1 : 0;
    this.riverBanks.forEach((bank) => {
      bank.visible = river;
    });
    this.distantFeatures.forEach((feature) => {
      feature.island.visible = variant === 'water';
      feature.mesa.visible = variant === 'land';
      feature.marker.position.y = (variant === 'water' ? WATER_GROUND_Y : LAND_GROUND_Y)
        + feature.marker.scale.y * 0.5
        + (variant === 'water' ? feature.island.scale.y * 0.65 : feature.mesa.scale.y);
    });
    if (changed) this.lastGeometryProgress = Number.NaN;
  }

  profileProgressAtZ(z) {
    return this.sectionProgress + (CAR_Z - z) / PROFILE_WORLD_LENGTH;
  }

  getElevation(sectionOrProgress = this.sectionProgress) {
    const value = typeof sectionOrProgress === 'number'
      ? sectionOrProgress
      : (sectionOrProgress?.progress ?? sectionOrProgress?.sectionProgress ?? this.sectionProgress);
    const progress = Number.isFinite(value) ? value : 0;
    if (progress <= 0 || progress >= 1) return 0;
    const rise = smootherStep(progress / 0.235);
    const descent = smootherStep((1 - progress) / 0.235);
    const highSpan = Math.min(rise, descent);
    const crown = Math.pow(Math.sin(progress * Math.PI), 2);
    const baseHeight = this.variant === 'water' ? 13.8 : 12.2;
    return highSpan * (baseHeight + crown * 1.65);
  }

  elevationAtZ(z) {
    return this.getElevation(this.profileProgressAtZ(z));
  }

  getGrade(progress = this.sectionProgress) {
    const epsilon = 0.0015;
    return (
      this.getElevation(progress + epsilon) - this.getElevation(progress - epsilon)
    ) / (epsilon * PROFILE_WORLD_LENGTH * 2);
  }

  updateDynamicDeck(force = false) {
    if (!force && Math.abs(this.sectionProgress - this.lastGeometryProgress) < 0.000025) return;
    this.lastGeometryProgress = this.sectionProgress;

    for (const ribbon of this.dynamicRibbons) {
      const position = ribbon.geometry.attributes.position;
      const descriptor = ribbon.geometry.userData.ribbon;
      const rows = descriptor.segments + 1;
      for (let row = 0; row < rows; row++) {
        const t = row / descriptor.segments;
        const z = THREE.MathUtils.lerp(BRIDGE_NEAR_Z, BRIDGE_FAR_Z, t);
        const elevation = this.elevationAtZ(z);
        if (descriptor.type === 'vertical') {
          position.setY(row * 2, elevation + descriptor.lowerOffset);
          position.setY(row * 2 + 1, elevation + descriptor.upperOffset);
        } else {
          position.setY(row * 2, elevation + ribbon.offset);
          position.setY(row * 2 + 1, elevation + ribbon.offset);
        }
      }
      position.needsUpdate = true;
      if (ribbon.normals) ribbon.geometry.computeVertexNormals();
    }
  }

  updateSupportVisual(support) {
    const profileProgress = this.profileProgressAtZ(support.z);
    const deckY = this.getElevation(profileProgress);
    const groundY = this.variant === 'water' ? WATER_GROUND_Y : LAND_GROUND_Y;
    const height = deckY - groundY - 0.48;
    const onBridge = profileProgress > 0.015 && profileProgress < 0.985 && height > 1.1;
    support.group.visible = onBridge;
    if (!onBridge) return;

    support.group.position.y = groundY;
    support.piers.forEach((pier) => {
      pier.scale.y = Math.max(0.4, height);
      pier.position.y = height * 0.5;
    });
    support.cap.position.y = height;
    support.caissons.forEach((caisson) => {
      caisson.visible = this.variant === 'water';
      caisson.position.y = 0.35;
    });

    const suspensionStyle = this.variant === 'water' && support.isTower && deckY > 7;
    support.tower.visible = suspensionStyle;
    if (!suspensionStyle) return;
    support.towerLegs.forEach((leg) => {
      leg.position.y = height + 3.1;
    });
    support.towerCap.position.y = height + 6.15;

    const halfSpan = 23;
    for (let cableIndex = 0; cableIndex < support.cables.length; cableIndex++) {
      const cable = support.cables[cableIndex];
      const positions = cable.geometry.attributes.position;
      const side = cableIndex === 0 ? -1 : 1;
      for (let point = 0; point < support.cablePoints; point++) {
        const t = point / (support.cablePoints - 1);
        const localZ = THREE.MathUtils.lerp(-halfSpan, halfSpan, t);
        const centerPeak = 1 - Math.pow(Math.abs(t - 0.5) * 2, 0.7);
        positions.setXYZ(
          point,
          side * 5.42,
          height + 1.08 + centerPeak * 5.05,
          localZ,
        );
      }
      positions.needsUpdate = true;
    }
  }

  setActive(active) {
    this.active = Boolean(active);
    this.environment.visible = this.active;
    if (this.active) this.pulseTween?.resume();
    else this.pulseTween?.pause();
  }

  reset({ variant = 'water' } = {}) {
    this.variantMode = ['water', 'lake', 'river', 'land', 'desert', 'auto'].includes(variant)
      ? variant
      : 'water';
    this.randomState = 0x6a09e667 ^ (
      this.variantMode === 'land' || this.variantMode === 'desert' ? 0xbb67ae85 : 0
    );
    this.elapsed = 0;
    this.distance = 0;
    this.sectionProgress = 0;
    this.phase = 'bridge-span';
    this.cycleIndex = 0;
    this.currentElevation = 0;
    this.currentGrade = 0;
    this.motionPhase.pulse = 0;
    Object.assign(this.stats, {
      supportsRecycled: 0,
      lightsRecycled: 0,
      sceneryRecycled: 0,
    });
    const next = this.resolveVariant(0);
    this.applyVariant(next.variant, next.waterKind);
    this.waterMaterial.uniforms.uTime.value = 0;
    this.waterMaterial.uniforms.uTravel.value = 0;

    const supportSpacing = BRIDGE_VISIBLE_LENGTH / Math.max(1, this.supports.length - 1);
    this.supports.forEach((support, index) => {
      this.recycleSupport(support, BRIDGE_NEAR_Z - 22 - index * supportSpacing, false);
    });
    const lightSpacing = BRIDGE_VISIBLE_LENGTH / this.roadLights.length;
    this.roadLights.forEach((light, index) => {
      this.recycleRoadLight(light, BRIDGE_NEAR_Z - 8 - index * lightSpacing, false);
    });
    this.distantFeatures.forEach((feature, index) => {
      this.recycleDistantFeature(feature, -18 - index * (this.isMobile ? 32 : 19), false);
    });
    this.applyVariant(next.variant, next.waterKind);
    this.supports.forEach((support) => this.updateSupportVisual(support));
    this.pulseTween?.restart();
    this.pulseTween?.paused(!this.active);
    this.lastGeometryProgress = Number.NaN;
    this.updateDynamicDeck(true);
    return this.currentElevation;
  }

  update(dt, {
    advance = 0,
    active = true,
    sectionProgress = 0,
    phase = 'bridge-span',
    cycleIndex = 0,
  } = {}) {
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const safeAdvance = active ? Math.max(0, Number.isFinite(advance) ? advance : 0) : 0;
    this.elapsed += safeDt;
    this.distance += safeAdvance;
    this.phase = phase;
    this.sectionProgress = clamp01(Number.isFinite(sectionProgress) ? sectionProgress : 0);
    this.cycleIndex = Math.max(0, Math.floor(Number.isFinite(cycleIndex) ? cycleIndex : 0));

    if (this.variantMode === 'auto') {
      const next = this.resolveVariant(this.cycleIndex);
      this.applyVariant(next.variant, next.waterKind);
    } else if (this.variantMode === 'water') {
      const nextWaterKind = this.cycleIndex % 2 === 0 ? 'lake' : 'river';
      this.applyVariant('water', nextWaterKind);
    }

    this.currentElevation = this.getElevation(this.sectionProgress);
    this.currentGrade = this.getGrade(this.sectionProgress);
    this.updateDynamicDeck();

    const waterMotion = this.prefersReducedMotion() ? 0.18 : 0.72;
    this.waterMaterial.uniforms.uTime.value += safeDt * (active ? waterMotion : 0.08);
    this.waterMaterial.uniforms.uTravel.value += safeAdvance * 0.025;

    if (!this.active) return this.currentElevation;

    let farthestSupportZ = Infinity;
    this.supports.forEach((support) => {
      farthestSupportZ = Math.min(farthestSupportZ, support.z);
    });
    this.supports.forEach((support) => {
      support.z += safeAdvance * support.speedFactor;
      if (support.z > RECYCLE_Z) {
        farthestSupportZ -= 34 + this.random() * 18;
        this.recycleSupport(support, farthestSupportZ);
      }
      support.group.position.z = support.z;
      this.updateSupportVisual(support);
    });

    let farthestLightZ = Infinity;
    this.roadLights.forEach((light) => {
      farthestLightZ = Math.min(farthestLightZ, light.z);
    });
    this.roadLights.forEach((light) => {
      light.z += safeAdvance * light.speedFactor;
      if (light.z > RECYCLE_Z) {
        farthestLightZ -= 17 + this.random() * 11;
        this.recycleRoadLight(light, farthestLightZ);
      }
      const profileProgress = this.profileProgressAtZ(light.z);
      const elevation = this.getElevation(profileProgress);
      light.group.visible = profileProgress > 0.005 && profileProgress < 0.995;
      light.group.position.set(0, elevation, light.z);
      const pulse = this.prefersReducedMotion()
        ? 1
        : 0.92 + Math.sin(this.motionPhase.pulse + light.pulseSeed) * 0.12;
      light.lamps.forEach((lamp) => lamp.scale.setScalar(pulse));
    });

    let farthestFeatureZ = Infinity;
    this.distantFeatures.forEach((feature) => {
      farthestFeatureZ = Math.min(farthestFeatureZ, feature.z);
    });
    this.distantFeatures.forEach((feature) => {
      feature.z += safeAdvance * feature.speedFactor;
      if (feature.z > RECYCLE_Z + 25) {
        farthestFeatureZ -= 24 + this.random() * 34;
        this.recycleDistantFeature(feature, farthestFeatureZ);
      }
      feature.group.position.z = feature.z;
    });

    return this.currentElevation;
  }

  snapshot() {
    return {
      active: this.active,
      phase: this.phase,
      cycleIndex: this.cycleIndex,
      sectionProgress: +this.sectionProgress.toFixed(3),
      elevation: +this.currentElevation.toFixed(3),
      grade: +this.currentGrade.toFixed(4),
      profile: {
        worldLength: PROFILE_WORLD_LENGTH,
        deckWidth: DECK_WIDTH,
        lanes: 3,
        shape: 'smootherstep climb, high crown span, smootherstep descent',
        unbentForPhysicalAlignment: true,
      },
      environment: {
        variant: this.variant,
        waterKind: this.waterKind,
        waterImplementation: this.variant === 'water'
          ? 'custom non-reflective shader; no planar reflector'
          : 'none',
        supports: this.supports.length,
        suspensionTowers: this.supports.filter((support) => support.isTower).length,
        neonLightPairs: this.roadLights.length,
        distantFeatures: this.distantFeatures.length,
      },
      traveled: +this.distance.toFixed(1),
      ...this.stats,
    };
  }

  dispose() {
    this.pulseTween?.kill();
    this.environment.removeFromParent();
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set([this.asphaltTexture]);
    this.environment.traverse((child) => {
      if (!child.isMesh && !child.isLine) return;
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
