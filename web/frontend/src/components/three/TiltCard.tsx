import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface TiltCardProps {
    children: React.ReactNode;
    className?: string;
    /** Max tilt in degrees (default 8). */
    intensity?: number;
    /** Extra perspective distance in px (default 900). */
    perspective?: number;
}

/**
 * Pointer-tracked 3D tilt wrapper (same spring feel as the dashboard
 * FileCard). Drop any card inside and it lifts/tilts toward the cursor,
 * then eases back on leave.
 */
export function TiltCard({ children, className, intensity = 8, perspective = 900 }: TiltCardProps) {
    const ref = useRef<HTMLDivElement>(null);
    const px = useMotionValue(0.5);
    const py = useMotionValue(0.5);
    const rotateX = useSpring(useTransform(py, [0, 1], [intensity, -intensity]), { stiffness: 260, damping: 22 });
    const rotateY = useSpring(useTransform(px, [0, 1], [-intensity, intensity]), { stiffness: 260, damping: 22 });

    const handleMove = (e: React.MouseEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        px.set((e.clientX - rect.left) / rect.width);
        py.set((e.clientY - rect.top) / rect.height);
    };
    const reset = () => {
        px.set(0.5);
        py.set(0.5);
    };

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMove}
            onMouseLeave={reset}
            style={{ rotateX, rotateY, transformPerspective: perspective, transformStyle: 'preserve-3d' }}
            className={className}
        >
            {children}
        </motion.div>
    );
}
