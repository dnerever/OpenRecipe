import { users, type User } from '../db/schema.ts';

/**
 * One definition of "a person, as everything else sees them".
 *
 * Recipes, proposals, comments and collaborators all join `users` to name
 * whoever is behind a row, and each of them wants the same four columns. They
 * were spelled out once per service until this file existed, which is how the
 * star list ended up selecting them by hand and the fork list by a copy.
 */
export const userColumns = {
  id: users.id,
  handle: users.handle,
  name: users.name,
  image: users.image,
};

/**
 * The same person minus the id, for a select whose rows go straight to the
 * wire — a version's author, a recipe's owner on a listing card.
 */
export const publicUserColumns = {
  handle: users.handle,
  name: users.name,
  image: users.image,
};

/** A profile header needs more than a listing card does. */
export const profileColumns = {
  ...userColumns,
  bio: users.bio,
  createdAt: users.createdAt,
};

/** A person as a join selects them. */
export type UserRef = Pick<User, 'id' | 'handle' | 'name' | 'image'>;

/** A person as the wire shows them: no id, and above all no email. */
export type PublicUser = Pick<User, 'handle' | 'name' | 'image'>;

/** Narrows a full user row to the four columns a join would have selected. */
export function userRef(user: UserRef): UserRef {
  return { id: user.id, handle: user.handle, name: user.name, image: user.image };
}

/**
 * The wire shape. Never spread a user row straight onto a response — it carries
 * an email address and a password hash's neighbours.
 */
export function publicUser(user: PublicUser) {
  return { handle: user.handle, name: user.name, image: user.image };
}

/**
 * A profile header: the public person, plus the two fields their own page shows
 * and a listing card has no use for. Selected by `profileColumns`.
 */
export function profileUser(user: PublicUser & { bio: string | null; createdAt: Date }) {
  return { ...publicUser(user), bio: user.bio, createdAt: user.createdAt.toISOString() };
}
