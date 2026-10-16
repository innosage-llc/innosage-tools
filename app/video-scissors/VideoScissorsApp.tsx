'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import VideoScissorsView from './VideoScissorsView';
import { videoScissorsRenderer } from '../../lib/video-scissors-browser';
import { VideoScissorsController } from '../../lib/video-scissors';
import { VideoScissorsRemoteBrowser } from '../../lib/video-scissors-remote-browser';
import RemoteConnectionView from './RemoteConnectionView';

export default function VideoScissorsApp() {
  const [controller] = useState(() => new VideoScissorsController({ renderer: videoScissorsRenderer }));
  const [remote] = useState(() => new VideoScissorsRemoteBrowser(controller));
  const [remoteModel, setRemoteModel] = useState(() => remote.snapshot());
  const [remoteAvailable, setRemoteAvailable] = useState(false);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const commandSequence = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = remote.subscribe(() => setRemoteModel(remote.snapshot()));
    const unload = () => remote.unload();
    window.addEventListener('pagehide', unload);
    const abort = new AbortController();
    void fetch('/remote/capabilities', { signal: abort.signal }).then(async r => {
      if (r.ok && r.headers.get('content-type')?.includes('application/json') && (await r.json()).enabled === true) setRemoteAvailable(true);
    }).catch(() => {});
    return () => {
      abort.abort(); unsubscribe(); window.removeEventListener('pagehide', unload);
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) { void remote.dispose(); controller.dispose(); }
      });
    };
  }, [controller, remote]);

  const nextCommand = () => `ui-${snapshot.sourceGeneration}-${++commandSequence.current}`;
  const onCut = () => {
    void remote.adapter.localCut(nextCommand(), snapshot.segments);
  };
  const onUndo = () => {
    void remote.adapter.localUndo(nextCommand());
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
    <>
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
    {remoteAvailable && <RemoteConnectionView model={remoteModel} onConnect={() => { void remote.connect(); }} onRevoke={() => { void remote.disconnect(); }} />}
    </>
  );
}
