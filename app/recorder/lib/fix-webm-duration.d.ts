declare module 'fix-webm-duration' {
  export default function ysFixWebmDuration(
    blob: Blob,
    duration: number,
    callback: (fixedBlob: Blob) => void
  ): void;
}