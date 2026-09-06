export type PublicUser = {
  id: string;
  handle: string;
  name: string;
  image: string | null;
  bio: string | null;
  createdAt: string;
  email?: string;
};

export type Health = {
  status: string;
  database: 'up' | 'down';
  schemaVersion: number;
  auth: { emailPassword: boolean; github: boolean };
  uptimeSeconds: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return (await res.json()) as T;
}

export const fetchHealth = () => get<Health>('/api/health');
export const fetchMe = () => get<{ user: PublicUser | null }>('/api/me');
