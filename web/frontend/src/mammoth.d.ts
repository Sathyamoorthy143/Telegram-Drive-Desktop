// Minimal typings for the `mammoth` package (ships no TS declarations).
declare module 'mammoth' {
    export interface MammothResult {
        value: string;
        messages: { type: string; message: string }[];
    }
    export function convertToHtml(
        input: { arrayBuffer: ArrayBuffer },
        options?: Record<string, unknown>,
    ): Promise<MammothResult>;
}
