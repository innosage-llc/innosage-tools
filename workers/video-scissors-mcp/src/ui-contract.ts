import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { RemoteMetadata } from '../../../lib/video-scissors-remote.ts';

// Types only: actual UI author is Antigravity gemini-3.8-flash-high HIGH.
// Renderer is Gemini-authored; backend uses official OAuth consent helpers.
export interface ConsentViewModel {
  details: ConsentDescription;
  handle: string; // Official beginConsent handle, never a raw OAuth request state.
  errorCode: 'NONE' | 'EXPIRED' | 'PROOF_REJECTED';
}
export interface ConsentFormFields {
  handle: string;
  decision: 'approve' | 'deny';
  scope: string[];
  browserProof?: string; // Only this proof; NEVER accept a replacement form project/epoch.
}
export interface RemoteConnectionViewModel {
  state: 'disconnected' | 'awaiting_approval' | 'connected' | 'expired' | 'uncertain';
  pairingProof: string | null; // Display locally only; never querystring/history/logs.
  proofExpiresAt: number | null;
  projectExpiresAt: number | null;
  metadata: RemoteMetadata;
}
export interface RemoteConnectionActions {
  // Delivery renews bounded long-polls immediately, even document.hidden.
  // Separate cancellation requests continue during render. No visibility pause.
  // Controller metadata changes publish while a poll is outstanding.
  connect(): Promise<void>;
  revoke(): Promise<void>;
  // Existing Cut/Undo callbacks must use the same adapter localCut/localUndo
  // wrappers as remote execution, keeping the most recent Undo target coherent.
  cut(operationId: string, clips: {start: number; end: number}[]): Promise<void>;
  undo(operationId: string): Promise<void>;
  cancel(): void;
}
