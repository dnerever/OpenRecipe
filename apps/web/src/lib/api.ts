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
  /** The hero image, cached on the row so a listing never parses YAML. */
  imageUrl: string | null;
  tags: string[];
  totalTimeMinutes: number | null;
  visibility: Visibility;
  forkCount: number;
  starCount: number;
  updatedAt: string;
};

export type IndexCursor = { updatedAt: string; id: string };

export type IndexPage = {
  recipes: (RecipeSummary & { owner: { handle: string; name: string; image: string | null } })[];
  nextCursor: IndexCursor | null;
  /** Present on the first page only — recounting on every page is wasted work. */
  total?: number;
};

/**
 * Where a fork came from, as much of it as this viewer may know.
 * `{ visible: false }` is §5.1 rule 3 — the source went private after the fork
 * was made, so the derivation is still stated but the source is not named.
 */
export type ForkAttribution =
  { visible: true; owner: RecipeOwner; slug: string; title: string } | { visible: false };

export type RecipeOwner = { handle: string; name: string; image: string | null };

export type RecipeResponse = {
  recipe: {
    /** Needed to name this recipe as a proposal's source. */
    id: string;
    owner: RecipeOwner;
    slug: string;
    title: string;
    description: string | null;
    visibility: Visibility;
    forkCount: number;
    starCount: number;
    createdAt: string;
    updatedAt: string;
    imageUrl: string | null;
    canEdit: boolean;
    forkedFrom: ForkAttribution | null;
    viewerHasStarred: boolean;
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
    owner: RecipeOwner & { bio: string | null; createdAt: string };
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

/* ----------------------------------------------------------------- forks -- */

export const forkRecipe = (handle: string, slug: string, into?: string) =>
  request<RecipeResponse>(`/api/recipes/${handle}/${slug}/fork`, {
    method: 'POST',
    body: JSON.stringify(into ? { slug: into } : {}),
  });

export const fetchForks = (handle: string, slug: string) =>
  request<{ forks: (RecipeSummary & { owner: RecipeOwner })[] }>(
    `/api/recipes/${handle}/${slug}/forks`,
  );

/* ------------------------------------------------------ search & stars -- */

export type SearchSort = 'relevance' | 'recent' | 'popular';

export type SearchParams = {
  q?: string | undefined;
  tags?: string[] | undefined;
  sort?: SearchSort | undefined;
  offset?: number | undefined;
};

export type SearchPage = {
  recipes: (RecipeSummary & { owner: RecipeOwner })[];
  total: number;
  sort: SearchSort;
  nextOffset: number | null;
};

export function searchQueryString({ q, tags, sort, offset }: SearchParams): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  for (const tag of tags ?? []) params.append('tag', tag);
  if (sort) params.set('sort', sort);
  if (offset) params.set('offset', String(offset));
  return params.toString();
}

export const searchRecipes = (params: SearchParams) =>
  request<SearchPage>(`/api/search?${searchQueryString(params)}`);

export const fetchTags = (limit = 40) =>
  request<{ tags: { tag: string; count: number }[] }>(`/api/tags?limit=${limit}`);

export const setStarred = (handle: string, slug: string, starred: boolean) =>
  request<{ starred: boolean; starCount: number }>(
    `/api/recipes/${handle}/${slug}/${starred ? 'star' : 'unstar'}`,
    { method: 'POST' },
  );

export const fetchStarredBy = (handle: string) =>
  request<{ owner: RecipeOwner; recipes: (RecipeSummary & { owner: RecipeOwner })[] }>(
    `/api/users/${handle}/stars`,
  );

/* ------------------------------------------------------------- proposals -- */

export type ProposalState = 'open' | 'merged' | 'closed';

export type ProposalRef = { owner: RecipeOwner; slug: string; title: string };

export type ProposalSummary = {
  id: string;
  number: number;
  title: string;
  state: ProposalState;
  createdAt: string;
  updatedAt: string;
  author: RecipeOwner;
  source: ProposalRef;
};

export type ConflictHunkWire = {
  startLine: number;
  endLine: number;
  ours: string[];
  base: string[];
  theirs: string[];
};

export type Mergeability = {
  kind: 'identical' | 'fast-forward' | 'no-op' | 'merged' | 'conflicted';
  clean: boolean;
  conflicts: ConflictHunkWire[];
  /** The marked-up document, present only when the merge conflicts. */
  content: string | null;
};

export type Proposal = ProposalSummary & {
  body: string | null;
  target: ProposalRef;
  baseVersionId: string;
  headVersionId: string;
  mergedVersionId: string | null;
  canMerge: boolean;
  canClose: boolean;
  /** `null` once a proposal is settled — it is a record, not a live question. */
  mergeability: Mergeability | null;
  comments: ProposalComment[];
};

export type ProposalComment = {
  id: string;
  body: string;
  createdAt: string;
  author: RecipeOwner;
};

export type ProposalDiff = {
  from: { id: string };
  to: { id: string };
  identical: boolean;
  hunks: LineChange[];
  semantic: SemanticChange[];
};

const proposalPath = (handle: string, slug: string, number: number) =>
  `/api/recipes/${handle}/${slug}/proposals/${number}`;

export const fetchProposals = (handle: string, slug: string, state?: ProposalState) =>
  request<{ proposals: ProposalSummary[] }>(
    `/api/recipes/${handle}/${slug}/proposals${state ? `?state=${state}` : ''}`,
  );

export const fetchProposal = (handle: string, slug: string, number: number) =>
  request<Proposal>(proposalPath(handle, slug, number));

export const fetchProposalDiff = (handle: string, slug: string, number: number) =>
  request<ProposalDiff>(`${proposalPath(handle, slug, number)}/diff`);

export const openProposal = (
  handle: string,
  slug: string,
  input: { sourceRecipeId: string; title: string; body?: string },
) =>
  request<Proposal>(`/api/recipes/${handle}/${slug}/proposals`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const mergeProposal = (
  handle: string,
  slug: string,
  number: number,
  input: { resolvedContent?: string; message?: string } = {},
) =>
  request<Proposal>(`${proposalPath(handle, slug, number)}/merge`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const closeProposal = (handle: string, slug: string, number: number) =>
  request<Proposal>(`${proposalPath(handle, slug, number)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const commentOnProposal = (handle: string, slug: string, number: number, body: string) =>
  request<ProposalComment>(`${proposalPath(handle, slug, number)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

/* ----------------------------------------------------------------- media -- */

export type UploadedImage = {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  bytes: number;
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * The small copy of an uploaded image. An author may also point `image:` at
 * somebody else's URL, and that one has no thumbnail to ask for — so it is
 * returned untouched rather than mangled into a 404.
 */
export function thumbUrlFor(url: string): string {
  return url.startsWith('/api/media/') ? `${url}/thumb` : url;
}

/**
 * Multipart, not JSON: the bytes go through the API on purpose, because the
 * EXIF a phone writes into a kitchen photo can only be stripped by a server
 * that sees the file.
 */
export async function uploadImage(
  handle: string,
  slug: string,
  file: File,
): Promise<UploadedImage> {
  const form = new FormData();
  form.set('file', file);

  const res = await fetch(`/api/recipes/${handle}/${slug}/media`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadedImage;
}

/* --- lists --- */

/** `null` for a stranger. The owner is a role here, not a separate flag. */
export type ListRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type CollaboratorRole = 'admin' | 'editor' | 'viewer';

export type ListSummary = {
  slug: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  owner: RecipeOwner;
  /**
   * What *you* can see in it. Not denormalized and not the same for everyone —
   * a list counts only the recipes its reader is allowed to read.
   */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  viewerRole: ListRole | null;
  canEdit: boolean;
  canAdmin: boolean;
  isOwner: boolean;
};

export type ListCollaborator = {
  handle: string;
  name: string;
  image: string | null;
  role: CollaboratorRole;
  since: string;
};

export type ListItem = RecipeSummary & { id: string; owner: RecipeOwner; addedAt: string };

export type ListResponse = ListSummary & {
  recipes: ListItem[];
  collaborators: ListCollaborator[];
};

/** A row in the add-to-list picker: a list, plus whether it already holds this recipe. */
export type PickerList = ListSummary & { contains: boolean };

export const fetchList = (handle: string, slug: string) =>
  request<ListResponse>(`/api/lists/${handle}/${slug}`);

export const fetchUserLists = (handle: string) =>
  request<{ owner: RecipeOwner; lists: ListSummary[] }>(`/api/users/${handle}/lists`);

/**
 * Every list you can act on, and — given a recipe — whether each already holds
 * it. One request, so opening the picker costs one round trip rather than one
 * per list.
 */
export const fetchMyLists = (recipe?: { handle: string; slug: string }) =>
  request<{ lists: PickerList[] }>(
    `/api/me/lists${recipe ? `?recipe=${encodeURIComponent(`${recipe.handle}/${recipe.slug}`)}` : ''}`,
  );

export const createList = (input: { title: string; visibility?: Visibility }) =>
  request<ListSummary>('/api/lists', { method: 'POST', body: JSON.stringify(input) });

export const renameList = (
  handle: string,
  slug: string,
  input: { title?: string; description?: string },
) =>
  request<ListSummary>(`/api/lists/${handle}/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteList = (handle: string, slug: string) =>
  request<{ deleted: true }>(`/api/lists/${handle}/${slug}`, { method: 'DELETE' });

export const setListVisibility = (handle: string, slug: string, visibility: Visibility) =>
  request<{ slug: string; visibility: Visibility }>(`/api/lists/${handle}/${slug}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visibility }),
  });

/** The recipe is named the way its URL names it — never by a bare id. */
export const addToList = (handle: string, slug: string, recipe: { handle: string; slug: string }) =>
  request<{ added: true; recipeId: string }>(`/api/lists/${handle}/${slug}/items`, {
    method: 'POST',
    body: JSON.stringify(recipe),
  });

export const removeFromList = (handle: string, slug: string, recipeId: string) =>
  request<{ removed: true; recipeId: string }>(`/api/lists/${handle}/${slug}/items/${recipeId}`, {
    method: 'DELETE',
  });

export const shareList = (
  handle: string,
  slug: string,
  input: { handle: string; role?: CollaboratorRole },
) =>
  request<{ collaborators: ListCollaborator[] }>(`/api/lists/${handle}/${slug}/collaborators`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const setCollaboratorRole = (
  handle: string,
  slug: string,
  target: string,
  role: CollaboratorRole,
) =>
  request<{ collaborators: ListCollaborator[] }>(
    `/api/lists/${handle}/${slug}/collaborators/${target}`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
  );

export const unshareList = (handle: string, slug: string, target: string) =>
  request<{ collaborators: ListCollaborator[] }>(
    `/api/lists/${handle}/${slug}/collaborators/${target}`,
    { method: 'DELETE' },
  );
