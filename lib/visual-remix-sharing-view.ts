export type SceneConsentModel = {
  handle: string;
  clientName: string;
  clientId: string;
  redirectHost: string;
  isLoopback: boolean;
};
export type SceneSharingState = {
  available: boolean;
  canConnect: boolean;
  canDisconnect: boolean;
  phase: 'disconnected' | 'connecting' | 'awaiting-consent' | 'connected' | 'revoking' | 'error';
  proof?: string;
  expiresAt?: number;
  error?: string;
  revocationConfirmed?: boolean;
};
export type SceneSharingProps = {
  state: SceneSharingState;
  onConnect: () => void;
  onDisconnect: () => void;
};
