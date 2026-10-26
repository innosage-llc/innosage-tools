import type { SceneReauthorizationPrompt } from './visual-remix-reauth-contract';
export type SceneConsentModel = {
  handle: string;
  clientName: string;
  clientId: string;
  redirectHost: string;
  isLoopback: boolean;
  referenceEnabled?: boolean;
  untilRevokedEnabled?: boolean;
  reauthorization?: {requestId:string;expiresAt:number;scriptNonce:string};
  reauthorizationUnavailable?: boolean;
};
export type SceneSharingState = {
  available: boolean;
  canConnect: boolean;
  canDisconnect: boolean;
  phase: 'disconnected' | 'connecting' | 'awaiting-consent' | 'connected' | 'revoking' | 'recovery' | 'error';
  proof?: string;
  expiresAt?: number | null;
  lifetime?: 'until-revoked';
  untilRevokedAvailable?: boolean;
  error?: string;
  notice?: string;
  diagnostic?: { status: number; requestId?: string; version?: string; revision?: string };
  revocationConfirmed?: boolean;
  reference?: 'uploading' | 'ready';
  reauthorizationRequired?: boolean;
  reauthorizationPrompt?: SceneReauthorizationPrompt;
};
export type SceneSharingProps = {
  state: SceneSharingState;
  reference?: { name: string; width: number; height: number };
  onConnect: (options?: { referencePixels: boolean; reuseCrops: boolean; untilRevoked?: boolean }) => void;
  onDisconnect: () => void;
  consentRequested?: boolean;
  onReauthorize?: () => void;
  onApproveReauthorization?: (requestId:string,confirmed:boolean) => void;
  onDismissReauthorization?: () => void;
};
