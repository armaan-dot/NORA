/**
 * Isolates the OpenCV.js import. The Emscripten module object is "thenable", so importing it with a
 * dynamic `import()` directly makes the import promise wait on it forever. This module imports it
 * statically and exports a plain wrapper; vision.ts imports THIS module dynamically (code-split, ~11 MB).
 */
import * as cvNamespace from '@techstark/opencv-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cv: any = (cvNamespace as any).default ?? cvNamespace;

export const cvBox: { cv: unknown } = { cv };
