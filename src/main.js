import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';

await RAPIER.init({});

const canvas = document.querySelector('#game');
const splash = document.querySelector('#splash');
const freeModeButton = document.querySelector('#free-mode-button');
const raceModeButton = document.querySelector('#race-mode-button');
const raceBriefing = document.querySelector('#race-briefing');
const raceStartButton = document.querySelector('#race-start-button');
const raceBackButton = document.querySelector('#race-back-button');
const finishPanel = document.querySelector('#finish-panel');
const raceReplayButton = document.querySelector('#race-replay-button');
const finishFreeButton = document.querySelector('#finish-free-button');
const countdown = document.querySelector('#countdown');
const countdownValue = document.querySelector('#countdown-value');
const raceHud = document.querySelector('#race-hud');
const hudTime = document.querySelector('#hud-time');
const hudCoins = document.querySelector('#hud-coins');
const hudCheckpoint = document.querySelector('#hud-checkpoint');
const hudShield = document.querySelector('#hud-shield');
const hudSection = document.querySelector('#hud-section');
const speedFill = document.querySelector('#speed-fill');
const raceToast = document.querySelector('#race-toast');
const briefBestTime = document.querySelector('#brief-best-time');
const briefBestCoins = document.querySelector('#brief-best-coins');
const finishTitle = document.querySelector('#finish-title');
const finishTime = document.querySelector('#finish-time');
const finishCoins = document.querySelector('#finish-coins');
const finishBest = document.querySelector('#finish-best');
const finishRecord = document.querySelector('#finish-record');
const resetButton = document.querySelector('#reset-button');
const fpsValue = document.querySelector('#fps-value');
const touchJoystick = document.querySelector('#touch-joystick');
const touchStick = document.querySelector('#touch-stick');
const pageQuery = new URLSearchParams(location.search);
const mobileQuery = pageQuery.has('mobile');
const debugRaceQuery = pageQuery.has('debug');
const requestedDebugDistance = Number(pageQuery.get('distance'));
const isMobileDevice = mobileQuery || Boolean(
  navigator.userAgentData?.mobile ||
  matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0 ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
);
document.body.classList.toggle('is-mobile', isMobileDevice);
if (isMobileDevice) {
  document.querySelector('#touch-hint').textContent = 'AUTO FORWARD · DRAG TO STEER · TAP TO JUMP';
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#9fc4ca', 70, 190);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.08, 260);
camera.position.set(6, 5, 11);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
const qualityRatio = Math.min(devicePixelRatio, isMobileDevice ? 1 : 1.75);
renderer.setPixelRatio(qualityRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const sunDirection = new THREE.Vector3();
const skySettings = {
  turbidity: 1.15,
  rayleigh: 4.0,
  mieCoefficient: 0.0012,
  mieDirectionalG: 0.7,
  elevation: 27,
  azimuth: 195,
};

function configureSky(sky, showSunDisc = true) {
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = skySettings.turbidity;
  uniforms.rayleigh.value = skySettings.rayleigh;
  uniforms.mieCoefficient.value = skySettings.mieCoefficient;
  uniforms.mieDirectionalG.value = skySettings.mieDirectionalG;
  uniforms.showSunDisc.value = showSunDisc;

  const phi = THREE.MathUtils.degToRad(90 - skySettings.elevation);
  const theta = THREE.MathUtils.degToRad(skySettings.azimuth);
  sunDirection.setFromSphericalCoords(1, phi, theta).normalize();
  uniforms.sunPosition.value.copy(sunDirection);
}

function styleVisibleSky(sky) {
  sky.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );',
      'vec3 texColor = ( Lin + L0 ) * 0.012 + vec3( 0.002, 0.018, 0.075 ); texColor *= vec3( 0.34, 0.62, 1.22 );',
    );
  };
  sky.material.customProgramCacheKey = () => 'game-dream-visible-sky-v1';
  sky.material.needsUpdate = true;
}

const sky = new Sky();
sky.scale.setScalar(20000);
configureSky(sky, true);
styleVisibleSky(sky);
scene.add(sky);

// Generate image-based PBR lighting from the same procedural sky without its hard sun disc.
const environmentScene = new THREE.Scene();
const environmentSky = new Sky();
environmentSky.scale.setScalar(1000);
configureSky(environmentSky, false);
environmentScene.add(environmentSky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environmentScene, 0.015, 0.1, 1000).texture;
scene.environmentIntensity = 0.58;
pmrem.dispose();
environmentSky.geometry.dispose();
environmentSky.material.dispose();

const sun = new THREE.DirectionalLight('#ffd2a0', 3.8);
sun.position.copy(sunDirection).multiplyScalar(28);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobileDevice ? 1024 : 2048, isMobileDevice ? 1024 : 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.035;
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 42 });
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.HemisphereLight('#b9e3ef', '#d89770', 0.24));

const world = new RAPIER.World({ x: 0, y: -34, z: 0 });
world.timestep = 1 / 60;

const materials = {
  sand: new THREE.MeshStandardMaterial({ color: '#e5b47d', roughness: 0.91, metalness: 0, envMapIntensity: 0.34 }),
  gold: new THREE.MeshStandardMaterial({ color: '#efaa28', roughness: 0.58, metalness: 0, envMapIntensity: 0.68 }),
  coral: new THREE.MeshStandardMaterial({ color: '#e37873', roughness: 0.72, metalness: 0, envMapIntensity: 0.48 }),
  rose: new THREE.MeshStandardMaterial({ color: '#d98bab', roughness: 0.75, metalness: 0, envMapIntensity: 0.45 }),
  poolTile: new THREE.MeshStandardMaterial({ color: '#c8edf0', roughness: 0.32, metalness: 0, envMapIntensity: 0.78, side: THREE.DoubleSide }),
  poolEdge: new THREE.MeshStandardMaterial({ color: '#fff0d1', roughness: 0.52, metalness: 0, envMapIntensity: 0.58 }),
};

const PLAYER_RADIUS = 0.72;

const RECT_POOL = { x: -7.2, z: 4.6, width: 6.4, depth: 3.7, waterY: -0.17 };
const ROUND_POOL = { x: 7.1, z: 0.6, radius: 2.72, waterY: -0.17 };

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addFixedBox({ size, position, material = materials.sand, rotationY = 0, bevel = false }) {
  let geometry;
  if (bevel) {
    geometry = new THREE.BoxGeometry(size.x, size.y, size.z, 2, 2, 2);
  } else {
    geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  }
  const mesh = shadowed(new THREE.Mesh(geometry, material));
  mesh.position.copy(position);
  mesh.rotation.y = rotationY;
  scene.add(mesh);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation({
      x: 0,
      y: Math.sin(rotationY / 2),
      z: 0,
      w: Math.cos(rotationY / 2),
    })
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(1.25), body);
  return mesh;
}

function addGroundWithPoolCutouts() {
  const half = 35;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.lineTo(-half, half);
  shape.closePath();

  // Shape-space Y maps to negative world Z after the geometry is laid flat.
  const rectHole = new THREE.Path();
  const rx0 = RECT_POOL.x - RECT_POOL.width / 2;
  const rx1 = RECT_POOL.x + RECT_POOL.width / 2;
  const rz0 = -RECT_POOL.z - RECT_POOL.depth / 2;
  const rz1 = -RECT_POOL.z + RECT_POOL.depth / 2;
  rectHole.moveTo(rx0, rz0);
  rectHole.lineTo(rx0, rz1);
  rectHole.lineTo(rx1, rz1);
  rectHole.lineTo(rx1, rz0);
  rectHole.closePath();
  shape.holes.push(rectHole);

  const roundHole = new THREE.Path();
  roundHole.absarc(ROUND_POOL.x, -ROUND_POOL.z, ROUND_POOL.radius, 0, Math.PI * 2, true);
  shape.holes.push(roundHole);

  const geometry = new THREE.ShapeGeometry(shape, 48);
  geometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geometry, materials.sand);
  ground.position.y = 0.015;
  ground.receiveShadow = true;
  scene.add(ground);

  const positions = new Float32Array(geometry.attributes.position.array);
  let indices;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  } else {
    indices = new Uint32Array(geometry.attributes.position.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.015, 0));
  world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices).setFriction(1.25), body);
}

function addFixedCylinder({ radius, height, position, material }) {
  const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 64), material));
  mesh.position.copy(position);
  scene.add(mesh);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
  world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setFriction(0.85), body);
  return mesh;
}

function addPools() {
  // Rectangle liner, bottom, walls, and a narrow raised coping.
  addFixedBox({
    size: new THREE.Vector3(RECT_POOL.width, 0.16, RECT_POOL.depth),
    position: new THREE.Vector3(RECT_POOL.x, -1.28, RECT_POOL.z),
    material: materials.poolTile,
  });
  const rectWallHeight = 1.24;
  const rectWallY = -0.62;
  addFixedBox({ size: new THREE.Vector3(0.2, rectWallHeight, RECT_POOL.depth), position: new THREE.Vector3(RECT_POOL.x - RECT_POOL.width / 2 + 0.1, rectWallY, RECT_POOL.z), material: materials.poolTile });
  addFixedBox({ size: new THREE.Vector3(0.2, rectWallHeight, RECT_POOL.depth), position: new THREE.Vector3(RECT_POOL.x + RECT_POOL.width / 2 - 0.1, rectWallY, RECT_POOL.z), material: materials.poolTile });
  addFixedBox({ size: new THREE.Vector3(RECT_POOL.width, rectWallHeight, 0.2), position: new THREE.Vector3(RECT_POOL.x, rectWallY, RECT_POOL.z - RECT_POOL.depth / 2 + 0.1), material: materials.poolTile });
  addFixedBox({ size: new THREE.Vector3(RECT_POOL.width, rectWallHeight, 0.2), position: new THREE.Vector3(RECT_POOL.x, rectWallY, RECT_POOL.z + RECT_POOL.depth / 2 - 0.1), material: materials.poolTile });

  const coping = 0.28;
  addFixedBox({ size: new THREE.Vector3(coping, 0.14, RECT_POOL.depth + coping * 2), position: new THREE.Vector3(RECT_POOL.x - RECT_POOL.width / 2 - coping / 2, 0.07, RECT_POOL.z), material: materials.poolEdge });
  addFixedBox({ size: new THREE.Vector3(coping, 0.14, RECT_POOL.depth + coping * 2), position: new THREE.Vector3(RECT_POOL.x + RECT_POOL.width / 2 + coping / 2, 0.07, RECT_POOL.z), material: materials.poolEdge });
  addFixedBox({ size: new THREE.Vector3(RECT_POOL.width, 0.14, coping), position: new THREE.Vector3(RECT_POOL.x, 0.07, RECT_POOL.z - RECT_POOL.depth / 2 - coping / 2), material: materials.poolEdge });
  addFixedBox({ size: new THREE.Vector3(RECT_POOL.width, 0.14, coping), position: new THREE.Vector3(RECT_POOL.x, 0.07, RECT_POOL.z + RECT_POOL.depth / 2 + coping / 2), material: materials.poolEdge });

  // Round pool uses a true circular visual liner with segmented tangent colliders.
  addFixedCylinder({ radius: ROUND_POOL.radius, height: 0.16, position: new THREE.Vector3(ROUND_POOL.x, -1.28, ROUND_POOL.z), material: materials.poolTile });
  const roundWall = new THREE.Mesh(
    new THREE.CylinderGeometry(ROUND_POOL.radius, ROUND_POOL.radius, 1.25, 96, 1, true),
    materials.poolTile,
  );
  roundWall.position.set(ROUND_POOL.x, -0.63, ROUND_POOL.z);
  roundWall.receiveShadow = true;
  scene.add(roundWall);

  const segments = 24;
  const wallLength = 2 * ROUND_POOL.radius * Math.tan(Math.PI / segments) + 0.04;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = ROUND_POOL.x + Math.cos(angle) * (ROUND_POOL.radius - 0.09);
    const z = ROUND_POOL.z + Math.sin(angle) * (ROUND_POOL.radius - 0.09);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, -0.62, z)
        .setRotation({ x: 0, y: Math.sin(-angle / 2), z: 0, w: Math.cos(-angle / 2) })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.11, 0.62, wallLength / 2).setFriction(0.85), body);
  }

  const ring = shadowed(new THREE.Mesh(
    new THREE.RingGeometry(ROUND_POOL.radius, ROUND_POOL.radius + 0.32, 96),
    materials.poolEdge,
  ));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ROUND_POOL.x, 0.075, ROUND_POOL.z);
  scene.add(ring);
}

