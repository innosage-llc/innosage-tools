export const SCENE_REAUTH_CHANNEL='visual-remix-reauthorization-v1';
export type SceneReauthorizationPrompt={requestId:string;clientId:string;clientName:string;redirectHost:string;resource:string;expiresAt:number;state:'pending'|'issuing'|'sent'|'error';error?:string};
