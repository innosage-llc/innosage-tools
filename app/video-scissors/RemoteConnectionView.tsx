"use client";

import React from 'react';
import type { RemoteConnectionViewModel } from '../../workers/video-scissors-mcp/src/ui-contract';
import {
  Radio,
  KeyRound,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Info,
  ShieldCheck,
  Scissors,
} from 'lucide-react';

export interface RemoteConnectionViewProps {
  model: RemoteConnectionViewModel;
  onConnect: () => void;
  onRevoke: () => void;
}

function formatExpiry(timestamp: number | null): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  try {
    const ms = timestamp > 1e11 ? timestamp : timestamp * 1000;
    return new Date(ms).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }
}

export default function RemoteConnectionView({
  model,
  onConnect,
  onRevoke,
}: RemoteConnectionViewProps) {
  const isConnectDisabled =
    model.state === 'awaiting_approval' ||
    model.state === 'connected' ||
    model.state === 'uncertain';

  const showDisconnect =
    model.state === 'connected' ||
    model.state === 'awaiting_approval' ||
    model.state === 'uncertain';

  const proofExpiryStr = formatExpiry(model.proofExpiresAt);
  const projectExpiryStr = formatExpiry(model.projectExpiresAt);

  const statusConfig: Record<
    RemoteConnectionViewModel['state'],
    { label: string; badgeClass: string; icon: React.ComponentType<{ size?: number; className?: string }> }
  > = {
    disconnected: {
      label: 'Disconnected',
      badgeClass: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      icon: Info,
    },
    awaiting_approval: {
      label: 'Awaiting Authorization',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: Clock,
    },
    connected: {
      label: 'Connected',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: CheckCircle2,
    },
    expired: {
      label: 'Session Expired',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: AlertCircle,
    },
    uncertain: {
      label: 'Connection Uncertain',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      icon: AlertTriangle,
    },
  };

  const currentStatus = statusConfig[model.state] || statusConfig.disconnected;
  const StatusIcon = currentStatus.icon;

  return (
    <div className="rounded-2xl bg-zinc-50/80 border border-zinc-200/90 p-5 space-y-4">
      {/* Header and Status */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
            <Radio size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Experimental Remote Control</h3>
            <p className="text-[11px] text-zinc-500">ChatGPT MCP video editing integration</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${currentStatus.badgeClass}`}
          >
            <StatusIcon size={13} />
            <span>{currentStatus.label}</span>
          </span>
        </div>
      </div>

      {/* Uncertain Status Alert */}
      {model.state === 'uncertain' && (
        <div
          role="status"
          className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1"
        >
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
            <span>Connection Acknowledgement Uncertain</span>
          </div>
          <p>
            Command delivery acknowledgement is currently uncertain. Local video edits remain safe and intact, but remote execution status could not be verified. You may disconnect and reconnect if necessary.
          </p>
        </div>
      )}

      {/* One-Time Pairing Proof Display (displayed only when non-null) */}
      {model.pairingProof && (
        <div className="p-3.5 rounded-xl bg-orange-50/80 border border-orange-200/90 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-orange-950">
            <div className="flex items-center gap-1.5">
              <KeyRound size={14} className="text-orange-600" />
              <span>One-Time Browser Pairing Proof</span>
            </div>
            {proofExpiryStr && (
              <span className="font-mono text-[11px] text-orange-700 font-normal">
                Expires: {proofExpiryStr}
              </span>
            )}
          </div>
          <p className="text-xs text-orange-800">
            Enter this pairing proof code in the ChatGPT authorization consent window to complete connection:
          </p>
          <div className="bg-white px-3 py-2 rounded-lg border border-orange-300 font-mono text-sm sm:text-base font-bold text-orange-950 text-center tracking-wider select-all">
            <code>{model.pairingProof}</code>
          </div>
        </div>
      )}

      {/* Expiry Information */}
      {projectExpiryStr && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Clock size={13} className="text-zinc-400" />
          <span>
            Session expires at: <strong className="text-zinc-700 font-mono">{projectExpiryStr}</strong>
          </span>
        </div>
      )}

      {/* Action Controls */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={onConnect}
          disabled={isConnectDisabled}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all bg-orange-600 hover:bg-orange-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Radio size={14} />
          <span>Connect experimental ChatGPT control</span>
        </button>

        {showDisconnect && (
          <button
            type="button"
            onClick={onRevoke}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50"
          >
            <XCircle size={14} />
            <span>Disconnect</span>
          </button>
        )}
      </div>

      {/* Operational Explanations & Disclosures */}
      <div className="space-y-1.5 text-xs text-zinc-600 pt-2 border-t border-zinc-200">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-zinc-400 shrink-0 mt-0.5" />
          <p>
            <strong className="text-zinc-800">Keep tab open:</strong> Background command delivery continues while using ChatGPT. If you reload this tab, your video must be reselected and a fresh pairing initiated.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Scissors size={14} className="text-zinc-400 shrink-0 mt-0.5" />
          <p>
            <strong className="text-zinc-800">Local controls active:</strong> Local Cut and Undo buttons always work directly in your browser without requiring a remote connection.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="text-emerald-600 shrink-0 mt-0.5" />
          <p>
            <strong className="text-zinc-800">Media-local privacy:</strong> Video files and frames never leave your computer. Remote connection only handles control instructions for 30-minute finite sessions.
          </p>
        </div>
      </div>
    </div>
  );
}