function makeProceduralWaterNormals(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const height = (u, v) => (
    Math.sin((u * 3 + v * 2) * Math.PI * 2) * 0.52 +
    Math.sin((u * 7 - v * 5) * Math.PI * 2) * 0.25 +
    Math.sin((u * 13 + v * 11) * Math.PI * 2) * 0.08
  );
  const step = 1 / size;
  const normal = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = height((u + step) % 1, v) - height((u - step + 1) % 1, v);
      const dy = height(u, (v + step) % 1) - height(u, (v - step + 1) % 1);
      normal.set(-dx * 3.6, 1, -dy * 3.6).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeSubdividedDisc(radius, radialSegments = 18, angularSegments = 96) {
  const positions = [0, 0, 0];
  const normals = [0, 0, 1];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let ring = 1; ring <= radialSegments; ring++) {
    const ringRadius = radius * (ring / radialSegments);
    for (let segment = 0; segment < angularSegments; segment++) {
      const angle = (segment / angularSegments) * Math.PI * 2;
      const x = Math.cos(angle) * ringRadius;
      const y = Math.sin(angle) * ringRadius;
      positions.push(x, y, 0);
      normals.push(0, 0, 1);
      uvs.push(x / (radius * 2) + 0.5, y / (radius * 2) + 0.5);
    }
  }

  for (let segment = 0; segment < angularSegments; segment++) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % angularSegments));
  }
  for (let ring = 2; ring <= radialSegments; ring++) {
    const innerStart = 1 + (ring - 2) * angularSegments;
    const outerStart = 1 + (ring - 1) * angularSegments;
    for (let segment = 0; segment < angularSegments; segment++) {
      const next = (segment + 1) % angularSegments;
      indices.push(
        innerStart + segment, outerStart + segment, outerStart + next,
        innerStart + segment, outerStart + next, innerStart + next,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function addReflectivePoolWater() {
  const rectangle = new THREE.PlaneGeometry(RECT_POOL.width - 0.36, RECT_POOL.depth - 0.36, 24, 16);
  rectangle.translate(RECT_POOL.x, -RECT_POOL.z, 0);
  const circle = makeSubdividedDisc(ROUND_POOL.radius - 0.2);
  circle.translate(ROUND_POOL.x, -ROUND_POOL.z, 0);
  const geometry = mergeGeometries([rectangle, circle], false);
  const water = new Water(geometry, {
    textureWidth: isMobileDevice ? 384 : 768,
    textureHeight: isMobileDevice ? 384 : 768,
    waterNormals: makeProceduralWaterNormals(),
    sunDirection,
    sunColor: '#ffd7aa',
    waterColor: '#2f98a6',
    distortionScale: 2.4,
    alpha: 0.94,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = RECT_POOL.waterY;
  water.material.transparent = true;
  water.material.uniforms.size.value = 1.05;
  water.material.vertexShader = water.material.vertexShader
    .replace(
      'mirrorCoord = modelMatrix * vec4( position, 1.0 );',
      `vec3 wavePosition = position;
      wavePosition.z += sin( wavePosition.x * 2.15 + time * 1.15 ) * 0.022;
      wavePosition.z += sin( wavePosition.y * 2.65 - time * 0.95 ) * 0.016;
      wavePosition.z += sin( ( wavePosition.x + wavePosition.y ) * 3.8 + time * 0.72 ) * 0.008;
      mirrorCoord = modelMatrix * vec4( wavePosition, 1.0 );`,
    )
    .replace(
      'vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );',
      'vec4 mvPosition = modelViewMatrix * vec4( wavePosition, 1.0 );',
    );
  water.material.needsUpdate = true;
  water.renderOrder = 1;
  scene.add(water);
  return water;
}

// Recessed pool openings replace the old unbroken ground collider.
addGroundWithPoolCutouts();
addPools();
const poolWater = addReflectivePoolWater();

// A gently stepped composition beyond the pools.

for (let i = 0; i < 7; i++) {
  addFixedBox({
    size: new THREE.Vector3(5.4, 0.34 + i * 0.02, 1.15),
    position: new THREE.Vector3(-6.8, 0.17 + i * 0.18, -2.3 - i * 1.08),
    material: i % 2 ? materials.rose : materials.coral,
  });
}

function addArch({ x, z, radius, pillarHeight, depth, material, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  scene.add(group);

  const tube = radius * 0.25;
  const arch = shadowed(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 28, 96, Math.PI), material));
  arch.position.y = pillarHeight;
  arch.rotation.x = 0;
  group.add(arch);

  const pillarSize = new THREE.Vector3(tube * 2, pillarHeight, depth);
  for (const side of [-1, 1]) {
    const pillar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(pillarSize.x, pillarSize.y, pillarSize.z), material));
    pillar.position.set(side * radius, pillarHeight / 2, 0);
    group.add(pillar);

    const local = new THREE.Vector3(side * radius, pillarHeight / 2, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    addFixedBox({
      size: pillarSize,
      position: new THREE.Vector3(x + local.x, local.y, z + local.z),
      material,
      rotationY,
    }).visible = false;
  }

  // Three compact collision blocks approximate the curved crown while leaving the opening clear.
  const crownY = pillarHeight + radius * 0.78;
  for (const side of [-1, 0, 1]) {
    const local = new THREE.Vector3(side * radius * 0.58, crownY + (side === 0 ? radius * 0.2 : 0), 0)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    addFixedBox({
      size: new THREE.Vector3(radius * 0.75, tube * 1.8, depth),
      position: new THREE.Vector3(x + local.x, local.y, z + local.z),
      material,
      rotationY,
    }).visible = false;
  }
}

addArch({ x: 0, z: -5, radius: 3.1, pillarHeight: 5.1, depth: 1.5, material: materials.gold });
addArch({ x: 7.2, z: -12, radius: 2.0, pillarHeight: 2.8, depth: 1.35, material: materials.coral, rotationY: -0.3 });
addArch({ x: -8.4, z: -15, radius: 2.3, pillarHeight: 3.7, depth: 1.5, material: materials.rose, rotationY: 0.42 });

function makeProceduralWoodMaterial({ name, light, mid, dark, roughness, clearcoat }) {
  const lightColor = new THREE.Color(light);
  const midColor = new THREE.Color(mid);
  const darkColor = new THREE.Color(dark);
  const glslColor = (color) => `vec3(${color.r.toFixed(5)}, ${color.g.toFixed(5)}, ${color.b.toFixed(5)})`;
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.92,
  });
  material.name = `${name} procedural wood`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWoodPosition;
        varying vec3 vWoodNormal;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWoodPosition = position;
        vWoodNormal = normal;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWoodPosition;
        varying vec3 vWoodNormal;

        float woodPattern(vec3 p, vec3 n) {
          float slowWarp = sin(p.x * 1.8 + sin(p.z * 4.2)) * 0.22;
          float fineWarp = sin(p.x * 5.4 - p.y * 7.0 + p.z * 3.1) * 0.075;
          vec2 heart = p.yz + vec2(sin(p.x * 1.25), cos(p.x * 1.05)) * 0.055;
          float ringCoord = length(heart) * 35.0 + slowWarp * 5.0 + fineWarp * 2.0;
          float endRings = 0.5 + 0.5 * sin(ringCoord);
          float sideCoord = (p.y * 28.0 + p.z * 17.0) + slowWarp * 8.0 + sin(p.x * 3.0) * 1.2;
          float sideGrain = 0.5 + 0.5 * sin(sideCoord);
          sideGrain = mix(sideGrain, 0.5 + 0.5 * sin(sideCoord * 0.47 + 1.7), 0.34);
          float endFace = smoothstep(0.58, 0.88, abs(normalize(n).x));
          float grain = mix(sideGrain, endRings, endFace);
          float pore = 0.5 + 0.5 * sin(p.x * 31.0 + p.y * 83.0 - p.z * 57.0);
          return clamp(grain * 0.83 + pow(pore, 12.0) * 0.24, 0.0, 1.0);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float woodGrain = woodPattern(vWoodPosition, vWoodNormal);
        vec3 woodLight = ${glslColor(lightColor)};
        vec3 woodMid = ${glslColor(midColor)};
        vec3 woodDark = ${glslColor(darkColor)};
        vec3 woodColor = mix(woodLight, woodMid, smoothstep(0.18, 0.72, woodGrain));
        woodColor = mix(woodColor, woodDark, smoothstep(0.78, 0.98, woodGrain));
        diffuseColor.rgb *= woodColor;
      `);
  };
  material.customProgramCacheKey = () => `game-dream-wood-${name}-v1`;
  return material;
}

const woodMaterials = {
  oak: makeProceduralWoodMaterial({
    name: 'white-oak', light: '#d8b77c', mid: '#9a6838', dark: '#4a2a16', roughness: 0.48, clearcoat: 0.34,
  }),
  walnut: makeProceduralWoodMaterial({
    name: 'black-walnut', light: '#8b5b3f', mid: '#47291f', dark: '#170d0b', roughness: 0.4, clearcoat: 0.52,
  }),
  cherry: makeProceduralWoodMaterial({
    name: 'cherry', light: '#d79069', mid: '#97472f', dark: '#4d1c1c', roughness: 0.43, clearcoat: 0.46,
  }),
};

const WOOD_BLOCK_SIZE = new THREE.Vector3(2.5, 0.54, 0.86);
const woodBlockGeometry = new RoundedBoxGeometry(
  WOOD_BLOCK_SIZE.x,
  WOOD_BLOCK_SIZE.y,
  WOOD_BLOCK_SIZE.z,
  isMobileDevice ? 3 : 5,
  0.065,
);
const floatingWoodBlocks = [];

function addFloatingWoodBlock({ x, y, z, rotationY, material, phase, tower }) {
  const mesh = shadowed(new THREE.Mesh(woodBlockGeometry, material));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  scene.add(mesh);

  const rotation = { x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) };
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y, z)
      .setRotation(rotation),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(WOOD_BLOCK_SIZE.x / 2, WOOD_BLOCK_SIZE.y / 2, WOOD_BLOCK_SIZE.z / 2)
      .setFriction(1.2)
      .setRestitution(0.02),
    body,
  );
  floatingWoodBlocks.push({ mesh, body, base: new THREE.Vector3(x, y, z), phase, tower });
}

const woodTowerDefinitions = [
  { name: 'Oak Steps', species: 'white oak', x: -4.7, z: 1.1, baseY: 1.12, count: 3, phase: 0.1, material: woodMaterials.oak },
  { name: 'Walnut Stack', species: 'black walnut', x: 4.35, z: -1.35, baseY: 1.38, count: 4, phase: 2.15, material: woodMaterials.walnut },
  { name: 'Cherry Pair', species: 'cherry', x: -0.85, z: -9.2, baseY: 1.28, count: 2, phase: 4.3, material: woodMaterials.cherry },
];

for (const tower of woodTowerDefinitions) {
  for (let level = 0; level < tower.count; level++) {
    const crossed = level % 2 === 1;
    addFloatingWoodBlock({
      x: tower.x + (crossed ? 0.08 : -0.05),
      y: tower.baseY + level * 0.59,
      z: tower.z + (crossed ? -0.04 : 0.06),
      rotationY: crossed ? Math.PI / 2 + 0.035 : -0.035,
      material: tower.material,
      phase: tower.phase,
      tower: tower.name,
    });
  }
}

function updateFloatingWoodPhysics(time) {
  for (const block of floatingWoodBlocks) {
    const y = block.base.y + Math.sin(time * 0.82 + block.phase) * 0.14;
    block.body.setNextKinematicTranslation({ x: block.base.x, y, z: block.base.z });
  }
}

const RACE_ORIGIN_X = 80;
const RACE_START_Z = 26;
const RACE_LENGTH = 6500;
const RACE_HALF_WIDTH = 6.2;
const TRACK_STEP = isMobileDevice ? 6 : 4;
const TRACK_LOOPS = [
  { start: 2200, length: 176, radius: 28, xOffset: 18, name: 'Sun Loop' },
  { start: 4920, length: 208, radius: 33, xOffset: -22, name: 'Neon Loop' },
];
const COURSE_SECTIONS = [
  { name: 'Sky Launch', start: 0, end: 350, speed: 34, coinSpacing: 15, hazardSpacing: 170, pattern: 'warmup', intensity: 1 },
  { name: 'Ribbon Run', start: 350, end: 850, speed: 39, coinSpacing: 14, hazardSpacing: 92, pattern: 'ribbon', intensity: 2 },
  { name: 'High Banks', start: 850, end: 1350, speed: 43, coinSpacing: 14, hazardSpacing: 82, pattern: 'banks', intensity: 3 },
  { name: 'Needle Gates', start: 1350, end: 1850, speed: 47, coinSpacing: 13, hazardSpacing: 68, pattern: 'gates', intensity: 4 },
  { name: 'Golden Breather', start: 1850, end: 2150, speed: 38, coinSpacing: 16, hazardSpacing: 0, pattern: 'breather', intensity: 1 },
  { name: 'Roller Rhythm', start: 2150, end: 2800, speed: 45, coinSpacing: 14, hazardSpacing: 78, pattern: 'rollers', intensity: 3 },
  { name: 'Split Decision', start: 2800, end: 3350, speed: 48, coinSpacing: 16, hazardSpacing: 72, pattern: 'split', intensity: 4 },
  { name: 'Cloudline Sprint', start: 3350, end: 3900, speed: 52, coinSpacing: 14, hazardSpacing: 88, pattern: 'sprint', intensity: 3 },
  { name: 'Shield Gauntlet', start: 3900, end: 4450, speed: 46, coinSpacing: 13, hazardSpacing: 62, pattern: 'shield', intensity: 5 },
  { name: 'Crosswind Chicane', start: 4450, end: 5050, speed: 50, coinSpacing: 13, hazardSpacing: 66, pattern: 'chicane', intensity: 5 },
  { name: 'The Long Dive', start: 5050, end: 5650, speed: 56, coinSpacing: 15, hazardSpacing: 98, pattern: 'dive', intensity: 3 },
  { name: 'Final Circuit', start: 5650, end: 6200, speed: 52, coinSpacing: 12, hazardSpacing: 58, pattern: 'circuit', intensity: 5 },
  { name: 'Home Stretch', start: 6200, end: 6500, speed: 60, coinSpacing: 11, hazardSpacing: 74, pattern: 'finale', intensity: 4 },
];
const RACE_CHECKPOINT_DISTANCES = COURSE_SECTIONS.slice(0, -1).map((section) => section.end);
const raceGroup = new THREE.Group();
raceGroup.visible = false;
scene.add(raceGroup);

function raceSectionAtDistance(distance) {
  return COURSE_SECTIONS.find((section) => distance < section.end) || COURSE_SECTIONS[COURSE_SECTIONS.length - 1];
}

function trackTurnAt(distance) {
  const section = raceSectionAtDistance(distance);
  const broad = Math.sin(distance / 310) * 0.48 + Math.sin(distance / 118 + 0.7) * 0.18;
  if (section.pattern === 'chicane') return broad + Math.sin((distance - section.start) / 48) * 0.34;
  if (section.pattern === 'circuit') return broad + Math.sin((distance - section.start) / 72) * 0.28;
  if (section.pattern === 'banks') return broad + Math.sin((distance - section.start) / 105) * 0.22;
  return broad;
}

function trackSlopeAt(distance) {
  const section = raceSectionAtDistance(distance);
  const base = -0.178 + Math.sin(distance / 173) * 0.035;
  if (section.pattern === 'rollers') return base + Math.sin((distance - section.start) / 23) * 0.28;
  if (section.pattern === 'dive') return -0.27 + Math.sin((distance - section.start) / 61) * 0.055;
  if (section.pattern === 'breather') return -0.09 + Math.sin(distance / 80) * 0.025;
  return base;
}

function createRaceTrackSamples() {
  const samples = [];
  const cursor = new THREE.Vector3(RACE_ORIGIN_X, 720, RACE_START_Z);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const loopStates = new Map();
  const sampleCount = Math.ceil(RACE_LENGTH / TRACK_STEP);

  for (let index = 0; index <= sampleCount; index++) {
    const distance = Math.min(RACE_LENGTH, index * TRACK_STEP);
    const loop = TRACK_LOOPS.find((entry) => distance >= entry.start && distance <= entry.start + entry.length);
    let center;
    let tangent;
    let right;
    let up;
    let bank = 0;
    let loopProgress = null;
    let loopXOffset = 0;

    if (loop) {
      if (!loopStates.has(loop.start)) {
        const yaw = trackTurnAt(loop.start);
        const loopForward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
        const loopRight = new THREE.Vector3().crossVectors(loopForward, worldUp).normalize();
        loopStates.set(loop.start, { start: cursor.clone(), forward: loopForward, right: loopRight });
      }
      const loopState = loopStates.get(loop.start);
      const t = THREE.MathUtils.clamp((distance - loop.start) / loop.length, 0, 1);
      loopProgress = t;
      const angle = -Math.PI / 2 + t * Math.PI * 2;
      const xEnvelope = Math.sin(Math.PI * t);
      const xOffset = loop.xOffset * xEnvelope * xEnvelope;
      loopXOffset = xOffset;
      center = loopState.start.clone()
        .addScaledVector(worldUp, loop.radius + Math.sin(angle) * loop.radius)
        .addScaledVector(loopState.forward, Math.cos(angle) * loop.radius)
        .addScaledVector(loopState.right, xOffset);
      const xDerivative = loop.xOffset * Math.PI * Math.sin(Math.PI * 2 * t);
      tangent = worldUp.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(loopState.forward, -Math.sin(angle))
        .multiplyScalar(loop.radius * Math.PI * 2)
        .addScaledVector(loopState.right, xDerivative)
        .normalize();
      // Preserve the same local X axis through the entire rotation. Rebuilding
      // it from world-up flips its sign after the apex and twists the road.
      right = loopState.right.clone()
        .addScaledVector(tangent, -loopState.right.dot(tangent))
        .normalize();
      up = new THREE.Vector3().crossVectors(right, tangent).normalize();
      if (t >= 0.999) cursor.copy(loopState.start);
    } else {
      const yaw = trackTurnAt(distance);
      tangent = new THREE.Vector3(Math.sin(yaw), trackSlopeAt(distance), -Math.cos(yaw)).normalize();
      right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).normalize();
      up = new THREE.Vector3().crossVectors(right, tangent).normalize();
      const section = raceSectionAtDistance(distance);
      const closestLoopSeam = TRACK_LOOPS.reduce((closest, entry) => Math.min(
        closest,
        Math.abs(distance - entry.start),
        Math.abs(distance - (entry.start + entry.length)),
      ), Infinity);
      const loopBankBlend = THREE.MathUtils.smoothstep(closestLoopSeam, 0, 64);
      bank = -Math.sin(distance / 104) * (0.08 + section.intensity * 0.035) * loopBankBlend;
      right.applyAxisAngle(tangent, bank).normalize();
      up.crossVectors(right, tangent).normalize();
      center = cursor.clone();
    }

    samples.push({ distance, center, tangent, right, up, bank, loop: loop?.name || null, loopProgress, loopXOffset });

    const nextDistance = Math.min(RACE_LENGTH, distance + TRACK_STEP);
    const inLoop = TRACK_LOOPS.some((entry) => nextDistance > entry.start && nextDistance <= entry.start + entry.length);
    if (!inLoop && nextDistance > distance) {
      cursor.addScaledVector(tangent, nextDistance - distance);
    }
  }
  return samples;
}

const raceTrackSamples = createRaceTrackSamples();
const raceBasisForward = new THREE.Vector3();
const raceFrame = {
  center: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(),
  bank: 0, loop: null, loopProgress: null, loopXOffset: 0,
};

function makeRaceBasis(frame, target = new THREE.Matrix4()) {
  // A Three.js rotation matrix must be right-handed. The authored travel tangent
  // points down-course, so local +Z points backward while local -Z points forward.
  return target.makeBasis(frame.right, frame.up, raceBasisForward.copy(frame.tangent).negate());
}

function getRaceFrame(distance, target = raceFrame) {
  const clamped = THREE.MathUtils.clamp(distance, 0, RACE_LENGTH);
  const scaled = clamped / TRACK_STEP;
  const index = Math.min(raceTrackSamples.length - 2, Math.floor(scaled));
  const alpha = THREE.MathUtils.clamp(scaled - index, 0, 1);
  const a = raceTrackSamples[index];
  const b = raceTrackSamples[index + 1] || a;
  target.center.copy(a.center).lerp(b.center, alpha);
  target.tangent.copy(a.tangent).lerp(b.tangent, alpha).normalize();
  target.right.copy(a.right).lerp(b.right, alpha).normalize();
  target.up.copy(a.up).lerp(b.up, alpha).normalize();
  target.bank = THREE.MathUtils.lerp(a.bank, b.bank, alpha);
  target.loop = alpha < 0.5 ? a.loop : b.loop;
  target.loopProgress = a.loopProgress === null || b.loopProgress === null
    ? (alpha < 0.5 ? a.loopProgress : b.loopProgress)
    : THREE.MathUtils.lerp(a.loopProgress, b.loopProgress, alpha);
  target.loopXOffset = THREE.MathUtils.lerp(a.loopXOffset, b.loopXOffset, alpha);
  return target;
}

function trackRiseAt(lateral) {
  const normalized = THREE.MathUtils.clamp(lateral / RACE_HALF_WIDTH, -1, 1);
  return normalized * normalized * 3.45;
}

function racePointAt(distance, lateral = 0, lift = 0, target = new THREE.Vector3()) {
  const frame = getRaceFrame(distance);
  return target.copy(frame.center)
    .addScaledVector(frame.right, lateral)
    .addScaledVector(frame.up, trackRiseAt(lateral) + lift);
}

function createRaceTrackGeometry() {
  const xSegments = isMobileDevice ? 10 : 14;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let zi = 0; zi < raceTrackSamples.length; zi++) {
    const frame = raceTrackSamples[zi];
    for (let xi = 0; xi <= xSegments; xi++) {
      const xT = xi / xSegments;
      const lateral = THREE.MathUtils.lerp(-RACE_HALF_WIDTH, RACE_HALF_WIDTH, xT);
      const point = frame.center.clone()
        .addScaledVector(frame.right, lateral)
        .addScaledVector(frame.up, trackRiseAt(lateral));
      positions.push(point.x, point.y, point.z);
      uvs.push(xT, frame.distance / 12);
    }
  }
  const row = xSegments + 1;
  for (let zi = 0; zi < raceTrackSamples.length - 1; zi++) {
    for (let xi = 0; xi < xSegments; xi++) {
      const a = zi * row + xi;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const raceTrackGeometry = createRaceTrackGeometry();
const raceTrackMaterial = new THREE.MeshPhysicalMaterial({
  color: '#112a3c',
  roughness: 0.48,
  metalness: 0,
  clearcoat: 0.24,
  clearcoatRoughness: 0.38,
  envMapIntensity: 0.82,
  side: THREE.DoubleSide,
});
raceTrackMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vRaceUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRaceUv = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vRaceUv;')
    .replace(
    '#include <color_fragment>',
    `#include <color_fragment>
      float courseProgress = clamp(vRaceUv.y / ${(RACE_LENGTH / 12).toFixed(5)}, 0.0, 1.0);
      float edge = smoothstep(0.34, 0.48, abs(vRaceUv.x - 0.5));
      float centerStripe = 1.0 - smoothstep(0.018, 0.038, abs(vRaceUv.x - 0.5));
      float dash = smoothstep(0.28, 0.42, sin(vRaceUv.y * 3.14159) * 0.5 + 0.5);
      vec2 gritCell = floor(vRaceUv * vec2(92.0, 2.6));
      float grit = fract(sin(dot(gritCell, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 navy = mix(vec3(0.025, 0.075, 0.12), vec3(0.055, 0.15, 0.20), courseProgress);
      vec3 cyanEdge = vec3(0.04, 0.82, 0.92);
      diffuseColor.rgb = navy + (grit - 0.5) * 0.018;
      diffuseColor.rgb = mix(diffuseColor.rgb, cyanEdge, edge * 0.26);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.64, 0.16), centerStripe * dash * 0.95);
    `,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (grit - 0.5) * 0.11, 0.32, 0.7);',
  );
};
raceTrackMaterial.customProgramCacheKey = () => 'game-dream-race-track-v3';
const raceTrack = new THREE.Mesh(raceTrackGeometry, raceTrackMaterial);
raceTrack.receiveShadow = true;
raceGroup.add(raceTrack);

const railMaterial = new THREE.MeshPhysicalMaterial({
  color: '#2bf1ef', emissive: '#087f91', emissiveIntensity: 1.15,
  roughness: 0.22, clearcoat: 0.85, clearcoatRoughness: 0.12,
  side: THREE.DoubleSide,
});

function createTrackEdgeGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const side of [-1, 1]) {
    const vertexOffset = positions.length / 3;
    for (const frame of raceTrackSamples) {
      for (const inset of [0.28, 0]) {
        const lateral = side * (RACE_HALF_WIDTH - inset);
        const point = frame.center.clone()
          .addScaledVector(frame.right, lateral)
          .addScaledVector(frame.up, trackRiseAt(lateral) + 0.055);
        positions.push(point.x, point.y, point.z);
        uvs.push(inset ? 0 : 1, frame.distance / 20);
      }
    }
    for (let index = 0; index < raceTrackSamples.length - 1; index++) {
      const a = vertexOffset + index * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const raceRails = new THREE.Mesh(createTrackEdgeGeometry(), railMaterial);
raceRails.frustumCulled = false;
raceGroup.add(raceRails);

// The race landscape is generated in the same moving track frame as the road.
// This lets the canyon follow every authored turn without shipping a terrain asset.
const terrainNoise = new ImprovedNoise();
const monumentalConcrete = new THREE.MeshStandardMaterial({
  color: '#31394d', roughness: 0.88, metalness: 0.02, envMapIntensity: 0.32,
});
const blackConcrete = new THREE.MeshStandardMaterial({
  color: '#111522', roughness: 0.94, metalness: 0.01, envMapIntensity: 0.2,
});
const glossyMonumentMetal = new THREE.MeshPhysicalMaterial({
  color: '#273f53', emissive: '#061925', emissiveIntensity: 0.28,
  roughness: 0.12, metalness: 0.92, clearcoat: 1, clearcoatRoughness: 0.08,
  envMapIntensity: 1.7,
});
const monumentNeon = new THREE.MeshPhysicalMaterial({
  color: '#ff3bd4', emissive: '#ff078d', emissiveIntensity: 4.2,
  roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08,
});

function terrainHeight(distance, lateral, side) {
  const ridges = terrainNoise.noise(distance * 0.006, lateral * 0.045, side * 7.3);
  const detail = terrainNoise.noise(distance * 0.021 + side * 11.0, lateral * 0.12, 3.7);
  const wallRise = THREE.MathUtils.smoothstep(Math.abs(lateral), 11, 64);
  return 2.5 + wallRise * (28 + ridges * 17 + detail * 7);
}

function createProceduralCanyonGeometry() {
  const lateralBands = [10, 15, 23, 34, 48, 66];
  const positions = [];
  const colors = [];
  const indices = [];
  const rows = raceTrackSamples.length;

  for (const side of [-1, 1]) {
    const vertexOffset = positions.length / 3;
    for (const frame of raceTrackSamples) {
      for (let band = 0; band < lateralBands.length; band++) {
        const lateral = lateralBands[band] * side;
        const height = terrainHeight(frame.distance, lateral, side);
        const point = frame.center.clone()
          .addScaledVector(frame.right, lateral)
          .addScaledVector(frame.up, height - 6 + band * 0.7);
        positions.push(point.x, point.y, point.z);
        const glow = THREE.MathUtils.clamp((height - 10) / 48, 0, 1);
        colors.push(0.055 + glow * 0.045, 0.075 + glow * 0.055, 0.14 + glow * 0.09);
      }
    }

    for (let row = 0; row < rows - 1; row++) {
      const aFrame = raceTrackSamples[row];
      const bFrame = raceTrackSamples[row + 1];
      // Leave clean air around the two vertical loops instead of twisting terrain through them.
      if (aFrame.loop || bFrame.loop) continue;
      for (let band = 0; band < lateralBands.length - 1; band++) {
        const a = vertexOffset + row * lateralBands.length + band;
        const b = a + 1;
        const c = a + lateralBands.length;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const canyonMaterial = new THREE.MeshStandardMaterial({
  color: '#17233c', vertexColors: true, roughness: 0.96, metalness: 0.02,
  envMapIntensity: 0.18, side: THREE.DoubleSide, flatShading: true,
});
const raceCanyon = new THREE.Mesh(createProceduralCanyonGeometry(), canyonMaterial);
raceCanyon.receiveShadow = true;
raceCanyon.frustumCulled = false;
raceGroup.add(raceCanyon);

function addMonumentArch(distance, radius, pillarHeight, depth, material = monumentalConcrete) {
  const group = new THREE.Group();
  const tube = Math.max(1.7, radius * 0.16);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 64, Math.PI), material);
  arch.position.y = pillarHeight;
  arch.scale.z = depth / (tube * 2);
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(tube * 2, pillarHeight, depth),
      side > 0 ? material : blackConcrete,
    );
    pillar.position.set(side * radius, pillarHeight / 2, 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);
  }

  const innerHalo = new THREE.Mesh(
    new THREE.TorusGeometry(radius - tube * 0.78, Math.max(0.16, tube * 0.085), 8, 64, Math.PI),
    monumentNeon,
  );
  innerHalo.position.set(0, pillarHeight, -depth * 0.52);
  group.add(innerHalo);
  orientRaceObject(group, distance);
  raceGroup.add(group);
  return group;
}

function addMonolithWall(distance, side, width, height, depth, yaw = 0) {
  const frame = getRaceFrame(distance);
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    side > 0 ? glossyMonumentMetal : monumentalConcrete,
  );
  wall.position.copy(frame.center)
    .addScaledVector(frame.right, side * (RACE_HALF_WIDTH + 10 + width * 0.2))
    .addScaledVector(frame.up, height * 0.42);
  wall.quaternion.setFromRotationMatrix(makeRaceBasis(frame));
  wall.rotateY(yaw);
  wall.castShadow = true;
  wall.receiveShadow = true;
  raceGroup.add(wall);
}

[
  [210, 15, 17, 8],
  [1180, 22, 24, 11],
  [2010, 28, 30, 14],
  [3320, 19, 22, 9],
  [4380, 30, 34, 15],
  [5740, 24, 28, 12],
  [6280, 34, 38, 17],
].forEach(([distance, radius, height, depth], index) => {
  addMonumentArch(distance, radius, height, depth, index % 3 === 1 ? glossyMonumentMetal : monumentalConcrete);
});

for (let distance = 520, index = 0; distance < RACE_LENGTH - 260; distance += 430, index++) {
  if (TRACK_LOOPS.some((loop) => Math.abs(distance - (loop.start + loop.length / 2)) < loop.length)) continue;
  addMonolithWall(distance, index % 2 ? 1 : -1, 9 + (index % 3) * 4, 24 + (index % 4) * 9, 12 + (index % 2) * 8, (index % 3 - 1) * 0.18);
}

const raceSkyUniforms = {
  time: { value: 0 },
};
const raceSkyMaterial = new THREE.ShaderMaterial({
  uniforms: raceSkyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: `varying vec3 vDirection; void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec3 vDirection;
    uniform float time;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float noise(vec3 p) {
      vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y), mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    void main() {
      vec3 d = normalize(vDirection);
      float horizon = pow(clamp(1.0 - abs(d.y + 0.08), 0.0, 1.0), 4.0);
      float cloudNoise = noise(d * 5.2 + vec3(0.0, time * 0.002, 0.0)) * 0.62 + noise(d * 13.0) * 0.38;
      float cloud = smoothstep(0.68, 0.88, cloudNoise) * smoothstep(-0.38, 0.08, d.y);
      float starCell = hash(floor(d * 520.0));
      float stars = step(0.992, starCell) * pow(starCell, 18.0) * smoothstep(-0.12, 0.18, d.y);
      vec3 color = mix(vec3(0.005, 0.012, 0.055), vec3(0.018, 0.075, 0.18), max(d.y, 0.0));
      color += vec3(0.08, 0.01, 0.16) * horizon;
      color += cloud * vec3(0.42, 0.018, 0.27) * (0.18 + horizon * 0.82);
      color += stars * mix(vec3(0.35, 0.8, 1.0), vec3(1.0, 0.25, 0.72), hash(floor(d * 311.0))) * 2.8;
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const raceSkyDome = new THREE.Mesh(new THREE.SphereGeometry(210, 32, 20), raceSkyMaterial);
raceSkyDome.visible = false;
raceSkyDome.renderOrder = -10;
scene.add(raceSkyDome);

const moonMaterial = new THREE.MeshBasicMaterial({ color: '#58efff', transparent: true, opacity: 0.92 });
const raceMoon = new THREE.Mesh(new THREE.SphereGeometry(19, 32, 20), moonMaterial);
raceMoon.visible = false;
scene.add(raceMoon);

const raceGateMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffb31a', emissive: '#9b4500', emissiveIntensity: 0.45, roughness: 0.24, clearcoat: 0.78, clearcoatRoughness: 0.14, envMapIntensity: 1.25 });
const finishDarkMaterial = new THREE.MeshStandardMaterial({ color: '#071721', roughness: 0.42 });
const finishLightMaterial = new THREE.MeshStandardMaterial({ color: '#fff1d4', roughness: 0.42 });

function orientRaceObject(object, distance) {
  const frame = getRaceFrame(distance);
  const basis = makeRaceBasis(frame);
  object.quaternion.setFromRotationMatrix(basis);
  object.position.copy(frame.center);
  return object;
}

function addRaceGate(distance, finish = false) {
  const group = new THREE.Group();
  const postHeight = 3.0;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.26, postHeight, 0.34, 3, 0.06), finish ? finishDarkMaterial : raceGateMaterial);
    post.position.set(side * (RACE_HALF_WIDTH - 0.2), trackRiseAt(RACE_HALF_WIDTH) + postHeight / 2, 0);
    post.castShadow = true;
    group.add(post);
  }
  const beam = new THREE.Mesh(new RoundedBoxGeometry(RACE_HALF_WIDTH * 2, 0.34, 0.42, 3, 0.07), finish ? finishLightMaterial : raceGateMaterial);
  beam.position.set(0, 6.85, 0);
  beam.castShadow = true;
  group.add(beam);
  if (finish) {
    for (let i = 0; i < 12; i++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.17, 0.44), i % 2 ? finishDarkMaterial : finishLightMaterial);
      tile.position.set(-4.05 + i * 0.74, 6.85, -0.02);
      group.add(tile);
    }
  }
  orientRaceObject(group, distance);
  raceGroup.add(group);
  return group;
}

