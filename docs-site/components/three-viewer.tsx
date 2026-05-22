'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export type ThreeViewerProps = {
  readonly glb: Uint8Array | undefined;
  readonly height?: number;
  readonly background?: number;
};

/**
 * Tiny three.js GLB viewer with orbit controls. Used inside `<OcjsExample>`
 * to render the result of an in-browser OCCT example. Mounts client-only.
 */
export const ThreeViewer = ({
  glb,
  height = 360,
  background = 0x111111,
}: ThreeViewerProps): ReactNode => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!glb || !containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (cancelled || !containerRef.current) return;

      const container = containerRef.current;
      const width = container.clientWidth || 600;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(background);

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
      camera.position.set(100, 100, 100);

      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1);
      dirLight.position.set(1, 1, 1);
      scene.add(dirLight);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
      container.replaceChildren(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);

      const loader = new GLTFLoader();
      const blob = new Blob([glb as BlobPart], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      loader.load(url, (gltf) => {
        scene.add(gltf.scene);
        URL.revokeObjectURL(url);
      });

      let raf = 0;
      const tick = (): void => {
        controls.update();
        renderer.render(scene, camera);
        raf = globalThis.requestAnimationFrame(tick);
      };
      tick();

      cleanup = () => {
        globalThis.cancelAnimationFrame(raf);
        controls.dispose();
        renderer.dispose();
        container.replaceChildren();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [glb, height, background]);

  return (
    <div
      ref={containerRef}
      aria-label="Three.js GLB viewer"
      style={{ width: '100%', height }}
      className="rounded-lg border border-fd-border bg-fd-muted/40"
    />
  );
};
