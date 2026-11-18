import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export function createVolumetricConeMaterial(color = 0xffb468, intensity = 0.12) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float rim = pow(abs(dot(n, v)), 2.1);
        float vertical = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        float alpha = rim * vertical * uIntensity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
}

export function createWetGroundMaterial(assets, groundId, gameRenderer, wetness = 1.0) {
  const t = assets.tex[groundId];
  const mat = new THREE.MeshStandardMaterial({
    map: t.diff,
    normalMap: t.nor,
    roughnessMap: t.rough,
    roughness: 0.78,
    metalness: 0.08,
    envMapIntensity: 1.45
  });

  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = gameRenderer.timeUniform;
    shader.uniforms.uWetness = { value: wetness };
    shader.uniforms.tReflection = gameRenderer.reflectTexUniform;
    shader.uniforms.uReflectMatrix = gameRenderer.reflectMatUniform;
    shader.uniforms.uReflectStrength = gameRenderer.reflectStrengthUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGroundWorldPos;
        varying vec3 vGroundViewX;
        varying vec3 vGroundViewY;
        varying vec3 vGroundViewZ;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundViewX = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vGroundViewY = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vGroundViewZ = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWetness;
        uniform sampler2D tReflection;
        uniform mat4 uReflectMatrix;
        uniform float uReflectStrength;
        varying vec3 vGroundWorldPos;
        varying vec3 vGroundViewX;
        varying vec3 vGroundViewY;
        varying vec3 vGroundViewZ;

        float gHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float gNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
            mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float rainRipples(vec2 p, float t) {
          float acc = 0.0;
          for (int i = 0; i < 2; i++) {
            float fi = float(i);
            vec2 grid = p * (1.8 + fi * 1.1) + fi * 13.7;
            vec2 id = floor(grid);
            vec2 uv = fract(grid) - 0.5;
            float seed = gHash(id);
            vec2 center = vec2(gHash(id + 3.1) - 0.5, gHash(id + 7.9) - 0.5) * 0.45;
            float phase = fract(t * 1.15 + seed * 7.3);
            float dist = length(uv - center);
            float ring = sin((dist - phase * 0.48) * 46.0) * exp(-dist * 7.0) * (1.0 - phase) * smoothstep(0.45, 0.05, dist);
            acc += ring;
          }
          return acc;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float n1 = gNoise(vGroundWorldPos.xz * 0.24);
        float n2 = gNoise(vGroundWorldPos.xz * 0.65 + 4.2);
        float puddleMask = smoothstep(0.51, 0.72, (n1 * 0.68 + n2 * 0.32) * uWetness);
        diffuseColor.rgb *= mix(0.84, 0.38, puddleMask);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * 0.76, 0.035, puddleMask);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float rDx = rainRipples(vGroundWorldPos.xz + vec2(0.02, 0.0), uTime) - rainRipples(vGroundWorldPos.xz - vec2(0.02, 0.0), uTime);
        float rDz = rainRipples(vGroundWorldPos.xz + vec2(0.0, 0.02), uTime) - rainRipples(vGroundWorldPos.xz - vec2(0.0, 0.02), uTime);
        vec3 puddleViewN = normalize(vGroundViewY - vGroundViewX * (rDx * 1.8) - vGroundViewZ * (rDz * 1.8));
        normal = normalize(mix(normal, puddleViewN, puddleMask * 0.92));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uReflectStrength > 0.01 && puddleMask > 0.02) {
          vec4 reflCoord = uReflectMatrix * vec4(vGroundWorldPos, 1.0);
          if (reflCoord.w > 0.001) {
            vec2 reflUv = reflCoord.xy / reflCoord.w + vec2(rDx, rDz) * 0.14;
            vec3 reflCol = texture2D(tReflection, clamp(reflUv, 0.004, 0.996)).rgb;
            vec3 viewDirW = normalize(cameraPosition - vGroundWorldPos);
            float fresnel = mix(0.28, 0.92, pow(1.0 - max(dot(viewDirW, vec3(0.0, 1.0, 0.0)), 0.0), 3.0));
            totalEmissiveRadiance += reflCol * puddleMask * fresnel * uReflectStrength;
          }
        }`
      );
  };
  mat.customProgramCacheKey = () => `wet-ground-refl-${groundId}`;
  return mat;
}

export class GameRenderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.timeUniform = { value: 0 };
    // Quality: 2 = Ultra Cinema (Planar Reflection + GTAO + Bloom), 1 = High (Bloom), 0 = Fast
    this.qualityMode = 2;
    this.bloomEnabled = true;
    this.baseFov = 62;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 720);

    // Planar reflection target for puddles & river
    this.reflectRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.reflectCam = new THREE.PerspectiveCamera(62, 1, 0.1, 320);
    this.reflectMatrix = new THREE.Matrix4();
    this.reflectTexUniform = { value: this.reflectRT.texture };
    this.reflectMatUniform = { value: this.reflectMatrix };
    this.reflectStrengthUniform = { value: 0.72 };
    this.reflectHideObjects = [];
    this._biasMatrix = new THREE.Matrix4().set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    );
    this._camFwd = new THREE.Vector3();

    // Lighting calibrated for Three r187 physical units
    this.hemi = new THREE.HemisphereLight(0x7c9ad4, 0x261d15, 0.95);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xa8c6f2, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.lampLights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffb464, 0, 24, 1.45);
      this.lampLights.push(l);
      this.scene.add(l);
    }

    this.muzzleLight = new THREE.PointLight(0xffd088, 0, 15, 1.5);
    this.boomLight = new THREE.PointLight(0xff9a40, 0, 36, 1.4);
    this.fireLight = new THREE.PointLight(0xff7a22, 0, 18, 1.5);
    this.scene.add(this.muzzleLight, this.boomLight, this.fireLight);

    this.heroSpot = new THREE.SpotLight(0xffb868, 0, 25, Math.PI * 0.44, 0.58, 1.35);
    this.heroSpot.castShadow = true;
    this.heroSpot.shadow.mapSize.set(1024, 1024);
    this.heroSpot.shadow.camera.near = 0.6;
    this.heroSpot.shadow.camera.far = 24;
    this.heroSpot.shadow.bias = -0.0008;
    this.heroSpot.shadow.normalBias = 0.03;
    this.scene.add(this.heroSpot, this.heroSpot.target);

    this._initEnvironment();
    this._initPostProcessing();
  }

  initAssetPools() {
    this._initSharedPools();
  }

  _initEnvironment() {
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x0b1428);
    const eb = (col, x, y, z, r) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({ color: col })
      );
      m.position.set(x, y, z);
      m.scale.setScalar(r);
      es.add(m);
    };
    eb(0xdbe4ff, 30, 42, -60, 8);
    eb(0xffb060, -20, 6, 12, 3.5);
    eb(0xffb060, 24, 5, 28, 3.5);
    eb(0xff4640, -28, 4.5, -24, 2.8);
    eb(0x4affc0, 22, 4.5, -18, 2.5);
    eb(0x141720, 0, -60, 0, 55);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(es, 0.035).texture;
    pm.dispose();
  }

  _initSharedPools() {
    const sh = g => { g.userData.shared = true; return g; };
    this.G = {
      box: sh(new THREE.BoxGeometry(1, 1, 1)),
      cyl: sh(new THREE.CylinderGeometry(1, 1, 1, 16)),
      cylLo: sh(new THREE.CylinderGeometry(1, 1, 1, 10)),
      sph: sh(new THREE.SphereGeometry(1, 18, 12)),
      sphLo: sh(new THREE.SphereGeometry(1, 8, 6)),
      dome: sh(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
      torus: sh(new THREE.TorusGeometry(0.09, 0.036, 8, 16)),
      circ: sh(new THREE.CircleGeometry(1, 20)),
      plane: sh(new THREE.PlaneGeometry(1, 1)),
      beam: sh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)),
      flat: sh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      lampCone: sh(new THREE.CylinderGeometry(0.28, 3.6, 4.2, 20, 1, true))
    };

    const p = this.assets.procTex;
    this.M = {
      crate: new THREE.MeshStandardMaterial({ map: p.plank, roughness: 0.84 }),
      walnut: new THREE.MeshStandardMaterial({ map: p.walnut, roughness: 0.62, metalness: 0.05 }),
      gunSteel: new THREE.MeshStandardMaterial({ color: 0x20232a, roughness: 0.34, metalness: 0.85 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd4a448, roughness: 0.3, metalness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x121215, roughness: 0.55, metalness: 0.45 }),
      hat: new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.56,
        clearcoat: 0.48,
        clearcoatRoughness: 0.28,
        side: THREE.DoubleSide
      }),
      skin: new THREE.MeshStandardMaterial({ color: 0xd2aa85, roughness: 0.78 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.28, metalness: 0.85 }),
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffdfa8).multiplyScalar(1.8), toneMapped: false }),
      glint: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3020).multiplyScalar(1.8), toneMapped: false }),
      pBullet: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffeca8).multiplyScalar(1.6), toneMapped: false }),
      eBullet: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a2a).multiplyScalar(1.7), toneMapped: false }),
      blood: new THREE.MeshBasicMaterial({ color: 0x180202, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      scorch: new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.58, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      pool: new THREE.MeshBasicMaterial({ map: p.glow, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
      nade: new THREE.MeshStandardMaterial({ color: 0x3b492c, roughness: 0.55, metalness: 0.25 }),
      molo: new THREE.MeshStandardMaterial({ color: 0x8a4b22, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.85 }),
      glowSprite: new THREE.SpriteMaterial({ map: p.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      lanternBody: new THREE.MeshStandardMaterial({ color: 0xd82818, emissive: 0xff3b18, emissiveIntensity: 2.3, roughness: 0.4 }),
      lanternCap: new THREE.MeshStandardMaterial({ color: 0x161210, roughness: 0.6, metalness: 0.5 }),
      wire: new THREE.LineBasicMaterial({ color: 0x0b0b0e }),
      redGlow: null,
      lampCone: createVolumetricConeMaterial(0xffb262, 0.11),
      headlightCone: createVolumetricConeMaterial(0xfff0c8, 0.13)
    };
    this.M.redGlow = this.M.glowSprite.clone();
    this.M.redGlow.color.set(0xff3a1a);
    this.M.redGlow.opacity = 0.65;

    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: p.moon, fog: false, depthWrite: false })
    );
    this.moon.scale.set(60, 60, 1);
    this.scene.add(this.moon);

    this.flash = new THREE.Sprite(this.M.glowSprite.clone());
    this.flash.material.color.setHex(0xffd480);
    this.flash.visible = false;
    this.scene.add(this.flash);

    const RN = 1600;
    this.rainPos = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      const x = rnd(-24, 24);
      const y = rnd(0, 19);
      const z = rnd(-24, 24);
      this.rainPos.set([x, y, z, x + 0.06, y - 0.78, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0xa6bede, transparent: true, opacity: 0.28 })
    );
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    const PN = 600;
    this.partGeo = new THREE.BufferGeometry();
    this.partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
    this.partGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
    this.partPts = new THREE.Points(
      this.partGeo,
      new THREE.PointsMaterial({ size: 0.11, vertexColors: true, sizeAttenuation: true })
    );
    this.partPts.frustumCulled = false;
    this.scene.add(this.partPts);

    this.bulletPool = [];
    for (let i = 0; i < 96; i++) {
      const m = new THREE.Mesh(this.G.box, this.M.pBullet);
      m.visible = false;
      this.scene.add(m);
      this.bulletPool.push(m);
    }

    this.nadePool = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.G.sphLo, this.M.nade);
      m.scale.setScalar(0.11);
      m.visible = false;
      m.castShadow = true;
      this.scene.add(m);
      this.nadePool.push(m);
    }
  }

  _initPostProcessing() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);

    this.gtaoPass = new GTAOPass(this.scene, this.camera, Math.max(256, Math.round(w * 0.6)), Math.max(256, Math.round(h * 0.6)));
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.blendIntensity = 0.72;
    this.gtaoPass.updateGtaoMaterial({
      radius: 0.48,
      distanceExponent: 1.5,
      thickness: 1.2,
      samples: 12,
      scale: 1.0,
      distanceFallOff: 1.0
    });
    // Exclude Sprites, Lines, Points, and transparent volumetric cones from GTAO G-Buffer
    this.gtaoPass._overrideVisibility = () => {
      const cache = this.gtaoPass._visibilityCache;
      this.scene.traverse(obj => {
        if (!obj.visible) return;
        const hide =
          obj.isPoints ||
          obj.isLine ||
          obj.isLine2 ||
          obj.isSprite ||
          (obj.isMesh && obj.material && !Array.isArray(obj.material) && obj.material.transparent && obj.material.depthWrite === false);
        if (hide) {
          obj.visible = false;
          cache.push(obj);
        }
      });
    };

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.36, 0.88);
    this.rainLensPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: this.timeUniform,
        uAspect: { value: w / h }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAspect;
        varying vec2 vUv;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        vec3 rainLayer(vec2 uv, float scale, float speed) {
          vec2 st = uv * vec2(scale, scale * 0.42);
          st.y += uTime * speed * 0.12;
          vec2 id = floor(st);
          vec2 gv = fract(st) - 0.5;
          float h = hash21(id);
          float dropOn = step(0.68, h);
          float dropT = fract(uTime * speed + h * 7.0);
          float y = -0.35 + 0.7 * (1.0 - dropT);
          vec2 p = vec2((h - 0.5) * 0.48 + sin(dropT * 10.0 + h * 6.28) * 0.03, y);
          vec2 d = (gv - p) * vec2(1.0, 0.78);
          float r = length(d);
          float bead = smoothstep(0.16, 0.03, r) * dropOn;
          float trail = smoothstep(0.055, 0.0, abs(gv.x - p.x)) * smoothstep(p.y + 0.34, p.y, gv.y) * step(p.y, gv.y) * dropOn * 0.35;
          vec2 offs = d * (bead * 0.14 + trail * 0.05);
          return vec3(offs, bead);
        }

        void main() {
          vec2 centerVec = (vUv - 0.5) * vec2(uAspect, 1.0);
          float edgeMask = smoothstep(0.38, 0.86, length(centerVec) * 1.15);
          vec3 r1 = rainLayer(vUv * vec2(uAspect, 1.0), 11.0, 0.22);
          vec3 r2 = rainLayer((vUv + 0.37) * vec2(uAspect, 1.0), 17.0, 0.34);
          vec2 refr = clamp((r1.xy + r2.xy * 0.7) * edgeMask * 0.16, vec2(-0.0055), vec2(0.0055));
          vec4 col = texture2D(tDiffuse, clamp(vUv - refr, 0.002, 0.998));
          float spec = (r1.z + r2.z * 0.7) * edgeMask;
          col.rgb += vec3(0.45, 0.55, 0.72) * spec * 0.09;
          gl_FragColor = col;
        }
      `
    });
    this.smaaPass = new SMAAPass();
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtaoPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.rainLensPass);
    this.composer.addPass(this.smaaPass);
    this.composer.addPass(this.outputPass);
  }

  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.gtaoPass.setSize(
      Math.max(256, Math.round(w * dpr * 0.6)),
      Math.max(256, Math.round(h * dpr * 0.6))
    );
    this.bloomPass.resolution.set(w, h);
    this.rainLensPass.uniforms.uAspect.value = w / h;
    this.camera.aspect = w / h;
    this.baseFov = this.camera.fov = w < h ? 74 : 62;
    this.camera.updateProjectionMatrix();
  }

  cycleQuality() {
    this.qualityMode = (this.qualityMode + 2) % 3; // 2 -> 1 -> 0 -> 2
    this.gtaoPass.enabled = this.qualityMode === 2;
    this.rainLensPass.enabled = this.qualityMode === 2;
    this.reflectStrengthUniform.value = this.qualityMode === 2 ? 0.72 : 0;
    this.bloomEnabled = this.qualityMode >= 1;
    this.smaaPass.enabled = this.qualityMode >= 1;
    return this.qualityMode;
  }

  getQualityLabel() {
    return this.qualityMode === 2 ? '极致电影' : this.qualityMode === 1 ? '标准高清' : '流畅直出';
  }

  setReflectHideObjects(list) {
    this.reflectHideObjects = list || [];
  }

  _renderReflection() {
    if (this.qualityMode < 2) return;
    const cam = this.camera;
    const rCam = this.reflectCam;
    rCam.fov = cam.fov;
    rCam.aspect = cam.aspect;
    rCam.near = cam.near;
    rCam.far = 320;
    rCam.updateProjectionMatrix();

    cam.getWorldDirection(this._camFwd);
    const p = cam.position;
    rCam.position.set(p.x, -p.y, p.z);
    rCam.up.set(0, 1, 0);
    rCam.lookAt(p.x + this._camFwd.x * 10, -(p.y + this._camFwd.y * 10), p.z + this._camFwd.z * 10);
    rCam.updateMatrixWorld();

    this.reflectMatrix
      .copy(this._biasMatrix)
      .multiply(rCam.projectionMatrix)
      .multiply(rCam.matrixWorldInverse);

    const hidden = [];
    for (const o of this.reflectHideObjects) {
      if (o && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    if (this.rain && this.rain.visible) {
      this.rain.visible = false;
      hidden.push(this.rain);
    }

    const prevShadow = this.renderer.shadowMap.autoUpdate;
    const prevTarget = this.renderer.getRenderTarget();
    if (this.sun.shadow.map && (!this.heroSpot.castShadow || this.heroSpot.shadow.map)) {
      this.renderer.shadowMap.autoUpdate = false;
    }
    this.renderer.state.buffers.depth.setTest(true);
    this.renderer.state.buffers.depth.setMask(true);
    this.renderer.setRenderTarget(this.reflectRT);
    this.renderer.clear();
    this.renderer.render(this.scene, rCam);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.shadowMap.autoUpdate = prevShadow;

    for (const o of hidden) o.visible = true;
  }

  render() {
    if (this.qualityMode >= 1) {
      this._renderReflection();
      this.renderer.state.buffers.depth.setTest(true);
      this.renderer.state.buffers.depth.setMask(true);
      this.composer.render();
    } else {
      this.renderer.state.buffers.depth.setTest(true);
      this.renderer.state.buffers.depth.setMask(true);
      this.renderer.render(this.scene, this.camera);
    }
  }
}
