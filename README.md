# Game Dream

A surreal third-person rolling-ball playground built with Three.js and Rapier.

[Play Game Dream](https://smithmw7.github.io/game-dream/)

## Features

- Rigid glossy marble with a texture-free volumetric PBR shader
- Physics-driven rolling and higher jumping
- Spring-arm third-person camera with obstruction handling
- Procedural atmospheric sky and synchronized sunlight
- Reflective animated swimming pools with small geometric waves
- Pastel PBR architecture, soft shadows, GTAO, ACES grading, and film grain
- Adaptive mobile rendering quality
- Touch joystick, camera drag, and swipe-to-jump controls
- Live FPS display

## Controls

### Desktop

- `WASD` or arrow keys: roll
- `Space`: jump
- Drag: look around
- `R`: reset
- `F`: fullscreen

### Mobile

- Left-thumb joystick: roll
- Drag on the right: look around
- Swipe upward on the right: jump

## Development

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Technology

- [Three.js](https://threejs.org/)
- [Rapier](https://rapier.rs/)
- [Vite](https://vite.dev/)
