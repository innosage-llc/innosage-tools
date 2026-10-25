export type SceneConsentModel = {
  handle: string;
  clientName: string;
  clientId: string;
  redirectHost: string;
  isLoopback: boolean;
  referenceEnabled?: boolean;
};
export type SceneSharingState = {
  available: boolean;
  canConnect: boolean;
  canDisconnect: boolean;
  phase: 'disconnected' | 'connecting' | 'awaiting-consent' | 'connected' | 'revoking' | 'error';
  proof?: string;
  expiresAt?: number;
  error?: string;
  notice?: string;
  diagnostic?: { status: number; requestId?: string; version?: string; revision?: string };
  revocationConfirmed?: boolean;
  reference?: 'uploading' | 'ready';
};
export type SceneSharingProps = {
  state: SceneSharingState;
  reference?: { name: string; width: number; height: number };
  onConnect: (options?: { referencePixels: boolean; reuseCrops: boolean }) => void;
  onDisconnect: () => void;
};
