"use client";

/**
 * GlassOrbScene — วัตถุ 3D เนื้อแก้ว (React Three Fiber) ของ Sovereign OS
 *
 * ใช้ @react-three/fiber (React 18 line = v8) เรนเดอร์ three.js ที่โปรเจกต์มีอยู่แล้ว
 * วัสดุเป็น ShaderMaterial เขียนเอง: เฟรสเนล (ขอบแก้วสว่าง) + การไหลของสีแบบ liquid
 * — ไม่ต้องโหลด HDR/รูปจากภายนอกเลย จึงไม่มี request ออกอินเทอร์เน็ตและไม่ติด CSP
 *
 * ⚠️ ไฟล์นี้ห้ามถูก import แบบ static จากหน้าไหน — ใช้ผ่าน GlassOrb.tsx (dynamic + ssr:false) เท่านั้น
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLASS_ORB_COLORS, type GlassGradientPalette } from "./glassPalettes";

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - worldPos.xyz);
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vLocal;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewW);

    // ขอบแก้ว (เฟรสเนล): ยิ่งมองเฉียงยิ่งสว่าง = อ่านเป็น "เนื้อแก้ว" ไม่ใช่ลูกบอลสี
    float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);

    // การไหลของสี 2 ชั้น ตามตำแหน่งบนผิว + เวลา (ไม่ใช้ texture ใด ๆ)
    float flowA = 0.5 + 0.5 * sin(vLocal.y * 2.6 + uTime * 0.55 + vLocal.x * 1.4);
    float flowB = 0.5 + 0.5 * cos(vLocal.x * 2.2 - uTime * 0.42 + vLocal.z * 1.8);

    vec3 color = mix(uColorA, uColorB, flowA);
    color = mix(color, uColorC, flowB * 0.6);

    // ไฮไลต์หลัก (จุดสะท้อนแสง) + ขอบสว่าง
    float keyLight = pow(max(dot(n, normalize(vec3(0.45, 0.8, 0.55))), 0.0), 16.0);
    color += vec3(0.18) * keyLight;
    color += vec3(0.85) * fresnel;

    float alpha = clamp(0.16 + fresnel * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);

    // แปลงจาก linear working space → sRGB ตาม outputColorSpace ของ three
    #include <colorspace_fragment>
  }
`;

function GlassKnot({ animate, palette }: { animate: boolean; palette: GlassGradientPalette }) {
  const mesh = useRef<THREE.Mesh>(null);
  const colors = GLASS_ORB_COLORS[palette] ?? GLASS_ORB_COLORS.aurora;

  // สร้าง geometry/material ครั้งเดียว (ไม่สร้างใหม่ทุกเฟรม — กัน GPU leak)
  const geometry = useMemo(() => new THREE.TorusKnotGeometry(0.74, 0.25, 240, 40), []);
  const material = useMemo(() => {
    const [a, b, c] = colors;
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color(a) },
        uColorB: { value: new THREE.Color(b) },
        uColorC: { value: new THREE.Color(c) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }, [colors]);

  useFrame((state) => {
    if (!mesh.current) return;
    // frameloop="demand" หยุดเรียกอยู่แล้ว — กันไว้อีกชั้นเผื่อมีคนเปลี่ยน frameloop ภายหลัง
    if (!animate) return;
    const t = state.clock.getElapsedTime();
    // หมุนช้ามาก (ไม่กระตุก) + โยกเล็กน้อยให้ดูมีชีวิต
    mesh.current.rotation.y = t * 0.28;
    mesh.current.rotation.x = 0.32 + Math.sin(t * 0.35) * 0.12;
    material.uniforms.uTime.value = t;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} />;
}

export type GlassOrbSceneProps = {
  palette?: GlassGradientPalette;
  /** false = เรนเดอร์เฟรมเดียวแล้วหยุด (reduced motion) */
  animate?: boolean;
};

export default function GlassOrbScene({ palette = "aurora", animate = true }: GlassOrbSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 3.1], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      frameloop={animate ? "always" : "demand"}
      onCreated={({ gl }) => gl.setClearAlpha(0)}
      style={{ width: "100%", height: "100%" }}
    >
      <GlassKnot animate={animate} palette={palette} />
    </Canvas>
  );
}