addRaceGate(2);
RACE_CHECKPOINT_DISTANCES.forEach((distance) => addRaceGate(distance));
addRaceGate(RACE_LENGTH - 2, true);

const raceCoins = [];
const coinGeometry = new THREE.TorusGeometry(0.32, 0.105, 10, 24);
const coinMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffd659', emissive: '#b95d12', emissiveIntensity: 0.42, roughness: 0.22, metalness: 0.46, clearcoat: 0.8, clearcoatRoughness: 0.12 });

function coinLaneFor(section, index, t) {
  switch (section.pattern) {
    case 'warmup': return t < 0.28 ? 0 : Math.sin(t * Math.PI * 5) * 2.7;
    case 'ribbon': return Math.sin(t * Math.PI * 8) * 3.3;
    case 'banks': return Math.floor(index / 7) % 2 ? 4.25 : -4.25;
    case 'gates': return [-3.35, 0, 3.35, 0][Math.floor(index / 4) % 4];
    case 'breather': return Math.sin(t * Math.PI * 2) * 1.15;
    case 'rollers': return Math.sin(t * Math.PI * 10) * 2.85;
    case 'split': return Math.floor(index / 5) % 2 ? 3.8 : -3.8;
    case 'sprint': return Math.sin(t * Math.PI * 5 + 0.6) * 2.2;
    case 'shield': return [-3.7, -1.3, 1.3, 3.7][Math.floor(index / 5) % 4];
    case 'chicane': return [-3.8, 3.8, 1.4, -1.4][Math.floor(index / 4) % 4];
    case 'dive': return Math.sin(t * Math.PI * 3) * 1.7;
    case 'circuit': return Math.sin(t * Math.PI * 12) * 3.65;
    case 'finale': return [0, -3.6, 3.6, 0][Math.floor(index / 4) % 4];
    default: return 0;
  }
}

