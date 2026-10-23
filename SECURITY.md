# Security

## Reporting a vulnerability

Please report security issues privately, through GitHub's
[**Report a vulnerability**](https://github.com/dnerever/OpenRecipe/security/advisories/new)
form on this repository's Security tab — not in a public issue.

Include what you found, how to reproduce it, and what it could expose. You will
get an acknowledgement within a few days, and a fix or a decision as soon as the
issue is understood.

## Scope

The application in this repository and the deployment at
[openrecipe.onrender.com](https://openrecipe.onrender.com). Of particular
interest:

- anything that reads a **private recipe**, or its versions, images, forks or
  proposals, without being its owner — including learning that one exists
  ([docs/ARCHITECTURE.md §5.1](docs/ARCHITECTURE.md) is the rulebook; a private recipe should
  be indistinguishable from a missing one);
- anything that writes to a recipe, list or proposal without the right to;
- session, password-reset or account-deletion flaws.

Please do not run automated scanners or load tests against the live site, and
do not access other people's data beyond what is needed to show the problem.
