import { useRef } from 'react';

interface Props {
  axis: 'x' | 'y';
  onDragStart: () => void;
  onDelta: (dx: number, dy: number) => void;
  onReset: () => void;
  label: string;
}

/**
 * Drag grip for resizing an adjacent panel. Place inside a `relative`
 * wrapper on the shared edge; double-click resets to the default size.
 */
export function ResizeHandle({ axis, onDragStart, onDelta, onReset, label }: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const edgeClass =
    axis === 'x'
      ? 'top-0 bottom-0 -right-1 w-2 cursor-col-resize'
      : 'left-0 right-0 -bottom-1 h-2 cursor-row-resize';

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label} (drag to resize, double-click to reset)`}
      className={`absolute ${edgeClass} z-40 touch-none select-none group/handle flex items-center justify-center`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging.current = true;
        start.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onDragStart();
      }}
      onPointerMove={(e) => {
        if (!dragging.current || !start.current) return;
        e.preventDefault();
        onDelta(e.clientX - start.current.x, e.clientY - start.current.y);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        dragging.current = false;
        start.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = false;
        start.current = null;
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
    >
      <span
        className={
          axis === 'x'
            ? 'w-1 h-10 rounded-full bg-telegram-border group-hover/handle:bg-telegram-primary transition-colors'
            : 'h-1 w-10 rounded-full bg-telegram-border group-hover/handle:bg-telegram-primary transition-colors'
        }
      />
    </div>
  );
}
