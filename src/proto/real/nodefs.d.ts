// The one Node API the tests use to read a baked region from disk (the project has no Node types).
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
