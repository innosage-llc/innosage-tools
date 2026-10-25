'use client';

import React, { useState } from 'react';
import type { SceneSharingProps } from '../../lib/visual-remix-sharing-view';

export function SceneSharingPanel({
  state,
  reference,
  onConnect,
  onDisconnect,
  onReauthorize,
  consentRequested,
}: SceneSharingProps) {
  const [confirmFields, setConfirmFields] = useState<boolean>(false);
  const [confirmRetention, setConfirmRetention] = useState<boolean>(false);
  const [authorizeReferencePixels, setAuthorizeReferencePixels] = useState<boolean>(false);
  const [allowReuseCrops, setAllowReuseCrops] = useState<boolean>(false);

  const isEditablePhase = state.phase === 'disconnected' || state.phase === 'error';

  const canConnect =
    state.canConnect &&
    state.available &&
    isEditablePhase &&
    !state.reauthorizationRequired &&
    confirmFields &&
    confirmRetention;

  const canDisconnect =
    state.canDisconnect &&
    (state.phase === 'connecting' ||
      state.phase === 'awaiting-consent' ||
      state.phase === 'connected' ||
      state.phase === 'recovery' ||
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
    recovery: 'Saved control recovery',
    error: 'Error',
  };

  const handleConnect = () => {
    const untilRevoked = Boolean(state.untilRevokedAvailable && confirmRetention);
    if (reference) {
      onConnect({
        referencePixels: authorizeReferencePixels,
        reuseCrops: authorizeReferencePixels && allowReuseCrops,
        ...(state.untilRevokedAvailable ? { untilRevoked } : {}),
      });
    } else {
      if (state.untilRevokedAvailable) {
        onConnect({
          referencePixels: false,
          reuseCrops: false,
          untilRevoked,
        });
      } else {
        onConnect();
      }
    }
  };

  return (
    <section className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4 max-w-lg text-gray-900 text-xs">
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

      {reference && (
        <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-700 flex items-center justify-between">
          <span className="font-medium text-gray-600">Active Reference Image:</span>
          <span className="font-mono text-gray-800">
            {reference.name} ({reference.width}&times;{reference.height})
          </span>
        </div>
      )}

      {/* Actual Connection Status - Never hidden behind details */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-600">Connection Status:</span>
        <div role="status" aria-live="polite" className="font-semibold text-gray-800">
          {phaseLabel[state.phase]}
        </div>
      </div>

      {/* Actual Reference Storage Status - Never hidden behind details */}
      {state.reference && (
        <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-md text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-600">Reference Storage Status:</span>
            <div role="status" aria-live="polite" className="font-semibold text-gray-800">
              {state.reference === 'uploading'
                ? 'Upload pending'
                : 'Stored and available to authenticated tool'}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {state.reference === 'uploading'
              ? 'Reference upload is pending. GPT image understanding has not been verified.'
              : 'Reference is stored in service D1; GPT image understanding has not been verified, and Connected status does not prove ChatGPT read pixels.'}
          </p>
        </div>
      )}

      {/* Expiry - Never hidden behind details */}
      {(state.expiresAt !== undefined || state.lifetime === 'until-revoked') && (
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">Expires: </span>
          <span>
            {state.expiresAt === null || (state.expiresAt === undefined && state.lifetime === 'until-revoked')
              ? 'Until you Disconnect or revoke'
              : typeof state.expiresAt === 'number'
              ? new Date(state.expiresAt).toLocaleString()
              : 'Until you Disconnect or revoke'}
          </span>
        </div>
      )}

      {/* Notice - Never hidden behind details */}
      {state.notice && <p role="status" className="text-xs text-gray-700">{state.notice}</p>}

      {/* Recovery Phase Notice - Never hidden behind details */}
      {state.phase === 'recovery' && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 space-y-1"
        >
          <div className="font-semibold">Saved Control Recovery</div>
          <p>
            Saved browser control was recovered on this device so you can explicitly Disconnect or revoke remote sharing. Local Scene is untouched; this does not reconnect, does not share pixels, and does not promise browser availability.
          </p>
        </div>
      )}

      {/* Diagnostic - Formatted key */}
      {state.diagnostic && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">Connection diagnostic</summary>
          <p className="mt-1 font-mono text-[11px]">
            HTTP {state.diagnostic.status}; request {state.diagnostic.requestId ?? 'unavailable'}; version {state.diagnostic.version ?? 'unknown'}; revision {state.diagnostic.revision ?? 'unknown'}
          </p>
        </details>
      )}

      {/* Error - Never hidden behind details */}
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

      {/* Revocation Confirmed - Never represent unconfirmed revocation as success */}
      {state.revocationConfirmed && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-xs text-green-800">
          Revocation confirmed: active payloads have been removed from the service.
        </div>
      )}

      {/* Pairing Proof - Never hidden behind details */}
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

      {/* Reauthorization Card - Always show explicit button when reauthorizationRequired and onReauthorize */}
      {state.reauthorizationRequired && onReauthorize && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs space-y-2">
          <div className="font-semibold text-amber-900">Remote Reauthorization Required</div>
          <p className="text-amber-800">
            {state.untilRevokedAvailable
              ? 'Remote access has expired or requires authorization. Local work, editing, and Undo/Redo remain fully preserved. Explicit reauthorization starts a new session with fresh consent; no heartbeat extends an expired session.'
              : 'Remote access has expired or requires authorization. Local work, editing, and Undo/Redo remain fully preserved. Explicit reauthorization starts a new 30-minute session; no heartbeat extends an expired session.'}
          </p>
          <button
            type="button"
            onClick={onReauthorize}
            className="w-full px-4 py-2 text-xs font-semibold rounded-md text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
          >
            Reauthorize and continue
          </button>
        </div>
      )}

      {/* Connected Instructions collapsed in details */}
      {state.phase === 'connected' && (
        <details className="text-xs text-gray-600 bg-blue-50/50 p-3 rounded-md border border-blue-100 space-y-1">
          <summary className="font-semibold text-gray-800 cursor-pointer">Connected Session Instructions</summary>
          <p className="mt-1">
            Keep this editor visible in a separate window while the agent works; background tabs can be suspended. Returning to this window refreshes the existing heartbeat without extending the lease. Browser consent is confirmed. Connected status does not prove ChatGPT read pixels. Require a successful scene read and a candidate preview in this editor; a standalone SVG or Image viewer is not an application preview. Local work, editing, and Undo/Redo remain after expiry. Explicit reauthorization starts a new session; no heartbeat extends it.
          </p>
        </details>
      )}

      {/* Verbose Policy collapsed in details */}
      <details className="border border-gray-100 bg-gray-50 rounded-md p-3 text-xs text-gray-600 space-y-2">
        <summary className="font-semibold text-gray-800 cursor-pointer">Sharing Policy &amp; Protections</summary>
        <ul className="list-disc pl-4 space-y-1 mt-2">
          <li>
            <strong>Scope:</strong>{' '}
            {reference
              ? 'Shares text, layout, style, captions, provenance, limitations, and used raster descriptors. Fields consent alone does not share pixels. Optional reference sharing sends a size-limited PNG derivative (at most 1 MiB and 2048 pixels on the longest side), not original file metadata.'
              : 'Shares text, layout, style, captions, provenance, limitations, and used raster descriptors. Fields consent alone does not share pixels.'}
          </li>
          <li>
            <strong>Local Data:</strong>{' '}
            {reference
              ? 'Without pixel consent, original images and exports remain local in your browser. Shared original remains local for exact crops. Local Scene editing and Undo/Redo remain intact after session expiry. No model or social-platform credentials are requested.'
              : 'Original image pixels, asset files, and exports stay in your browser. Local Scene editing and Undo/Redo remain intact after session expiry. No model or social-platform credentials are requested.'}
          </li>
          <li>
            <strong>Controls:</strong>{' '}
            {reference
              ? 'Remote agent proposals are preview-only; user Apply approves candidate and included crop assets once. Local parameter edits apply automatically with Undo; actual applied and export safety remain unaffected.'
              : 'Remote agent may READ and propose previews only; Apply and export actions remain browser-owned.'}
          </li>
          <li>
            <strong>Session Duration &amp; Lifecycle:</strong>{' '}
            {state.untilRevokedAvailable
              ? 'When until-revoked mode is explicitly consented, sharing remains authorized until you Disconnect or revoke, with browser control remembered on this device (clearing site data loses recovery). Existing timed grants keep their original 15/30-minute expiry with no silent renewal or silent upgrade; choosing new mode requires explicit new consent and reconnection. Browser must stay available; OAuth or platform authorization may still expire.'
              : 'Session runs for an authorized 30-minute remote-sharing duration with no silent renewal or heartbeat extension. Expiry blocks remote access; explicit reauthorization starts a new session.'}
          </li>
          <li>
            <strong>Retention:</strong>{' '}
            {state.untilRevokedAvailable
              ? 'The service caches shared Scene and approved reference content. Inactive cache is eligible for cleanup after 30 minutes without browser sync; scheduled cleanup, backlog, or provider failures can delay deletion. Revoke removes current service payloads; backups and already-delivered host data cannot be recalled (immediate or guaranteed timed physical erasure is not promised). No silent renewal.'
              : reference
              ? 'Shared text/layout and separately approved reference data are stored by the service in existing private service D1 during the 30-minute nonrenewable share; no public URL. Revoke removes active reference payload; expiry blocks access immediately but cleanup is lazy. Backups may retain data up to 7 days, and delivered ChatGPT content cannot be retracted.'
              : 'Shared text/layout is stored by the service; expiry blocks access, cleanup is lazy, backups may retain data up to 7 days, and delivered ChatGPT content cannot be retracted.'}
          </li>
          <li>
            <strong>Verification:</strong> Connected status does not prove ChatGPT read pixels.
          </li>
          <li>
            <strong>Manual Authorization:</strong> Connection requires explicit manual grant and can be cancelled or revoked at any time. No auto-connect or silent renewal.
          </li>
        </ul>
      </details>

      {/* Consent Form Details: initially closed for disconnected, open when reauthorizationRequired */}
      <details
        open={Boolean(state.reauthorizationRequired || consentRequested && isEditablePhase)}
        className="border border-gray-200 rounded-md p-3 text-xs space-y-3"
      >
        <summary className="font-semibold text-gray-800 cursor-pointer">
          {state.reauthorizationRequired ? 'Reauthorization Required' : 'Review sharing consent'}
        </summary>

        {state.reauthorizationRequired ? (
          <div className="pt-2 text-xs text-gray-600 space-y-2">
            <p>
              {state.untilRevokedAvailable
                ? 'Your previous session is no longer authorized. To start a fresh session, click "Reauthorize and continue" above.'
                : 'Your previous session is no longer authorized. To start a fresh 30-minute session, click "Reauthorize and continue" above.'}
            </p>
            <p className="text-gray-500">
              Review fresh consent after the previous session is safely disconnected.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmFields}
                disabled={!isEditablePhase}
                onChange={(e) => setConfirmFields(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                I authorize sharing scene text, layout, style, captions, provenance, limitations, and used raster descriptors. (Fields consent alone does not share image pixels; original images and exports remain local in your browser unless reference pixels are separately approved below).
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRetention}
                disabled={!isEditablePhase}
                onChange={(e) => setConfirmRetention(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                {state.untilRevokedAvailable ? (
                  <>
                    I authorize sharing until I Disconnect or revoke and storing browser control on this device so I can revoke after reopening. Anyone with access to this browser may use this control; clearing site data loses recovery.
                  </>
                ) : (
                  <>
                    I authorize a 30-minute remote-sharing session, with no silent renewal. Shared text/layout and separately approved reference data are stored by the service; expiry blocks access, cleanup is lazy, backups may retain data up to 7 days, and delivered ChatGPT content cannot be retracted.
                  </>
                )}
              </span>
            </label>

            {state.untilRevokedAvailable && (
              <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded border border-gray-200">
                Existing timed grants require explicit new consent and reconnection to choose until-revoked mode; existing 15/30-minute grants keep their original expiry with no silent upgrade.
              </p>
            )}

            {reference && (
              <>
                <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={authorizeReferencePixels}
                    disabled={!isEditablePhase}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAuthorizeReferencePixels(checked);
                      if (!checked) {
                        setAllowReuseCrops(false);
                      }
                    }}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Authorize sharing a normalized PNG copy of this reference ({reference.name}, at most 1 MiB and 2048 pixels on the longest side) with connected agent.
                  </span>
                </label>

                <label
                  className={`flex items-start gap-2 text-xs text-gray-700 ${
                    !authorizeReferencePixels || !isEditablePhase
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={allowReuseCrops}
                    disabled={!authorizeReferencePixels || !isEditablePhase}
                    onChange={(e) => setAllowReuseCrops(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Allow original local photo/logo crops to appear in proposal previews and be embedded/reused ONLY when user Applies a candidate.
                  </span>
                </label>
              </>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleConnect}
                disabled={!canConnect}
                className="w-full px-4 py-2 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Connect
              </button>
            </div>
          </div>
        )}
      </details>

      {/* Disconnect Action */}
      {canDisconnect && (
        <div className="pt-1">
          <button
            type="button"
            onClick={onDisconnect}
            className="w-full px-4 py-2 text-xs font-semibold rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
          >
            {disconnectLabel}
          </button>
        </div>
      )}
    </section>
  );
}
