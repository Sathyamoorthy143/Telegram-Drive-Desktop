import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { Rig } from './Scene3D';

const SATELLITES = [
    { radius: 2.6, speed: 0.55, size: 0.28, color: '#fbbf24', offset: 0, y: 0.5 },
    { radius: 3.1, speed: -0.4, size: 0.22, color: '#1e3a8a', offset: 2.1, y: -0.35 },
    { radius: 2.9, speed: 0.32, size: 0.24, color: '#2563eb', offset: 4.2, y: 0.9 },
];

/** Small "file block" satellites orbiting the cloud. */
function Satellites() {
    const group = useRef<THREE.Group>(null!);
    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        group.current.children.forEach((child, i) => {
            const s = SATELLITES[i];
            const a = t * s.speed + s.offset;
            child.position.set(Math.cos(a) * s.radius, s.y + Math.sin(t * 0.8 + s.offset) * 0.25, Math.sin(a) * s.radius * 0.55);
            child.rotation.x = t * 0.9 + s.offset;
            child.rotation.y = t * 0.7 + s.offset;
        });
    });
    return (
        <group ref={group}>
            {SATELLITES.map((s, i) => (
                <mesh key={i}>
                    <boxGeometry args={[s.size, s.size, s.size]} />
                    <meshStandardMaterial color={s.color} roughness={0.3} metalness={0.4} />
                </mesh>
            ))}
        </group>
    );
}

/** Stylised cloud built from overlapping spheres, with a liquid-metal core. */
function Cloud() {
    const group = useRef<THREE.Group>(null!);
    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        group.current.rotation.y = Math.sin(t * 0.25) * 0.18;
        group.current.position.y = Math.sin(t * 0.6) * 0.12;
    });
    return (
        <group ref={group}>
            {/* Liquid core */}
            <mesh position={[0, 0.1, 0]} scale={1.25}>
                <sphereGeometry args={[1, 48, 48]} />
                <MeshDistortMaterial color="#2563eb" distort={0.35} speed={2.2} roughness={0.25} metalness={0.35} />
            </mesh>
            {/* Puffs */}
            <Float speed={2.4} rotationIntensity={0.2} floatIntensity={0.9}>
                <mesh position={[-1.15, -0.15, 0.1]}>
                    <sphereGeometry args={[0.72, 32, 32]} />
                    <meshStandardMaterial color="#1e3a8a" roughness={0.4} metalness={0.2} flatShading />
                </mesh>
            </Float>
            <Float speed={2} rotationIntensity={0.2} floatIntensity={1.1}>
                <mesh position={[1.2, -0.1, -0.1]}>
                    <sphereGeometry args={[0.66, 32, 32]} />
                    <meshStandardMaterial color="#3b82f6" roughness={0.4} metalness={0.2} flatShading />
                </mesh>
            </Float>
            <Float speed={2.8} rotationIntensity={0.25} floatIntensity={1}>
                <mesh position={[0.55, 0.75, 0.15]}>
                    <sphereGeometry args={[0.52, 32, 32]} />
                    <meshStandardMaterial color="#fbbf24" roughness={0.35} metalness={0.3} flatShading />
                </mesh>
            </Float>
            <Float speed={2.2} rotationIntensity={0.25} floatIntensity={0.8}>
                <mesh position={[-0.5, 0.7, -0.2]}>
                    <sphereGeometry args={[0.45, 32, 32]} />
                    <meshStandardMaterial color="#93c5fd" roughness={0.4} metalness={0.2} flatShading />
                </mesh>
            </Float>
            {/* Wireframe halo ring */}
            <mesh rotation={[Math.PI / 2.4, 0, 0]}>
                <torusGeometry args={[2.35, 0.05, 12, 80]} />
                <meshStandardMaterial color="#1e3a8a" wireframe transparent opacity={0.6} />
            </mesh>
            <Satellites />
        </group>
    );
}

/**
 * Interactive 3D hero: a floating cloud of spheres with orbiting "file"
 * satellites. The whole scene parallax-follows the pointer.
 */
export function CloudHero3D({ className }: { className?: string }) {
    return (
        <div className={className} aria-hidden="true">
            <Canvas
                dpr={[1, 1.75]}
                camera={{ position: [0, 0.4, 7], fov: 45 }}
                gl={{ alpha: true, antialias: true }}
            >
                <ambientLight intensity={0.8} />
                <directionalLight position={[5, 6, 4]} intensity={1.25} />
                <pointLight position={[-5, -3, 3]} intensity={26} distance={16} color="#fbbf24" />
                <Cloud />
                <Sparkles count={90} scale={[10, 7, 5]} size={2.5} speed={0.3} color="#2563eb" opacity={0.75} />
                <Rig intensity={0.7} />
            </Canvas>
        </div>
    );
}