function coinLiftFor(section, index) {
  if (section.pattern === 'rollers' || section.pattern === 'dive') {
    return 0.95 + Math.sin((index % 9) / 8 * Math.PI) * 1.8;
  }
  if (section.pattern === 'circuit' && index % 14 > 8) return 2.2;
  return 0.92;
}

function addRaceCoin(localX, distance, lift = 0.92) {
  raceCoins.push({
    position: racePointAt(distance, localX, lift, new THREE.Vector3()),
    collected: false,
    localX,
    distance,
    lift,
    phase: raceCoins.length * 0.37,
  });
}

for (const section of COURSE_SECTIONS) {
  let index = 0;
  const safeStart = section.start + (section.pattern === 'warmup' ? 36 : 22);
  for (let distance = safeStart; distance < section.end - 18; distance += section.coinSpacing) {
    const t = (distance - section.start) / (section.end - section.start);
    const lane = coinLaneFor(section, index, t);
    addRaceCoin(lane, distance, coinLiftFor(section, index));
    // Split Decision deliberately offers two visible risk/reward lines.
    if (section.pattern === 'split' && index % 3 === 0) addRaceCoin(-lane, distance, 0.92);
    index += 1;
  }
}

const raceObjectMatrix = new THREE.Matrix4();
const raceObjectQuaternion = new THREE.Quaternion();
const raceObjectScale = new THREE.Vector3(1, 1, 1);
const raceCoinMesh = new THREE.InstancedMesh(coinGeometry, coinMaterial, raceCoins.length);
raceCoinMesh.castShadow = true;
raceCoinMesh.frustumCulled = false;
raceGroup.add(raceCoinMesh);

function setRaceCoinInstance(coin, index, spin = 0) {
  const frame = getRaceFrame(coin.distance);
  const basis = makeRaceBasis(frame);
  raceObjectQuaternion.setFromRotationMatrix(basis);
  const spinQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin + coin.phase);
  raceObjectQuaternion.multiply(spinQuaternion);
  raceObjectScale.setScalar(coin.collected ? 0 : 1);
  raceObjectMatrix.compose(coin.position, raceObjectQuaternion, raceObjectScale);
  raceCoinMesh.setMatrixAt(index, raceObjectMatrix);
}

