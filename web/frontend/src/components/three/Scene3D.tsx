import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

type SceneVariant = 'light' | 'dark';
type ShapeKind = 'ico' | 'torus' | 'octa' | 'box';

interface ShapeSpec {
    position: [number, number, number];
    scale: number;
    color: string;
    kind: ShapeKind;
    speed: number;
    wireframe?: boolean;
}

function buildShapes(variant: SceneVariant): ShapeSpec[] {
    const palette: [string, string, string] =
        variant === 'light'
            ? ['#1e3a8a', '#2563eb', '#fbbf24']
            : ['#3b82f6', '#60a5fa', '#fbbf24'];
    return [
        { position: [-4.4, 1.8, -2.5], scale: 1.15, color: palette[0], kind: 'ico', speed: 0.45, wireframe: true },
        { position: [4.6, -1.4, -2], scale: 1.0, color: palette[1], kind: 'torus', speed: 0.6 },
        { position: [3.6, 2.2, -3], scale: 0.8, color: palette[2], kind: 'octa', speed: 0.8, wireframe: true },
        { position: [-3.4, -2.2, -1.5], scale: 0.75, color: palette[1], kind: 'box', speed: 0.5 },
        { position: [0.4, -2.8, -3.5], scale: 1.3, color: palette[0], kind: 'torus', speed: 0.35, wireframe: true },
        { position: [-1.8, 2.6, -4], scale: 0.9, color: palette[2], kind: 'ico', speed: 0.55 },
        { position: [5.4, 0.8, -4.5], scale: 1.0, color: palette[0], kind: 'octa', speed: 0.4 },
    ];
}

function Shape({ spec }: { spec: ShapeSpec }) {
    const ref = useRef<THREE.Mesh>(null!);
    useFrame((_, delta) => {
        ref.current.rotation.x += delta * spec.speed;
        ref.current.rotation.y += delta * spec.speed * 0.7;
    });
    return (
        <Float speed={2} rotationIntensity={0.55} floatIntensity={1.5}>
            <mesh ref={ref} position={spec.position} scale={spec.scale}>
                {spec.kind === 'ico' && <icosahedronGeometry args={[1, 0]} />}
                {spec.kind === 'torus' && <torusGeometry args={[0.8, 0.28, 16, 40]} />}
                {spec.kind === 'octa' && <octahedronGeometry args={[1, 0]} />}
                {spec.kind === 'box' && <boxGeometry args={[1.1, 1.1, 1.1]} />}
                <meshStandardMaterial
                    color={spec.color}
                    wireframe={spec.wireframe}
                    roughness={0.35}
                    metalness={0.3}
                    flatShading
                    transparent
                    opacity={spec.wireframe ? 0.85 : 0.95}
                />
            </mesh>
        </Float>
    );
}

/** Camera rig — gently follows the pointer for parallax depth. */
export function Rig({ intensity = 1 }: { intensity?: number }) {
    useFrame((state, delta) => {
        state.camera.position.x = THREE.MathUtils.damp(
            state.camera.position.x,
            state.pointer.x * 1.4 * intensity,
            1.8,
            delta,
        );
        state.camera.position.y = THREE.MathUtils.damp(
            state.camera.position.y,
            state.pointer.y * 0.9 * intensity,
            1.8,
            delta,
        );
        state.camera.lookAt(0, 0, 0);
    });
    return null;
}

interface Scene3DProps {
    variant?: SceneVariant;
    className?: string;
    particleCount?: number;
}

/**
 * Reusable interactive 3D background: floating brand-coloured shapes +
 * sparkling particles + pointer-parallax camera. Transparent canvas, so the
 * page background shows through.
 */
export function Scene3D({ variant = 'light', className, particleCount = 140 }: Scene3DProps) {
    const shapes = useMemo(() => buildShapes(variant), [variant]);
    const sparkColor = variant === 'light' ? '#1e3a8a' : '#93c5fd';
    // Dead GL context (low-end GPUs, too many contexts) must not spam the
    // console or leave a frozen canvas: drop the scene, the page background
    // shows through since the canvas was transparent anyway.
    const [glLost, setGlLost] = useState(false);
    if (glLost) return <div className={className} aria-hidden="true" />;
    return (
        <div className={className} aria-hidden="true">
            <Canvas
                dpr={[1, 1.75]}
                camera={{ position: [0, 0, 8], fov: 50 }}
                gl={{ alpha: true, antialias: true }}
                onCreated={({ gl }) => {
                    gl.domElement.addEventListener('webglcontextlost', (e) => {
                        e.preventDefault();
                        setGlLost(true);
                    }, { once: true });
                }}
            >
                <ambientLight intensity={0.7} />
                <directionalLight position={[4, 6, 6]} intensity={1.1} />
                <pointLight position={[-6, -4, 2]} intensity={30} distance={18} color="#fbbf24" />
                {shapes.map((spec, i) => (
                    <Shape key={i} spec={spec} />
                ))}
                <Sparkles
                    count={particleCount}
                    scale={[14, 9, 6]}
                    size={2.2}
                    speed={0.35}
                    color={sparkColor}
                    opacity={0.7}
                />
                <Rig />
            </Canvas>
        </div>
    );
}
