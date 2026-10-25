'use client';

import React, { useState } from 'react';
import type { SceneSharingProps } from '../../lib/visual-remix-sharing-view';

export function SceneSharingPanel({ state, onConnect, onDisconnect }: SceneSharingProps) {
  const [confirmFields, setConfirmFields] = useState<boolean>(false);
  const [confirmRetention, setConfirmRetention] = useState<boolean>(false);

  const canConnect =
    state.canConnect &&
    state.available &&
    (state.phase === 'disconnected' || state.phase === 'error') &&
    confirmFields &&
    confirmRetention;

  const canDisconnect = state.canDisconnect && (
    state.phase === 'connecting' ||
    state.phase === 'awaiting-consent' ||
    state.phase === 'connected' ||
    state.phase === 'error');

  const disconnectLabel =
    state.phase === 'connecting' || state.phase === 'awaiting-consent'
      ? 'Cancel'
      : state.phase === 'revoking'
      ? 'Revoking...'
      : 'Disconnect';

  const phaseLabel: Record<typeof state.phase, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    'awaiting-consent': 'Awaiting Consent',
    connected: 'Browser sharing authorized',
    revoking: 'Revoking...',
    error: 'Error',
  };

  return (
    <section className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4 max-w-lg text-gray-900">
      <header className="border-b border-gray-100 pb-2">
        <h2 className="text-base font-semibold text-gray-900">Visual Remix Scene Sharing</h2>
        <p className="text-xs text-gray-500 mt-1">
          Share scene layout and metadata with remote assistant tools.
        </p>
      </header>

      {!state.available && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-600">
          Remote sharing is not enabled; local editing and export still work.
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-600">Connection Status:</span>
        <div role="status" aria-live="polite" className="font-semibold text-gray-800">
          {phaseLabel[state.phase]}
        </div>
      </div>

      {state.phase === 'connected' && <p className="text-xs text-gray-600">Keep this editor visible in a separate window while the agent works; background tabs can be suspended. Returning to this window refreshes the existing heartbeat without extending the lease. Browser consent is confirmed. ChatGPT tool access is not verified by this status. Require a successful scene read and a candidate preview in this editor; a standalone SVG or Image viewer is not an application preview.</p>}
      {state.notice && <p role="status" className="text-xs text-gray-700">{state.notice}</p>}
      {state.diagnostic && <details className="text-xs text-gray-600"><summary>Connection diagnostic</summary><p>HTTP {state.diagnostic.status}; request {state.diagnostic.requestId ?? 'unavailable'}; version {state.diagnostic.version ?? 'unknown'}; revision {state.diagnostic.revision ?? 'unknown'}</p></details>}

      {state.phase === 'error' && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 space-y-1"
        >
          <div className="font-semibold">Sharing Error</div>
          <div>{state.error || 'An error occurred during scene sharing.'}</div>
          <div className="text-red-600 text-xs mt-1">
            An error occurred; this is not a successful disconnection.
          </div>
        </div>
      )}

      {state.revocationConfirmed && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-xs text-green-800">
          Revocation confirmed: active payloads have been removed from the service.
        </div>
      )}

      {state.expiresAt !== undefined && (
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">Expires: </span>
          <span>{new Date(state.expiresAt).toLocaleString()}</span>
        </div>
      )}

      {state.phase === 'awaiting-consent' && state.proof && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md space-y-1">
          <label htmlFor="scene-pairing-proof" className="block text-xs font-semibold text-blue-900">
            Pairing Proof (single-use, valid 5 minutes)
          </label>
          <input
            id="scene-pairing-proof"
            type="text"
            readOnly
            value={state.proof}
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-blue-300 rounded text-gray-800 select-all focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-blue-700">
            Copy and paste this proof code into the authorization page.
          </p>
        </div>
      )}

      <div className="border border-gray-100 bg-gray-50 rounded-md p-3 text-xs text-gray-600 space-y-2">
        <h3 className="font-semibold text-gray-800">Sharing Policy &amp; Protections</h3>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            <strong>Scope:</strong> Shares text, layout, style, captions, provenance, limitations, and used raster descriptors.
          </li>
          <li>
            <strong>Local Data:</strong> Original image pixels, asset files, and exports stay in your browser. No model or social-platform credentials are requested.
          </li>
          <li>
            <strong>Controls:</strong> Remote agent may READ and propose previews only; Apply and export actions remain browser-owned.
          </li>
          <li>
            <strong>Session Duration:</strong> Share expires within 15 minutes; no refresh extension is provided.
          </li>
          <li>
            <strong>Retention:</strong> Shared text/layout is stored by the service. Revoke removes current payloads; expiry cleanup is lazy and data can remain until cleanup.
          </li>
          <li>
            <strong>Manual Authorization:</strong> Connection requires explicit manual grant and can be cancelled or revoked at any time.
          </li>
        </ul>
      </div>

      <div className="space-y-2 pt-1">
        <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmFields}
            disabled={state.phase !== 'disconnected' && state.phase !== 'error'}
            onChange={(e) => setConfirmFields(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            I authorize sharing scene text, layout, style, captions, provenance, limitations, and used raster descriptors (original image pixels and exports are not shared with the service or agent).
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmRetention}
            disabled={state.phase !== 'disconnected' && state.phase !== 'error'}
            onChange={(e) => setConfirmRetention(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            I acknowledge that shared text/layout is stored by the service, expires within 15 minutes without refresh extension, and cleanup is lazy.
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={!canConnect}
          className="flex-1 px-4 py-2 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Connect
        </button>

        <button
          type="button"
          onClick={onDisconnect}
          disabled={!canDisconnect}
          className="flex-1 px-4 py-2 text-xs font-semibold rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
        >
          {disconnectLabel}
        </button>
      </div>
    </section>
  );
}