raceCoins.forEach((coin, index) => setRaceCoinInstance(coin, index));
raceCoinMesh.instanceMatrix.needsUpdate = true;

const obstacleMaterial = new THREE.MeshPhysicalMaterial({ color: '#f12b6b', emissive: '#7c092f', emissiveIntensity: 0.72, roughness: 0.3, clearcoat: 0.72, clearcoatRoughness: 0.16 });
const raceObstacles = [];

function obstacleLaneFor(section, index) {
  const lanes = section.pattern === 'shield'
    ? [0, -2.8, 2.8, -1.4, 1.4]
    : (section.pattern === 'chicane' || section.pattern === 'circuit'
      ? [-3.4, 3.4, 0, 2.0, -2.0]
      : [0, 2.8, -2.8, 1.35, -1.35]);
  return lanes[(index + section.intensity) % lanes.length];
}

for (const section of COURSE_SECTIONS) {
  if (!section.hazardSpacing) continue;
  let index = 0;
  const firstHazard = section.start + (section.pattern === 'warmup' ? 235 : 64);
  for (let distance = firstHazard; distance < section.end - 34; distance += section.hazardSpacing) {
    const localX = obstacleLaneFor(section, index);
    const wide = (index + section.intensity) % 5 === 0;
    raceObstacles.push({
      position: racePointAt(distance, localX, 0.72, new THREE.Vector3()),
      distance,
      localX,
      halfX: wide ? 1.18 : 0.82,
      scaleX: wide ? 1.42 : 1,
      phase: index * 0.8 + section.intensity,
    });
    index += 1;
  }
}

const obstacleGeometry = new RoundedBoxGeometry(1.6, 1.45, 0.82, isMobileDevice ? 2 : 4, 0.14);
const raceObstacleMesh = new THREE.InstancedMesh(obstacleGeometry, obstacleMaterial, raceObstacles.length);
raceObstacleMesh.castShadow = true;
raceObstacleMesh.receiveShadow = true;
raceObstacleMesh.frustumCulled = false;
raceObstacles.forEach((obstacle, index) => {
  const frame = getRaceFrame(obstacle.distance);
  raceObjectQuaternion.setFromRotationMatrix(makeRaceBasis(frame));
  raceObjectScale.set(obstacle.scaleX, 1, 1);
  raceObjectMatrix.compose(obstacle.position, raceObjectQuaternion, raceObjectScale);
  raceObstacleMesh.setMatrixAt(index, raceObjectMatrix);
});
raceObstacleMesh.instanceMatrix.needsUpdate = true;
raceGroup.add(raceObstacleMesh);

const shieldMaterial = new THREE.MeshPhysicalMaterial({ color: '#7feaf5', emissive: '#147a9b', emissiveIntensity: 0.8, roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, transmission: 0.15, thickness: 0.5 });
const raceShields = [];
for (const shield of [
  { x: 3.4, distance: 1080 }, { x: -3.4, distance: 2025 }, { x: 0, distance: 3160 },
  { x: -3.2, distance: 4015 }, { x: 3.2, distance: 4775 }, { x: 0, distance: 5750 },
]) {
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 2), shieldMaterial);
  mesh.position.copy(racePointAt(shield.distance, shield.x, 1.05, new THREE.Vector3()));
  orientRaceObject(mesh, shield.distance);
  mesh.position.copy(racePointAt(shield.distance, shield.x, 1.05, new THREE.Vector3()));
  mesh.castShadow = true;
  raceGroup.add(mesh);
  raceShields.push({ ...shield, basePosition: mesh.position.clone(), mesh, collected: false });
}

// Paired hoops announce each pacing beat before its mechanics arrive.
const hoopMaterial = new THREE.MeshStandardMaterial({ color: '#ff8d28', emissive: '#7c2900', emissiveIntensity: 0.42, roughness: 0.38, envMapIntensity: 0.8 });
const hoopGeometry = new THREE.TorusGeometry(RACE_HALF_WIDTH + 0.55, 0.16, 10, 48, Math.PI);
for (const section of COURSE_SECTIONS) {
  const distances = [section.start + 18, (section.start + section.end) / 2];
  for (const distance of distances) {
    const hoop = new THREE.Mesh(hoopGeometry, hoopMaterial);
    orientRaceObject(hoop, distance);
    hoop.position.copy(racePointAt(distance, 0, 1.05, new THREE.Vector3()));
    hoop.castShadow = true;
    raceGroup.add(hoop);
  }
}

// A texture-free cloud shelf below the first half makes the 720-unit launch altitude legible.
const cloudMaterial = new THREE.MeshPhysicalMaterial({
  color: '#351033', emissive: '#c20a73', emissiveIntensity: 0.42,
  roughness: 0.96, metalness: 0, transparent: true, opacity: 0.2,
  depthWrite: false, envMapIntensity: 0.08,
});
const cloudPuffs = [];
for (let distance = 90, index = 0; distance < 3350; distance += 48, index++) {
  for (const side of [-1, 1]) {
    const spread = 16 + (index % 5) * 5;
    const frame = getRaceFrame(distance);
    const position = frame.center.clone()
      .addScaledVector(frame.right, side * (spread + 5))
      .addScaledVector(frame.up, 10 + (index % 4) * 6)
      .addScaledVector(frame.tangent, side > 0 ? 11 : -9);
    cloudPuffs.push({
      position,
      scale: new THREE.Vector3(5 + index % 4 * 1.6, 3.5 + index % 3, 6 + index % 5 * 1.15),
    });
  }
}
const cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), cloudMaterial, cloudPuffs.length);
cloudMesh.frustumCulled = false;
cloudMesh.renderOrder = 0;
cloudPuffs.forEach((puff, index) => {
  raceObjectQuaternion.identity();
  raceObjectMatrix.compose(puff.position, raceObjectQuaternion, puff.scale);
  cloudMesh.setMatrixAt(index, raceObjectMatrix);
});
cloudMesh.instanceMatrix.needsUpdate = true;
raceGroup.add(cloudMesh);

// Distant graphic forms keep the horizon composed without adding gameplay noise.
for (const [x, z, h, color] of [[-15, -21, 7, materials.coral], [14, -24, 10, materials.rose], [1, -30, 5, materials.gold]]) {
  const tower = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 3.2), color));
  tower.position.set(x, h / 2, z);
  scene.add(tower);
}

const playerBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 1.4, 5.5)
    .setLinearDamping(0.08)
    .setAngularDamping(0.1)
    .setCcdEnabled(true)
);
const playerCollider = world.createCollider(
  RAPIER.ColliderDesc.ball(PLAYER_RADIUS).setDensity(1.15).setFriction(2.55).setRestitution(0.03),
  playerBody
);

const ballMaterial = new THREE.MeshPhysicalMaterial({
  color: '#fff8ed',
  roughness: 0.14,
  metalness: 0,
  ior: 1.48,
  reflectivity: 0.72,
  clearcoat: 1,
  clearcoatRoughness: 0.035,
  sheen: 0.08,
  sheenColor: new THREE.Color('#ffd5ca'),
  envMapIntensity: 1.7,
});

ballMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vMarblePosition;
      varying vec3 vMarbleRayDirection;
    `)
    .replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      vMarblePosition = position / ${PLAYER_RADIUS.toFixed(2)};
      vec3 marbleCameraOffset = cameraPosition - vec3(modelMatrix[3]);
      vec3 marbleCameraObject = transpose(mat3(modelMatrix)) * marbleCameraOffset / ${PLAYER_RADIUS.toFixed(2)};
      vMarbleRayDirection = normalize(vMarblePosition - marbleCameraObject);
    `);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vMarblePosition;
      varying vec3 vMarbleRayDirection;

      float marbleSlice(vec3 p) {
        float broadWarp = sin(p.x * 3.1 + p.z * 1.8) + 0.52 * sin(p.y * 5.7 - p.x * 2.2);
        float fineWarp = 0.24 * sin(dot(p, vec3(7.3, -5.1, 6.4)) + sin(p.z * 4.0));
        float sweep = p.y * 3.15 + p.x * 1.35 - p.z * 0.75 + broadWarp * 1.55 + fineWarp;
        float aa = fwidth(sweep);
        float primary = 1.0 - smoothstep(0.07 + aa, 0.34 + aa, abs(sin(sweep)));
        float hairline = 1.0 - smoothstep(0.018 + aa, 0.11 + aa, abs(sin(sweep * 2.11 + 1.35)));
        return clamp(primary * 0.88 + hairline * 0.42, 0.0, 1.0);
      }

      vec3 marchMarble(vec3 rayOrigin, vec3 rayDirection) {
        vec3 p = normalize(rayOrigin);
        float volume = 0.0;
        float weight = 0.0;
        for (int i = 0; i < 4; i++) {
          float fade = 1.0 - float(i) / 5.0;
          volume += marbleSlice(p) * fade;
          weight += fade;
          p += rayDirection * 0.18;
        }
        volume /= weight;
        float surface = marbleSlice(normalize(rayOrigin) * 1.15);
        vec3 ivory = vec3(0.98, 0.91, 0.80);
        vec3 blush = vec3(0.90, 0.40, 0.42);
        vec3 wine = vec3(0.24, 0.035, 0.075);
        vec3 color = mix(ivory, blush, smoothstep(0.08, 0.48, volume) * 0.58);
        color = mix(color, wine, smoothstep(0.20, 0.78, surface) * 0.86);
        return color;
      }
    `)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= marchMarble(vMarblePosition, normalize(vMarbleRayDirection));
    `);
};
ballMaterial.customProgramCacheKey = () => 'game-dream-hard-marble-v1';

const ballSegments = isMobileDevice ? 64 : 128;
const ballGeometry = new THREE.SphereGeometry(PLAYER_RADIUS, ballSegments, ballSegments / 2);
const ball = shadowed(new THREE.Mesh(ballGeometry, ballMaterial));
ball.renderOrder = 2;
scene.add(ball);

const input = { forward: false, back: false, left: false, right: false, touchX: 0, jumpBuffer: 0 };
const state = {
  mode: 'splash', started: false, grounded: false, coyoteTime: 0, jumpCount: 0,
  airJumpCount: 0, lastKey: '', elapsed: 0, yaw: 0, pitch: 0.18,
  dragging: false, fps: 0, touchJumpCooldown: 0,
};
const keyMap = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

