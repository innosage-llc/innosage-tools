'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import VideoScissorsView from './VideoScissorsView';
import { videoScissorsRenderer } from '../../lib/video-scissors-browser';
import { VideoScissorsController } from '../../lib/video-scissors';

export default function VideoScissorsApp() {
  const [controller] = useState(() => new VideoScissorsController({ renderer: videoScissorsRenderer }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const commandSequence = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) controller.dispose();
      });
    };
  }, [controller]);

  const nextCommand = () => `ui-${snapshot.sourceGeneration}-${++commandSequence.current}`;
  const onCut = () => {
    void controller.cut({ operationId: nextCommand(), sourceGeneration: snapshot.sourceGeneration, version: snapshot.version });
  };
  const onUndo = () => {
    controller.undo({ operationId: nextCommand(), sourceGeneration: snapshot.sourceGeneration, version: snapshot.version });
  };
  const onDownload = () => {
    const download = controller.createDownload();
    if (!download) return;
    const url = URL.createObjectURL(download.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = download.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <VideoScissorsView
      fileName={snapshot.fileName}
      duration={snapshot.duration}
      originalUrl={snapshot.originalUrl}
      previewUrl={snapshot.previewUrl}
      segments={snapshot.segments}
      busy={snapshot.busy}
      progress={snapshot.progress / 100}
      status={snapshot.status}
      error={snapshot.error}
      canUndo={snapshot.canUndo}
      hasOutput={snapshot.hasOutput}
      onSelect={(file) => { void controller.selectSource(file); }}
      onSegmentsChange={(segments) => { controller.setSegments(segments, snapshot.sourceGeneration); }}
      onCut={onCut}
      onCancel={() => controller.cancel()}
      onUndo={onUndo}
      onDownload={onDownload}
    />
  );
}
