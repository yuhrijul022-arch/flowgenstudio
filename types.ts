
export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
export type ImageQuality = 'Standard' | 'High Quality';

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  thumbnailPrompt?: string;
}

export interface UserDoc {
  id: string;
  email: string | null;
  username: string | null;
  credits: number;
  tier: string;
  created_at: string;
}

/**
 * Supabase User shape adapter — maps Supabase auth user metadata
 * to the properties expected by existing UI components.
 */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}
