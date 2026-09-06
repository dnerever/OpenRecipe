import type { Frontmatter, LineChange, Phase, SemanticChange } from '@openrecipe/core';

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
  tags: string[];
  totalTimeMinutes: number | null;
  visibility: Visibility;
  forkCount: number;
  updatedAt: string;
};

export type IndexCursor = { updatedAt: string; id: string };

export type IndexPage = {
  recipes: (RecipeSummary & { owner: { handle: string; name: string; image: string | null } })[];
  nextCursor: IndexCursor | null;
  /** Present on the first page only — recounting on every page is wasted work. */
  total?: number;
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

export const fetchPublicIndex = (cursor?: IndexCursor | null) => {
  const params = new URLSearchParams({ limit: '24' });
  if (cursor) {
    params.set('cursorUpdatedAt', cursor.updatedAt);
    params.set('cursorId', cursor.id);
  }
  return request<IndexPage>(`/api/recipes?${params.toString()}`);
};
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

/* ------------------------------------------------------- versions & diff -- */

export type VersionSummary = {
  id: string;
  parentVersionId: string | null;
  mergeParentVersionId: string | null;
  message: string;
  createdAt: string;
  author: { handle: string; name: string; image: string | null };
};

export type VersionContent = {
  id: string;
  parentVersionId: string | null;
  message: string;
  createdAt: string;
  content: string;
};

export type DiffResponse = {
  from: { id: string; message: string; createdAt: string };
  to: { id: string; message: string; createdAt: string; isHead: boolean };
  identical: boolean;
  hunks: LineChange[];
  semantic: SemanticChange[];
};

export const updateRecipe = (
  handle: string,
  slug: string,
  input: { content: string; message?: string },
) =>
  request<RecipeResponse>(`/api/recipes/${handle}/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export const fetchVersions = (handle: string, slug: string) =>
  request<{ headVersionId: string; versions: VersionSummary[] }>(
    `/api/recipes/${handle}/${slug}/versions`,
  );

export const fetchVersion = (handle: string, slug: string, versionId: string) =>
  request<VersionContent>(`/api/recipes/${handle}/${slug}/versions/${versionId}`);

export const fetchDiff = (handle: string, slug: string, from: string, to: string) =>
  request<DiffResponse>(
    `/api/recipes/${handle}/${slug}/diff?${new URLSearchParams({ from, to }).toString()}`,
  );

export const revertRecipe = (handle: string, slug: string, toVersionId: string) =>
  request<RecipeResponse>(`/api/recipes/${handle}/${slug}/revert`, {
    method: 'POST',
    body: JSON.stringify({ toVersionId }),
  });
