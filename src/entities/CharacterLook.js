import * as THREE from 'three';

// Shared shading upgrade for character materials (body, coat, hair, hats):
//  - baked per-vertex occlusion (attribute `aOcc` = 1 - AO; missing attribute reads 0 = unoccluded)
//    darkens indirect light fully and direct light partially, so armpits, collars and brims read in 3D
//  - a cool moonlit rim that separates figures from the dark, rain-soaked streets
// Global uniforms so cinematics (Dead Eye, duels, kill cam) can push the rim for all characters at once.
export const charLook = {
  rimColor: { value: new THREE.Color(0x9cbcff) },
  rimBoost: { value: 1 },
  // Warm bounce from the tungsten-lit wet street: keeps faces readable inside hat-brim shadows
  fill: { value: new THREE.Color(0.1, 0.085, 0.075) }
};

export function applyCharacterLook(material, { rim = 0.3, occ = 1, key = 'char' } = {}) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const hasPrev = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile');
  const rimU = { value: rim };
  const occU = { value: occ };
  material.userData.look = { rim: rimU, occ: occU };

  material.onBeforeCompile = (shader, renderer) => {
    if (hasPrev) prev.call(material, shader, renderer);
    shader.uniforms.uRimColor = charLook.rimColor;
    shader.uniforms.uRimBoost = charLook.rimBoost;
    shader.uniforms.uCharFill = charLook.fill;
    shader.uniforms.uRimStrength = rimU;
    shader.uniforms.uOccStrength = occU;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aOcc;
        varying float vOcc;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vOcc = aOcc;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimBoost;
        uniform vec3 uCharFill;
        uniform float uRimStrength;
        uniform float uOccStrength;
        varying float vOcc;`
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        float lookOcc = clamp(vOcc * uOccStrength, 0.0, 0.95);
        reflectedLight.indirectDiffuse *= 1.0 - lookOcc;
        reflectedLight.indirectSpecular *= 1.0 - lookOcc;
        reflectedLight.directDiffuse *= 1.0 - lookOcc * 0.4;
        reflectedLight.directSpecular *= 1.0 - lookOcc * 0.6;`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimV = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(normal, rimV), 0.0, 1.0), 3.0);
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float rimUp = clamp(dot(normal, upV) * 0.55 + 0.55, 0.0, 1.0);
          outgoingLight += uRimColor * (rimF * rimUp * uRimStrength * uRimBoost * (1.0 - lookOcc) * 0.35);
          outgoingLight += diffuseColor.rgb * uCharFill * (1.0 - lookOcc * 0.6);
        }
        #include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => `${hasPrev && prevKey ? prevKey.call(material) : ''}|look:${key}`;
  material.needsUpdate = true;
  return material;
}

// Stores occlusion (1 - ao, scaled) on a geometry as the `aOcc` attribute read by applyCharacterLook
export function setOcclusion(geometry, ao, strength = 1) {
  const occ = new Float32Array(ao.length);
  for (let i = 0; i < ao.length; i++) occ[i] = Math.min(1, Math.max(0, (1 - ao[i]) * strength));
  geometry.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
  return geometry;
}

// Authored costumes receive the scene's moon and street lamps through the
// normal PBR lighting path. The bind-pose bake attenuates only indirect light.
export function applyHeroOcclusion(material) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float _hero_occ;
        varying float vHeroOcclusion;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHeroOcclusion = _hero_occ;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vHeroOcclusion;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float heroVisibility = 1.0 - clamp(vHeroOcclusion, 0.0, 0.85);
        reflectedLight.indirectDiffuse *= heroVisibility;
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= heroVisibility;
        #endif
        #ifdef USE_SHEEN
          sheenSpecularIndirect *= heroVisibility;
        #endif
        #if defined(USE_ENVMAP) && defined(STANDARD)
          reflectedLight.indirectSpecular *= computeSpecularOcclusion(
            saturate(dot(geometryNormal, geometryViewDir)), heroVisibility, material.roughness);
        #endif`);
  };
  material.customProgramCacheKey = () => previousKey + '|hero-occlusion';
  material.needsUpdate = true;
}
