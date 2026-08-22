"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface TerrainViewerProps {
  landWidth: number;
  landLength: number;
  resolution: number;
  heightData?: number[];
  zones?: Array<{
    name: string;
    x: number;
    y: number;
    width: number;
    length: number;
    elevationMean: number;
    color: string;
  }>;
  maxHeight?: number;
}

const TerrainViewer: React.FC<TerrainViewerProps> = ({
  landWidth,
  landLength,
  resolution,
  heightData,
  zones,
  maxHeight = 50,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const rafRef = useRef<number>(0);

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.FogExp2(0x1a1a2e, 0.0015);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    const maxDim = Math.max(landWidth, landLength);
    camera.position.set(maxDim * 0.8, maxDim * 0.6, maxDim * 0.8);
    camera.lookAt(maxDim / 2, 0, maxDim / 2);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
    sun.position.set(maxDim * 0.5, maxDim * 0.8, maxDim * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -maxDim;
    sun.shadow.camera.right = maxDim;
    sun.shadow.camera.top = maxDim;
    sun.shadow.camera.bottom = -maxDim;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = maxDim * 3;
    scene.add(sun);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362a28, 0.4);
    scene.add(hemi);

    // Ground plane (grid reference)
    const gridHelper = new THREE.GridHelper(maxDim * 1.5, 30, 0x444466, 0x222244);
    gridHelper.position.set(maxDim / 2, -0.5, maxDim / 2);
    scene.add(gridHelper);

    // Terrain mesh
    const segmentsX = Math.min(Math.ceil(landWidth / resolution), 256);
    const segmentsZ = Math.min(Math.ceil(landLength / resolution), 256);
    const geometry = new THREE.PlaneGeometry(
      landWidth,
      landLength,
      segmentsX,
      segmentsZ
    );
    geometry.rotateX(-Math.PI / 2);

    // Displace vertices from height data
    const pos = geometry.attributes.position;
    const count = pos.count;
    if (heightData && heightData.length > 0) {
      for (let i = 0; i < count; i++) {
        const v = heightData[i] ?? 0;
        pos.setY(i, v);
      }
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x5a8f3c,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    terrainRef.current = mesh;

    // Zone overlays
    if (zones && zones.length > 0) {
      zones.forEach((zone) => {
        const zGeo = new THREE.BoxGeometry(zone.width, 3, zone.length);
        const zMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(zone.color),
          transparent: true,
          opacity: 0.35,
          roughness: 0.5,
        });
        const zMesh = new THREE.Mesh(zGeo, zMat);
        zMesh.position.set(
          zone.x + zone.width / 2,
          (zone.elevationMean || 0) + 1.5,
          zone.y + zone.length / 2
        );
        zMesh.castShadow = false;
        zMesh.receiveShadow = false;
        scene.add(zMesh);

        // Label (sprite)
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.roundRect(0, 0, 256, 64, 8);
          ctx.fill();
          ctx.font = "bold 28px sans-serif";
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(zone.name, 128, 42);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(zone.width * 0.6, zone.width * 0.15, 1);
        sprite.position.set(
          zone.x + zone.width / 2,
          (zone.elevationMean || 0) + 6,
          zone.y + zone.length / 2
        );
        scene.add(sprite);
      });
    }

    // Axes
    const axes = new THREE.AxesHelper(maxDim * 0.3);
    axes.position.set(0, 0.5, 0);
    scene.add(axes);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(maxDim / 2, maxHeight / 2, maxDim / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = maxDim * 0.2;
    controls.maxDistance = maxDim * 3;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.update();
    controlsRef.current = controls;

    // Animate
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Resize
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      if (nw === 0 || nh === 0) return;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [landWidth, landLength, resolution, heightData, zones, maxHeight]);

  useEffect(() => {
    const cleanup = buildScene();
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [buildScene]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[400px] rounded-lg overflow-hidden"
      style={{ background: "#1a1a2e" }}
    />
  );
};

export default TerrainViewer;