function readRecord(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

const race = {
  elapsed: 0,
  countdown: 0,
  coins: 0,
  shield: false,
  checkpointIndex: 0,
  lastCheckpointDistance: 4,
  hitCooldown: 0,
  toastTimer: 0,
  bestTime: readRecord('game-dream-long-course-best-time'),
  bestCoins: readRecord('game-dream-long-course-best-coins'),
  shieldPickups: 0,
  shieldPops: 0,
  coinCrashes: 0,
};

const raceMotor = {
  distance: 4,
  speed: 0,
  lateral: 0,
  lateralVelocity: 0,
  jumpHeight: 0,
  jumpVelocity: 0,
  grounded: true,
  roll: 0,
};

function formatTime(seconds) {
  if (!seconds) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function writeRecords() {
  try {
    localStorage.setItem('game-dream-long-course-best-time', String(race.bestTime));
    localStorage.setItem('game-dream-long-course-best-coins', String(race.bestCoins));
  } catch {
    // Records still live for this session if storage is unavailable.
  }
}

function refreshRecordUI() {
  briefBestTime.textContent = formatTime(race.bestTime);
  briefBestCoins.textContent = String(race.bestCoins);
  finishBest.textContent = formatTime(race.bestTime);
}

function setPanel(panel) {
  for (const item of [splash, raceBriefing, finishPanel]) item.classList.toggle('is-hidden', item !== panel);
}

function showToast(message, duration = 1.25) {
  raceToast.textContent = message;
  raceToast.classList.add('is-visible');
  race.toastTimer = duration;
}

function applyModeLook(racing) {
  renderer.toneMappingExposure = racing ? 0.54 : 0.72;
  scene.environmentIntensity = racing ? 0.22 : 0.58;
  scene.fog.color.set(racing ? '#091027' : '#9fc4ca');
  scene.fog.near = racing ? 105 : 70;
  scene.fog.far = racing ? 330 : 190;
  sun.color.set(racing ? '#8adfff' : '#ffd2a0');
  sun.intensity = racing ? 0.62 : 3.8;
  raceSkyDome.visible = racing;
  raceMoon.visible = racing;
  sky.visible = !racing;
}

let audioContext;
let audioMaster;
let windGain;
let windFilter;

function ensureAudio() {
  if (!audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext = new AudioContext();
    audioMaster = audioContext.createGain();
    audioMaster.gain.value = 0.32;
    audioMaster.connect(audioContext.destination);

    const length = audioContext.sampleRate * 2;
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const noise = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) noise[i] = Math.random() * 2 - 1;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    windFilter = audioContext.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.7;
    windGain = audioContext.createGain();
    windGain.gain.value = 0;
    source.connect(windFilter).connect(windGain).connect(audioMaster);
    source.start();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playTone(frequency, duration = 0.1, type = 'sine', volume = 0.14, delay = 0) {
  ensureAudio();
  if (!audioContext) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audioMaster);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function haptic(pattern) {
  navigator.vibrate?.(pattern);
}

function setRaceBodyMode(enabled) {
  const type = enabled ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic;
  playerBody.setBodyType(type, true);
  playerBody.setGravityScale(enabled ? 0 : 1, true);
  playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function placeRacePlayer(distance = raceMotor.distance, lateral = raceMotor.lateral) {
  raceMotor.distance = THREE.MathUtils.clamp(distance, 0, RACE_LENGTH);
  raceMotor.lateral = THREE.MathUtils.clamp(lateral, -RACE_HALF_WIDTH + PLAYER_RADIUS, RACE_HALF_WIDTH - PLAYER_RADIUS);
  const position = racePointAt(
    raceMotor.distance,
    raceMotor.lateral,
    PLAYER_RADIUS + 0.04 + raceMotor.jumpHeight,
    new THREE.Vector3(),
  );
  playerBody.setTranslation(position, true);
  playerBody.setNextKinematicTranslation(position);
}

function snapRaceCamera() {
  const frame = getRaceFrame(raceMotor.distance);
  const position = racePointAt(raceMotor.distance, raceMotor.lateral, PLAYER_RADIUS + 0.04 + raceMotor.jumpHeight, new THREE.Vector3());
  smoothTarget.copy(position).addScaledVector(frame.up, 1.25).addScaledVector(frame.tangent, 6.4);
  camera.position.copy(position).addScaledVector(frame.tangent, -11.5).addScaledVector(frame.up, 4.4);
  camera.up.copy(frame.up);
  raceCameraUp.copy(frame.up);
  camera.lookAt(smoothTarget);
}

function teleportPlayer(x, z) {
  setRaceBodyMode(false);
  playerBody.setTranslation({ x, y: 1.4, z }, true);
  playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  playerBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  state.touchJumpCooldown = 0;
}

function showSplash() {
  state.mode = 'splash';
  state.started = false;
  raceGroup.visible = false;
  raceHud.classList.add('is-hidden');
  countdown.classList.add('is-hidden');
  applyModeLook(false);
  setPanel(splash);
}

function startFreeMode() {
  ensureAudio();
  state.mode = 'free';
  state.started = true;
  state.yaw = 0;
  state.pitch = 0.18;
  raceGroup.visible = false;
  raceHud.classList.add('is-hidden');
  countdown.classList.add('is-hidden');
  applyModeLook(false);
  setPanel(null);
  camera.up.set(0, 1, 0);
  teleportPlayer(0, 5.5);
  canvas.focus();
}

function showRaceBriefing() {
  ensureAudio();
  state.mode = 'race-briefing';
  state.started = false;
  raceGroup.visible = true;
  raceHud.classList.add('is-hidden');
  countdown.classList.add('is-hidden');
  applyModeLook(true);
  refreshRecordUI();
  setPanel(raceBriefing);
  setRaceBodyMode(true);
  Object.assign(raceMotor, { distance: 4, speed: 0, lateral: 0, lateralVelocity: 0, jumpHeight: 0, jumpVelocity: 0, grounded: true, roll: 0 });
  placeRacePlayer();
  snapRaceCamera();
}

function resetRaceObjects() {
  for (let index = 0; index < raceCoins.length; index++) {
    const coin = raceCoins[index];
    coin.collected = false;
    setRaceCoinInstance(coin, index);
  }
  raceCoinMesh.instanceMatrix.needsUpdate = true;
  for (const shield of raceShields) {
    shield.collected = false;
    shield.mesh.visible = true;
  }
}

function startRace() {
  ensureAudio();
  resetRaceObjects();
  Object.assign(race, {
    elapsed: 0, countdown: debugRaceQuery ? 0.08 : 3.25, coins: 0, shield: false,
    checkpointIndex: 0, lastCheckpointDistance: 4,
    hitCooldown: 0, toastTimer: 0, shieldPickups: 0, shieldPops: 0, coinCrashes: 0,
  });
  const debugStartDistance = debugRaceQuery && Number.isFinite(requestedDebugDistance)
    ? THREE.MathUtils.clamp(requestedDebugDistance, 4, RACE_LENGTH - 1)
    : 4;
  Object.assign(raceMotor, { distance: debugStartDistance, speed: 0, lateral: 0, lateralVelocity: 0, jumpHeight: 0, jumpVelocity: 0, grounded: true, roll: 0 });
  race.checkpointIndex = RACE_CHECKPOINT_DISTANCES.filter((distance) => distance <= debugStartDistance).length;
  race.lastCheckpointDistance = race.checkpointIndex ? RACE_CHECKPOINT_DISTANCES[race.checkpointIndex - 1] + 2.5 : 4;
  state.mode = 'race-countdown';
  state.started = true;
  state.yaw = 0;
  state.pitch = 0.16;
  raceGroup.visible = true;
  setPanel(null);
  raceHud.classList.remove('is-hidden');
  countdown.classList.remove('is-hidden');
  countdownValue.textContent = '3';
  setRaceBodyMode(true);
  placeRacePlayer();
  snapRaceCamera();
  updateRaceHud();
  playTone(420, 0.08, 'sine', 0.1);
  canvas.focus();
}

function finishRace() {
  if (state.mode !== 'race-active') return;
  state.mode = 'race-finished';
  state.started = false;
  raceMotor.speed = 0;
  const newBestTime = !race.bestTime || race.elapsed < race.bestTime;
  const newBestCoins = race.coins > race.bestCoins;
  if (newBestTime) race.bestTime = race.elapsed;
  if (newBestCoins) race.bestCoins = race.coins;
  writeRecords();
  refreshRecordUI();
  finishTitle.textContent = newBestTime ? 'New fastest run.' : 'Run complete.';
  finishTime.textContent = formatTime(race.elapsed);
  finishCoins.textContent = `${race.coins} / ${raceCoins.length}`;
  finishRecord.textContent = newBestTime ? 'NEW PERSONAL BEST' : (newBestCoins ? 'NEW COIN RECORD' : 'RUN SAVED');
  raceHud.classList.add('is-hidden');
  countdown.classList.add('is-hidden');
  setPanel(finishPanel);
  showToast('FINISH!');
  playTone(523, 0.32, 'triangle', 0.16);
  playTone(659, 0.34, 'triangle', 0.14, 0.12);
  playTone(784, 0.5, 'triangle', 0.13, 0.25);
  haptic([30, 35, 30, 35, 90]);
}

addEventListener('keydown', (event) => {
  state.lastKey = `${event.code}:${event.key}`;
  if (debugRaceQuery && state.mode === 'race-active' && ['Digit1', 'Digit2', 'End'].includes(event.code)) {
    const debugDistance = event.code === 'Digit1' ? TRACK_LOOPS[0].start - 28 : (event.code === 'Digit2' ? TRACK_LOOPS[1].start - 28 : RACE_LENGTH - 25);
    Object.assign(raceMotor, { distance: debugDistance, speed: raceSectionAtDistance(debugDistance).speed, lateral: 0, lateralVelocity: 0, jumpHeight: 0, jumpVelocity: 0, grounded: true });
    race.checkpointIndex = RACE_CHECKPOINT_DISTANCES.filter((distance) => distance <= debugDistance).length;
    race.lastCheckpointDistance = race.checkpointIndex ? RACE_CHECKPOINT_DISTANCES[race.checkpointIndex - 1] + 2.5 : 4;
    placeRacePlayer();
    snapRaceCamera();
    event.preventDefault();
    return;
  }
  if (event.code === 'Enter' && state.mode === 'race-briefing') {
    startRace();
    event.preventDefault();
    return;
  }
  if (event.code === 'Enter' && state.mode === 'race-finished') {
    startRace();
    event.preventDefault();
    return;
  }
  if (keyMap[event.code]) {
    input[keyMap[event.code]] = true;
    event.preventDefault();
  }
  if ((event.code === 'Space' || event.code === 'Spacebar' || event.key === ' ' || event.key === 'Space') && !event.repeat) {
    requestJump();
    event.preventDefault();
  }
  if (event.code === 'KeyR') resetPlayer();
  if (event.code === 'KeyF') toggleFullscreen();
});

addEventListener('keyup', (event) => {
  if (keyMap[event.code]) input[keyMap[event.code]] = false;
});

const touchControl = {
  id: null,
  originX: 0,
  originY: 0,
  lastX: 0,
  lastY: 0,
  startedAt: 0,
  maxDistance: 0,
  jumpTriggered: false,
};

function maybeTriggerTouchJump(clientX, clientY) {
  if (touchControl.jumpTriggered || state.touchJumpCooldown > 0) return;
  const swipeX = clientX - touchControl.originX;
  const swipeY = clientY - touchControl.originY;
  if (swipeY > -48 || Math.abs(swipeY) < Math.abs(swipeX) * 0.72) return;
  touchControl.jumpTriggered = true;
  performTouchJump();
  touchJoystick.classList.add('did-jump');
}

function endTouchPointer(event) {
  if (event.pointerId !== touchControl.id) return;
  maybeTriggerTouchJump(event.clientX, event.clientY);
  const distance = Math.hypot(event.clientX - touchControl.originX, event.clientY - touchControl.originY);
  if (!touchControl.jumpTriggered && performance.now() - touchControl.startedAt < 280 && Math.max(distance, touchControl.maxDistance) < 22) {
    performTouchJump();
    touchControl.jumpTriggered = true;
  }
  touchControl.id = null;
  input.touchX = 0;
  touchStick.style.transform = 'translateX(0px)';
  touchJoystick.classList.remove('is-active', 'did-jump');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener('pointerdown', (event) => {
  if (state.mode === 'splash' || state.mode === 'race-briefing' || state.mode === 'race-finished') return;
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic tests and a few embedded browsers can reject pointer capture;
    // the gesture still works because events remain bound to the canvas.
  }
  if (isMobileDevice || state.mode.startsWith('race')) {
    event.preventDefault();
    if (touchControl.id !== null) return;
    touchControl.id = event.pointerId;
    touchControl.originX = touchControl.lastX = event.clientX;
    touchControl.originY = touchControl.lastY = event.clientY;
    touchControl.startedAt = performance.now();
    touchControl.maxDistance = 0;
    touchControl.jumpTriggered = false;
    touchJoystick.style.left = `${THREE.MathUtils.clamp(event.clientX, 88, innerWidth - 88)}px`;
    touchJoystick.style.top = `${THREE.MathUtils.clamp(event.clientY, 46, innerHeight - 46)}px`;
    touchJoystick.classList.add('is-active');
    return;
  }
  state.dragging = true;
});

canvas.addEventListener('pointerup', (event) => {
  if (isMobileDevice || state.mode.startsWith('race')) endTouchPointer(event);
  else {
    state.dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
});
canvas.addEventListener('pointercancel', endTouchPointer);

canvas.addEventListener('pointermove', (event) => {
  if ((isMobileDevice || state.mode.startsWith('race')) && event.pointerId === touchControl.id) {
    touchControl.lastX = event.clientX;
    touchControl.lastY = event.clientY;
    const dx = THREE.MathUtils.clamp(event.clientX - touchControl.originX, -64, 64);
    touchControl.maxDistance = Math.max(touchControl.maxDistance, Math.hypot(event.clientX - touchControl.originX, event.clientY - touchControl.originY));
    input.touchX = dx / 64;
    touchStick.style.transform = `translateX(${dx}px)`;
    maybeTriggerTouchJump(event.clientX, event.clientY);
    return;
  }
  if (!state.dragging || state.mode !== 'free') return;
  state.yaw -= event.movementX * 0.005;
  state.pitch = THREE.MathUtils.clamp(state.pitch - event.movementY * 0.004, 0.06, 0.7);
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.querySelector('#game-shell').requestFullscreen();
}

function resetPlayer() {
  if (state.mode.startsWith('race')) {
    Object.assign(raceMotor, {
      distance: race.lastCheckpointDistance,
      speed: 22,
      lateral: 0,
      lateralVelocity: 0,
      jumpHeight: 0,
      jumpVelocity: 0,
      grounded: true,
    });
    setRaceBodyMode(true);
    placeRacePlayer();
    snapRaceCamera();
  } else teleportPlayer(0, 5.5);
}

function performJump() {
  const velocity = playerBody.linvel();
  playerBody.setLinvel({ x: velocity.x, y: 11.2, z: velocity.z }, true);
  state.jumpCount += 1;
  state.coyoteTime = 0;
  input.jumpBuffer = 0;
  playTone(240, 0.11, 'triangle', 0.08);
  haptic(12);
}

function performTouchJump() {
  if (state.mode !== 'free' && state.mode !== 'race-active') return;
  if (state.mode === 'race-active') {
    const wasAirborne = !raceMotor.grounded;
    raceMotor.jumpVelocity = 13.8;
    raceMotor.grounded = false;
    state.grounded = false;
    state.jumpCount += 1;
    if (wasAirborne) state.airJumpCount += 1;
    state.touchJumpCooldown = 0.12;
    playTone(wasAirborne ? 360 : 280, 0.1, 'triangle', 0.08);
    haptic(12);
    return;
  }
  const velocity = playerBody.linvel();
  const wasAirborne = !state.grounded;
  playerBody.setLinvel({ x: velocity.x, y: state.mode === 'race-active' ? 11.8 : 11.2, z: velocity.z }, true);
  state.jumpCount += 1;
  if (wasAirborne) state.airJumpCount += 1;
  state.coyoteTime = 0;
  state.touchJumpCooldown = 0.12;
  input.jumpBuffer = 0;
  playTone(wasAirborne ? 330 : 260, 0.1, 'triangle', 0.08);
  haptic(12);
}

function requestJump() {
  if (state.mode === 'race-active') {
    performTouchJump();
    return;
  }
  if (state.mode !== 'free') return;
  if (state.grounded || state.coyoteTime > 0) performJump();
  else input.jumpBuffer = 0.25;
}

freeModeButton.addEventListener('click', startFreeMode);
raceModeButton.addEventListener('click', showRaceBriefing);
raceStartButton.addEventListener('click', startRace);
raceBackButton.addEventListener('click', showSplash);
raceReplayButton.addEventListener('click', startRace);
finishFreeButton.addEventListener('click', startFreeMode);
resetButton.addEventListener('click', resetPlayer);

function updateRaceHud() {
  const section = raceSectionAtDistance(raceMotor.distance);
  hudTime.textContent = formatTime(Math.max(race.elapsed, 0.0001));
  hudCoins.textContent = String(race.coins);
  hudCheckpoint.textContent = `${race.checkpointIndex} / ${RACE_CHECKPOINT_DISTANCES.length}`;
  hudSection.textContent = section.name.toUpperCase();
  hudShield.classList.toggle('is-active', race.shield);
  speedFill.style.width = `${THREE.MathUtils.clamp(raceMotor.speed / 64, 0, 1) * 100}%`;
}

function collectCoin(coin) {
  coin.collected = true;
  const index = raceCoins.indexOf(coin);
  setRaceCoinInstance(coin, index);
  raceCoinMesh.instanceMatrix.needsUpdate = true;
  race.coins += 1;
  const pitch = 720 + (race.coins % 6) * 55;
  playTone(pitch, 0.07, 'sine', 0.07);
  haptic(7);
}

function hitObstacle() {
  if (race.hitCooldown > 0) return;
  race.hitCooldown = 0.85;
  raceMotor.speed = Math.max(16, raceMotor.speed * 0.42);
  raceMotor.lateralVelocity *= -0.18;
  if (race.shield) {
    race.shield = false;
    race.shieldPops += 1;
    showToast('SHIELD POP! · COINS SAFE');
    playTone(190, 0.22, 'sawtooth', 0.11);
    playTone(580, 0.12, 'square', 0.07, 0.06);
    haptic([35, 18, 55]);
  } else {
    race.coinCrashes += 1;
    race.coins = 0;
    showToast('CRASH! · COINS LOST');
    playTone(120, 0.34, 'sawtooth', 0.14);
    haptic([75, 30, 80]);
  }
}

function updateRaceGameplay(dt) {
  race.hitCooldown = Math.max(0, race.hitCooldown - dt);
  for (const coin of raceCoins) {
    if (coin.collected || Math.abs(raceMotor.distance - coin.distance) > 1.35) continue;
    const lateralDistance = Math.abs(raceMotor.lateral - coin.localX);
    const verticalDistance = Math.abs(PLAYER_RADIUS + raceMotor.jumpHeight - coin.lift);
    if (lateralDistance < 0.86 && verticalDistance < 0.9) collectCoin(coin);
  }
  for (const shield of raceShields) {
    if (shield.collected || Math.abs(raceMotor.distance - shield.distance) > 1.5 || Math.abs(raceMotor.lateral - shield.x) > 1.05 || raceMotor.jumpHeight > 1.4) continue;
    shield.collected = true;
    shield.mesh.visible = false;
    race.shield = true;
    race.shieldPickups += 1;
    showToast('SHIELD READY');
    playTone(520, 0.14, 'triangle', 0.11);
    playTone(880, 0.2, 'sine', 0.08, 0.07);
    haptic([16, 18, 16]);
  }
  if (race.hitCooldown <= 0) {
    for (const obstacle of raceObstacles) {
      if (Math.abs(raceMotor.distance - obstacle.distance) < 1.25 && Math.abs(raceMotor.lateral - obstacle.localX) < obstacle.halfX + 0.48 && raceMotor.jumpHeight < 1.35) {
        hitObstacle();
        break;
      }
    }
  }

  const nextCheckpoint = RACE_CHECKPOINT_DISTANCES[race.checkpointIndex];
  if (nextCheckpoint !== undefined && raceMotor.distance >= nextCheckpoint) {
    race.checkpointIndex += 1;
    race.lastCheckpointDistance = nextCheckpoint + 2.5;
    const nextSection = COURSE_SECTIONS[Math.min(race.checkpointIndex, COURSE_SECTIONS.length - 1)];
    showToast(`CHECKPOINT ${race.checkpointIndex} · ${nextSection.name.toUpperCase()}`, 1.7);
    playTone(440, 0.12, 'triangle', 0.1);
    playTone(660, 0.2, 'triangle', 0.09, 0.08);
    haptic(26);
  }
  if (raceMotor.distance >= RACE_LENGTH - 1) finishRace();
  updateRaceHud();
}

const moveDirection = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function fixedUpdate(dt) {
  state.elapsed += dt;
  const position = playerBody.translation();
  const velocity = playerBody.linvel();

  if (!state.mode.startsWith('race')) {
    const groundRay = new RAPIER.Ray({ x: position.x, y: position.y, z: position.z }, { x: 0, y: -1, z: 0 });
    const groundHit = world.castRay(groundRay, PLAYER_RADIUS + 0.16, true, undefined, undefined, playerCollider, playerBody);
    state.grounded = Boolean(groundHit) && velocity.y < 1.2;
    state.coyoteTime = state.grounded ? 0.1 : Math.max(0, state.coyoteTime - dt);
  } else {
    state.grounded = raceMotor.grounded;
    state.coyoteTime = raceMotor.grounded ? 0.1 : 0;
  }

  if (state.mode === 'race-countdown') {
    race.countdown -= dt;
    const number = Math.max(1, Math.ceil(race.countdown));
    countdownValue.textContent = String(number);
    placeRacePlayer();
    if (race.countdown <= 0) {
      state.mode = 'race-active';
      countdown.classList.add('is-hidden');
      raceMotor.speed = 26;
      showToast('GO!', 0.8);
      playTone(720, 0.18, 'triangle', 0.14);
      haptic(24);
    }
  }

  if (state.mode === 'race-active') {
    race.elapsed += dt;
    const steer = THREE.MathUtils.clamp(input.touchX + (input.right ? 1 : 0) - (input.left ? 1 : 0), -1, 1);
    const section = raceSectionAtDistance(raceMotor.distance);
    const acceleration = raceMotor.speed < section.speed ? 30 : 64;
    raceMotor.speed += THREE.MathUtils.clamp(section.speed - raceMotor.speed, -acceleration * dt, acceleration * dt);
    const desiredLateralSpeed = steer * (18 + section.intensity * 0.65);
    raceMotor.lateralVelocity = THREE.MathUtils.lerp(raceMotor.lateralVelocity, desiredLateralSpeed, 1 - Math.exp(-20 * dt));
    raceMotor.lateral += raceMotor.lateralVelocity * dt;
    const lateralLimit = RACE_HALF_WIDTH - PLAYER_RADIUS - 0.2;
    if (Math.abs(raceMotor.lateral) > lateralLimit) {
      raceMotor.lateral = THREE.MathUtils.clamp(raceMotor.lateral, -lateralLimit, lateralLimit);
      raceMotor.lateralVelocity *= 0.2;
    }

    raceMotor.distance = Math.min(RACE_LENGTH, raceMotor.distance + raceMotor.speed * dt);
    raceMotor.roll += raceMotor.speed * dt / PLAYER_RADIUS;
    raceMotor.jumpVelocity -= 52 * dt;
    raceMotor.jumpHeight += raceMotor.jumpVelocity * dt;
    if (raceMotor.jumpHeight <= 0) {
      raceMotor.jumpHeight = 0;
      raceMotor.jumpVelocity = 0;
      raceMotor.grounded = true;
    } else raceMotor.grounded = false;
    placeRacePlayer();
  } else if (state.mode === 'free') {
    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(-forward.z, 0, forward.x);
    moveDirection.set(0, 0, 0);
    if (isMobileDevice) {
      moveDirection.add(forward);
      moveDirection.addScaledVector(right, input.touchX);
    } else {
      if (input.forward) moveDirection.add(forward);
      if (input.back) moveDirection.sub(forward);
      if (input.right) moveDirection.add(right);
      if (input.left) moveDirection.sub(right);
    }

    if (moveDirection.lengthSq() > 0) {
      const moveStrength = Math.min(1, moveDirection.length());
      moveDirection.normalize();
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
      const control = state.grounded ? 1 : 0.22;
      const speedRoom = THREE.MathUtils.clamp(1 - horizontalSpeed / 10.5, 0.08, 1);
      playerBody.applyImpulse({ x: moveDirection.x * 0.115 * control * speedRoom * moveStrength, y: 0, z: moveDirection.z * 0.115 * control * speedRoom * moveStrength }, true);
      playerBody.applyTorqueImpulse({ x: moveDirection.z * 0.082 * control * moveStrength, y: 0, z: -moveDirection.x * 0.082 * control * moveStrength }, true);
    }

    if (input.jumpBuffer > 0 && state.coyoteTime > 0) {
      performJump();
    }
  }
  input.jumpBuffer = Math.max(0, input.jumpBuffer - dt);
  state.touchJumpCooldown = Math.max(0, state.touchJumpCooldown - dt);
  if (race.toastTimer > 0) {
    race.toastTimer = Math.max(0, race.toastTimer - dt);
    if (race.toastTimer === 0) raceToast.classList.remove('is-visible');
  }

  updateFloatingWoodPhysics(state.elapsed);
  world.step();

  const next = playerBody.translation();
  if (state.mode === 'race-active') updateRaceGameplay(dt);
  if (!state.mode.startsWith('race') && (next.y < -8 || Math.abs(next.x) > 50 || Math.abs(next.z) > 50)) resetPlayer();
}

const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();
const raceCameraForward = new THREE.Vector3();
const raceCameraUp = new THREE.Vector3(0, 1, 0);
const raceBallBasis = new THREE.Matrix4();
const raceBallBaseQuaternion = new THREE.Quaternion();
const raceBallRollQuaternion = new THREE.Quaternion();
const smoothTarget = new THREE.Vector3(0, 1.3, 5.5);

function updateVisuals(dt) {
  const position = playerBody.translation();
  const rotation = playerBody.rotation();
  ball.position.set(position.x, position.y, position.z);
  canvas.dataset.raceDistance = raceMotor.distance.toFixed(2);
  canvas.dataset.raceLateral = raceMotor.lateral.toFixed(2);
  canvas.dataset.jumpHeight = raceMotor.jumpHeight.toFixed(3);
  canvas.dataset.jumpVelocity = raceMotor.jumpVelocity.toFixed(3);
  canvas.dataset.grounded = String(state.grounded);
  canvas.dataset.trackLoop = getRaceFrame(raceMotor.distance).loop || '';
  if (state.mode.startsWith('race')) {
    const frame = getRaceFrame(raceMotor.distance);
    makeRaceBasis(frame, raceBallBasis);
    raceBallBaseQuaternion.setFromRotationMatrix(raceBallBasis);
    raceBallRollQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -raceMotor.roll);
    ball.quaternion.copy(raceBallBaseQuaternion).multiply(raceBallRollQuaternion);
  } else ball.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  for (const block of floatingWoodBlocks) {
    const blockPosition = block.body.translation();
    block.mesh.position.set(blockPosition.x, blockPosition.y, blockPosition.z);
  }

  const raceVisible = raceGroup.visible;
  if (raceVisible) {
    const frame = getRaceFrame(raceMotor.distance);
    raceSkyUniforms.time.value = state.elapsed;
    raceSkyDome.position.copy(ball.position);
    raceMoon.position.copy(ball.position)
      .addScaledVector(frame.tangent, 185)
      .addScaledVector(frame.up, 52)
      .addScaledVector(frame.right, -44);
    let coinMatricesChanged = false;
    for (let i = 0; i < raceCoins.length; i++) {
      const coin = raceCoins[i];
      if (!coin.collected && Math.abs(coin.distance - raceMotor.distance) < 230) {
        setRaceCoinInstance(coin, i, state.elapsed * 5.8);
        coinMatricesChanged = true;
      }
    }
    if (coinMatricesChanged) raceCoinMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < raceShields.length; i++) {
      const shield = raceShields[i];
      shield.mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), dt * 2.8);
      if (!shield.collected) {
        const frame = getRaceFrame(shield.distance);
        shield.mesh.position.copy(shield.basePosition).addScaledVector(frame.up, Math.sin(state.elapsed * 2.4 + i) * 0.16);
      }
    }
  }

  sun.position.set(position.x, position.y, position.z).addScaledVector(sunDirection, 28);
  sun.target.position.set(position.x, position.y, position.z);
  sun.target.updateMatrixWorld();

  if (state.mode.startsWith('race')) {
    const frame = getRaceFrame(raceMotor.distance);
    raceCameraForward.copy(frame.tangent);
    raceCameraUp.lerp(frame.up, 1 - Math.exp(-dt * 12)).normalize();
    camera.up.lerp(raceCameraUp, 1 - Math.exp(-dt * 10)).normalize();
    cameraTarget.set(position.x, position.y, position.z)
      .addScaledVector(frame.up, 1.25)
      .addScaledVector(raceCameraForward, 6.4);
    smoothTarget.lerp(cameraTarget, 1 - Math.exp(-dt * 15));
    desiredCamera.copy(position)
      .addScaledVector(raceCameraForward, -11.5)
      .addScaledVector(frame.up, 4.4);
    const speed = raceMotor.speed;
    camera.fov = THREE.MathUtils.lerp(camera.fov, 40 + THREE.MathUtils.clamp((speed - 24) / 38, 0, 1) * 9, 1 - Math.exp(-dt * 5));
    camera.updateProjectionMatrix();
  } else {
    camera.up.lerp(new THREE.Vector3(0, 1, 0), 1 - Math.exp(-dt * 10)).normalize();
    // Aim above the ball so it lives in the lower third and tall architecture remains visible.
    cameraTarget.set(position.x, position.y + 2.1, position.z);
    smoothTarget.lerp(cameraTarget, 1 - Math.exp(-dt * 11));
    const distance = 11.5;
    const horizontal = Math.cos(state.pitch) * distance;
    desiredCamera.set(
      smoothTarget.x + Math.sin(state.yaw) * horizontal,
      smoothTarget.y + Math.sin(state.pitch) * distance + 0.35,
      smoothTarget.z + Math.cos(state.yaw) * horizontal,
    );
    camera.fov = THREE.MathUtils.lerp(camera.fov, 40, 1 - Math.exp(-dt * 5));
    camera.updateProjectionMatrix();
  }

  cameraDirection.copy(desiredCamera).sub(smoothTarget);
  const desiredDistance = cameraDirection.length();
  cameraDirection.normalize();
  if (!state.mode.startsWith('race')) {
    const cameraRay = new RAPIER.Ray(smoothTarget, cameraDirection);
    const cameraHit = world.castRay(cameraRay, desiredDistance, true, undefined, undefined, playerCollider, playerBody);
    if (cameraHit) desiredCamera.copy(smoothTarget).addScaledVector(cameraDirection, Math.max(1.4, cameraHit.timeOfImpact - 0.28));
  }

  camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 10));
  camera.lookAt(smoothTarget);

  if (windGain && windFilter) {
    const speed = state.mode.startsWith('race') ? raceMotor.speed : Math.hypot(playerBody.linvel().x, playerBody.linvel().z);
    const active = state.mode === 'race-active';
    windGain.gain.setTargetAtTime(active ? THREE.MathUtils.clamp(speed / 60, 0.03, 0.25) : 0, audioContext.currentTime, 0.08);
    windFilter.frequency.setTargetAtTime(360 + speed * 24, audioContext.currentTime, 0.1);
  }
}

const gradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.022 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+time*0.013)*43758.5453); }
    void main(){
      vec4 tex=texture2D(tDiffuse,vUv);
      vec3 c=tex.rgb*0.975+0.009;
      float l=dot(c,vec3(.2126,.7152,.0722));
      c=(c-.18)*1.025+.18;
      c=mix(vec3(l),c,.96);
      c*=mix(vec3(.985,1.0,1.02),vec3(1.025,1.005,.98),smoothstep(.18,.78,l));
      float n=hash(gl_FragCoord.xy)-.5;
      c+=n*grain;
      gl_FragColor=vec4(c,tex.a);
    }
  `,
};

const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  depthBuffer: true,
  stencilBuffer: false,
  samples: isMobileDevice ? 0 : 4,
});
const composer = new EffectComposer(renderer, composerTarget);
composer.setPixelRatio(qualityRatio);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
const gtaoSamples = isMobileDevice ? 4 : 8;
gtao.enabled = !isMobileDevice;
gtao.blendIntensity = isMobileDevice ? 0.38 : 0.48;
gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.8, thickness: 1.0, scale: 0.85, samples: gtaoSamples });
gtao.updatePdMaterial({ radius: isMobileDevice ? 2 : 3, rings: isMobileDevice ? 1 : 2, samples: gtaoSamples, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
composer.addPass(gtao);
const gradePass = new ShaderPass(gradeShader);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

function render(dt = 1 / 60) {
  updateVisuals(dt);
  poolWater.material.uniforms.time.value += dt * 0.42;
  gradePass.uniforms.time.value = performance.now();
  // Long-course coordinates eventually exceed the stable depth range of the
  // GTAO post target. Race Mode uses the native ACES/PBR path for a pristine,
  // fast image; the contained Free Mode still keeps desktop GTAO and grain.
  if (isMobileDevice || state.mode.startsWith('race')) renderer.render(scene, camera);
  else composer.render(dt);
}

let accumulator = 0;
let previousTime = performance.now();
let fpsFrames = 0;
let fpsElapsed = 0;
function frame(now) {
  const rawDelta = Math.max(0.0001, (now - previousTime) / 1000);
  const delta = Math.min(rawDelta, 0.05);
  previousTime = now;
  fpsFrames += 1;
  fpsElapsed += rawDelta;
  if (fpsElapsed >= 0.5) {
    state.fps = Math.round(fpsFrames / fpsElapsed);
    fpsValue.textContent = String(state.fps);
    fpsFrames = 0;
    fpsElapsed = 0;
  }
  accumulator += delta;
  while (accumulator >= 1 / 60) {
    fixedUpdate(1 / 60);
    accumulator -= 1 / 60;
  }
  render(delta);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) fixedUpdate(1 / 60);
  render(steps / 60);
};

window.render_game_to_text = () => {
  const p = playerBody.translation();
  const v = playerBody.linvel();
  const currentRaceFrame = getRaceFrame(raceMotor.distance, {
    center: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), bank: 0, loop: null, loopProgress: null, loopXOffset: 0,
  });
  const currentSection = raceSectionAtDistance(raceMotor.distance);
  return JSON.stringify({
    coordinateSystem: 'Free Mode uses world Y-up physics; Race Mode uses a track-local frame that banks and rotates through two vertical loops',
    mode: state.mode,
    lastKey: state.lastKey,
    player: {
      position: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      velocity: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) },
      grounded: state.grounded,
      coyoteTime: +state.coyoteTime.toFixed(3),
      jumpBuffer: +input.jumpBuffer.toFixed(3),
      jumpCount: state.jumpCount,
      airJumpCount: state.airJumpCount,
      horizontalSpeed: +(state.mode.startsWith('race') ? raceMotor.speed : Math.hypot(v.x, v.z)).toFixed(2),
    },
    camera: {
      yaw: +state.yaw.toFixed(2),
      pitch: +state.pitch.toFixed(2),
      position: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) },
      target: { x: +smoothTarget.x.toFixed(2), y: +smoothTarget.y.toFixed(2), z: +smoothTarget.z.toFixed(2) },
    },
    race: {
      course: 'Monolith Velocity',
      section: currentSection.name,
      sectionIndex: COURSE_SECTIONS.indexOf(currentSection) + 1,
      sectionCount: COURSE_SECTIONS.length,
      courseLength: RACE_LENGTH,
      distanceTravelled: +raceMotor.distance.toFixed(1),
      elevation: +currentRaceFrame.center.y.toFixed(1),
      targetSpeed: currentSection.speed,
      forwardSpeed: +raceMotor.speed.toFixed(2),
      lateralSpeed: +raceMotor.lateralVelocity.toFixed(2),
      lateralOffset: +raceMotor.lateral.toFixed(2),
      jumpHeight: +raceMotor.jumpHeight.toFixed(2),
      jumpVelocity: +raceMotor.jumpVelocity.toFixed(2),
      trackLoop: currentRaceFrame.loop,
      loopProgress: currentRaceFrame.loopProgress === null ? null : +currentRaceFrame.loopProgress.toFixed(3),
      loopXOffset: +currentRaceFrame.loopXOffset.toFixed(2),
      physicsModel: 'deterministic kinematic arcade motor; no race-surface rigid-body bounce',
      elapsed: +race.elapsed.toFixed(3),
      formattedTime: formatTime(Math.max(race.elapsed, 0.0001)),
      countdown: +Math.max(0, race.countdown).toFixed(2),
      coins: race.coins,
      totalCoins: raceCoins.length,
      remainingCoins: raceCoins.filter((coin) => !coin.collected).length,
      shield: race.shield,
      checkpoint: race.checkpointIndex,
      checkpointCount: RACE_CHECKPOINT_DISTANCES.length,
      progress: +(raceMotor.distance / RACE_LENGTH).toFixed(3),
      bestTime: +race.bestTime.toFixed(3),
      bestCoins: race.bestCoins,
      obstacleCount: raceObstacles.length,
      powerupCount: raceShields.length,
      shieldPickups: race.shieldPickups,
      shieldPops: race.shieldPops,
      coinCrashes: race.coinCrashes,
    },
    performance: { fps: state.fps, mobileMode: isMobileDevice, pixelRatio: qualityRatio, antialiasSamples: isMobileDevice ? 0 : 4, shadowMap: isMobileDevice ? 1024 : 2048, reflectionMap: isMobileDevice ? 384 : 768, postProcessing: !isMobileDevice && !state.mode.startsWith('race'), gtaoEnabled: gtao.enabled && !state.mode.startsWith('race'), gtaoSamples: gtao.enabled && !state.mode.startsWith('race') ? gtaoSamples : 0 },
    controls: state.mode.startsWith('race')
      ? 'automatic high-speed forward roll, drag horizontally to steer, tap or Space to jump including in air, fixed chase camera, R reset to last checkpoint'
      : (isMobileDevice ? 'automatic forward roll, one-finger horizontal slide steering, tap or upward swipe jump with repeatable air jumps, automatic camera, Reset button' : 'WASD/arrows roll, Space jump, drag look, R reset, F fullscreen'),
    pools: [
      { shape: 'rectangle', x: RECT_POOL.x, z: RECT_POOL.z, waterY: RECT_POOL.waterY },
      { shape: 'round', x: ROUND_POOL.x, z: ROUND_POOL.z, waterY: ROUND_POOL.waterY },
    ],
    floatingWoodTowers: woodTowerDefinitions.map(({ name, species, x, z, count }) => {
      const baseBlock = floatingWoodBlocks.find((block) => block.tower === name);
      return { name, species, x, z, blocks: count, currentBaseY: +baseBlock.body.translation().y.toFixed(2) };
    }),
    environment: state.mode.startsWith('race')
      ? { playerMaterial: 'rigid texture-free procedural PBR marble', sky: 'procedural stars and magenta nebula', terrain: 'ImprovedNoise track-following canyon', monuments: '7 colossal arches plus 14 concrete and glossy-metal walls', moon: 'synthetic cyan' }
      : { playerMaterial: 'rigid texture-free procedural PBR marble', sky: 'procedural Preetham', sunElevation: skySettings.elevation, water: 'planar reflective', waves: 'three small geometric wave bands, max amplitude 0.046' },
    landmarks: state.mode.startsWith('race')
      ? [`start elevation ${raceTrackSamples[0].center.y.toFixed(0)}`, `${RACE_CHECKPOINT_DISTANCES.length} checkpoints divide ${COURSE_SECTIONS.length} paced sections`, `finish elevation ${raceTrackSamples.at(-1).center.y.toFixed(0)}`, `6500-unit banked half-pipe with strong S-turns and ${TRACK_LOOPS.length} complete vertical loops`, 'procedural canyon and seven monumental arches']
      : ['gold arch at (0, -5)', 'rose/coral stairs near (-7, -5)', 'coral arch at (7, -12)'],
  });
};

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
