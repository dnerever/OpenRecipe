import type { Frontmatter, Phase } from '@openrecipe/core';

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

export type Visibility = 'public' | 'private';

export type RecipeSummary = {
  slug: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  forkCount: number;
  updatedAt: string;
};

export type RecipeResponse = {
  recipe: {
    owner: { handle: string; name: string; image: string | null };
    slug: string;
    title: string;
    description: string | null;
    visibility: Visibility;
    forkCount: number;
    starCount: number;
    createdAt: string;
    updatedAt: string;
    canEdit: boolean;
  };
  version: { id: string; message: string; createdAt: string };
  content: string;
  doc: { frontmatter: Frontmatter; phases: Phase[] };
};

export type RecipeIssueWire = {
  path: string;
  message: string;
  line: number | null;
  column: number | null;
};

/** Thrown for any non-2xx so callers can branch on status and validation issues. */
export class ApiError extends Error {
  // Written out rather than declared as constructor parameter properties:
  // `erasableSyntaxOnly` forbids those, since Node strips types without
  // transforming them.
  readonly status: number;
  readonly issues: RecipeIssueWire[] | undefined;

  constructor(status: number, message: string, issues?: RecipeIssueWire[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
      issues?: RecipeIssueWire[];
    } | null;
    throw new ApiError(
      res.status,
      body?.message ?? body?.error ?? `Request failed (${res.status})`,
      body?.issues,
    );
  }

  return (await res.json()) as T;
}

export const fetchHealth = () => request<Health>('/api/health');
export const fetchMe = () => request<{ user: PublicUser | null }>('/api/me');

export const fetchRecipe = (handle: string, slug: string) =>
  request<RecipeResponse>(`/api/recipes/${handle}/${slug}`);

export const fetchUserRecipes = (handle: string) =>
  request<{
    owner: { handle: string; name: string; image: string | null };
    recipes: RecipeSummary[];
  }>(`/api/users/${handle}/recipes`);

export const createRecipe = (input: { content: string; slug?: string; visibility?: Visibility }) =>
  request<RecipeResponse>('/api/recipes', { method: 'POST', body: JSON.stringify(input) });

export const setVisibility = (handle: string, slug: string, visibility: Visibility) =>
  request<{ slug: string; visibility: Visibility }>(`/api/recipes/${handle}/${slug}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visibility }),
  });

export const rawUrl = (handle: string, slug: string) => `/api/recipes/${handle}/${slug}/raw`;
