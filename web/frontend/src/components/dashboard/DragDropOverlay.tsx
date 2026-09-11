import { motion } from 'framer-motion';
import { UploadCloud } from 'lucide-react';

export function DragDropOverlay() {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none"
        >
            <motion.div
                initial={{ scale: 0.85, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 12 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="glass-strong sheen text-telegram-text rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl"
            >
                <motion.div
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="p-4 bg-telegram-primary/10 rounded-full"
                >
                    <UploadCloud className="w-12 h-12 text-telegram-primary" />
                </motion.div>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-telegram-text">Drop files to upload</h3>
                    <p className="text-telegram-subtext text-sm mt-1">Files will be uploaded to the current folder</p>
                </div>
            </motion.div>
        </motion.div>
    );
}
