# Property Listings API

A CRUD + search API for property listings, built with NestJS and Prisma.
Agents register/log in, create and manage their own listings, and anyone
can browse or search listings without an account.

Short task (about 3–4 hours; submit within 72 hours)Build a small Property Listings API with:
CRUD endpoints for listings (title, price, type: rent/sale/shortlet, bedrooms, location with lat/lng, agent ID)
A search endpoint that filters by type, price range and bedrooms, and returns listings within X km of a given point
Pagination, input validation and sensible error handling
At least a few unit or integration tests
A README explaining setup, your design choices and what you'd improve with more time

## Stack

- **NestJS** (Express) — controllers/services/modules
- **Prisma** + **PostgreSQL**
- **class-validator** / **class-transformer** — request validation
- **@nestjs/jwt** + **bcrypt** — JWT auth and password hashing
- **@nestjs/throttler** — rate limiting
- **Swagger** (`@nestjs/swagger`) — interactive API docs
- **Jest** + **Supertest** — unit and integration tests

## Setup

Needs a running Postgres instance. If you don't have one, the quickest way
to get one is Docker:

```bash
docker run --name property-listings-db \
  -e POSTGRES_USER=pgUser -e POSTGRES_PASSWORD=pgPass1 \
  -p 5432:5432 -d postgres
```

Then, with that instance (or your own) reachable:

```bash
npm install
cp .env.example .env
# edit .env: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE build
# DATABASE_URL, and DB_DATABASE build TEST_DATABASE_URL with a `_test`
# suffix — point them at your Postgres instance and create both databases
# (`createdb <DB_DATABASE>` / `createdb <DB_DATABASE>_test`, or via any
# Postgres client) before migrating.
npx prisma migrate dev    # applies the schema to DATABASE_URL
npm run start:dev
```

The API listens on `http://localhost:3000`. Swagger docs are served at
`http://localhost:3000/docs`.

To load a handful of example agents + listings for manual testing:

```bash
npm run db:seed
```

(this also runs automatically the first time you run `prisma migrate dev`).
It creates three agents — `agent1@example.com`, `agent2@example.com`,
`agent3@example.com`, all with password `password123` — each owning a
couple of seeded listings, so you can log in immediately and try the
protected routes without registering your own agent first.

### Running tests

```bash
npm test          # unit tests (mocked Prisma client)
npm run test:e2e  # integration tests against TEST_DATABASE_URL
```

The e2e suite applies pending migrations to `TEST_DATABASE_URL`, then
truncates every app table before each run for a clean slate — it doesn't
touch your dev database, but it does expect `TEST_DATABASE_URL` to already
point at a real, reachable (and disposable) Postgres database.

## API

All responses are wrapped as `{ statusCode, message, data }`. Errors are
`{ statusCode, message, path, timestamp }`, where `message` is either a
string or (for validation failures) an array of field-level messages.

| Method | Path               | Auth                   | Description                                     |
| ------ | ------------------ | ---------------------- | ----------------------------------------------- |
| POST   | `/auth/register`   | Public                 | Register a new agent                            |
| POST   | `/auth/login`      | Public                 | Log in, get access + refresh tokens             |
| POST   | `/auth/refresh`    | Public (refresh token) | Exchange a refresh token for a new access token |
| POST   | `/auth/logout`     | Bearer token           | Revoke the current session                      |
| POST   | `/auth/logout-all` | Bearer token           | Revoke every session for the agent              |
| POST   | `/listings`        | Bearer token           | Create a listing (owned by the caller)          |
| GET    | `/listings`        | Public                 | List listings, paginated                        |
| GET    | `/listings/search` | Public                 | Search/filter listings (see below)              |
| GET    | `/listings/:id`    | Public                 | Get one listing                                 |
| PATCH  | `/listings/:id`    | Bearer token, owner    | Partially update a listing                      |
| DELETE | `/listings/:id`    | Bearer token, owner    | Delete a listing                                |

`/auth/register`, `/auth/login` and `/auth/refresh` are also rate-limited
(see [Rate limiting](#rate-limiting)).

### Listing shape

```jsonc
{
  "id": "uuid",
  "title": "3-bed apartment in Lekki Phase 1",
  "price": 45000000,
  "type": "RENT" | "SALE" | "SHORTLET",
  "bedrooms": 3,
  "latitude": 6.4488,
  "longitude": 3.4732,
  "address": "Lekki Phase 1, Lagos", // optional
  "agentId": "uuid", // the authenticated agent that created it — not client-settable
  "createdAt": "2026-09-24T15:21:17.443Z",
  "updatedAt": "2026-09-24T15:21:17.443Z"
}
```

## Authentication

Register or log in to get an access token and a refresh token:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@example.com","password":"password123","name":"Jane Agent"}'
# => { "data": { "accessToken": "...", "refreshToken": "...", "agent": { "id": "...", "email": "...", "name": "..." } } }
```

Use the access token as a bearer token on protected routes:

```bash
curl -X POST http://localhost:3000/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"title":"2-bed flat","price":1500000,"type":"RENT","bedrooms":2,"latitude":6.45,"longitude":3.43}'
```

- `POST /listings` uses the authenticated agent's id as `agentId` — it's not
  a field in the request body.
- `PATCH`/`DELETE /listings/:id` additionally check that the caller owns the
  listing; a valid token for a _different_ agent gets a `403`, no token gets
  a `401`.
- Reading listings (`GET /listings`, `/listings/search`, `/listings/:id`)
  requires no auth at all — browsing is public, only managing your own
  listings requires an account.

### Access tokens, refresh tokens and sessions

Every login/register call opens a **session** (a row in the `Session`
table) and issues two tokens tied to it:

- an **access token** (`JWT_EXPIRES_IN`, default `15m`) — sent as the
  bearer token on every protected request;
- a **refresh token** (`JWT_REFRESH_EXPIRES_IN`, default `7d`) — exchanged
  for a new access token once the old one expires, without logging in
  again.

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
# => { "data": { "accessToken": "..." } }
```

The refresh token itself isn't rotated on use — it stays valid until its
own expiry, or until the session is revoked:

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer <accessToken>"       # revokes just this session

curl -X POST http://localhost:3000/auth/logout-all \
  -H "Authorization: Bearer <accessToken>"       # revokes every session for this agent
```

Revoking a session takes effect immediately — both its access token and its
refresh token stop working on the very next request, they don't just wait
out their remaining expiry. That's the point of tying sessions to a
database row rather than relying on JWT expiry alone.

## Rate limiting

`/auth/register`, `/auth/login` and `/auth/refresh` are limited to
`AUTH_THROTTLE_LIMIT` requests (default `30`) per `AUTH_THROTTLE_TTL_MS`
(default `60000`ms) **per IP**, to slow down credential-stuffing/enumeration
attempts. Exceeding it returns a `429`. Every other route falls back to a
much more generous app-wide default (`THROTTLE_LIMIT`/`THROTTLE_TTL_MS`,
default `100`/`60000`ms) meant as basic abuse protection rather than a
strict business rule.

## Pagination

`GET /listings` and the non-geo path of `GET /listings/search` support two
pagination modes, chosen with `paginationType`. `limit` (default `10`, max
`100`) applies to both.

- **`page`** (default). `page` (default `1`). Returns:

  ```jsonc
  {
    "pageItems": [/* ... */],
    "pageMeta": {
      "totalItems": 12,
      "itemCount": 10,
      "itemsPerPage": 10,
      "totalPages": 2,
      "currentPage": 1,
    },
  }
  ```

- **`cursor`** (`?paginationType=cursor`) — opaque, stable-ordering
  pagination: pass `pageCursors.next.cursor` back as `cursor` to get the
  next page, or `pageCursors.previous.cursor` to go back (either is `false`
  when there's no next/previous page). Returns:

  ```jsonc
  {
    "pageEdges": [{ "cursor": null, "node": {/* listing */} }],
    "pageCursors": {
      "first": false,
      "previous": false,
      "next": {
        "cursor": "eyJpZCI6Ii4uLiIsImRpciI6MX0=",
        "page": null,
        "isCurrent": false,
      },
      "last": false,
    },
    "totalCount": 12,
  }
  ```

  The geo branch of search always returns `page` mode's `{ pageItems,
pageMeta }` shape (see below) — `GET
/listings/search?paginationType=cursor&lat=...&lng=...&radiusKm=...`
  (cursor mode _combined with_ a location search) returns a `400` instead;
  distance is computed in application code after the DB query for geo
  search, which cursor pagination's DB-level `cursor: { id }` can't
  paginate through.

## Search

`GET /listings/search` accepts any combination of:

- `type` — `RENT` | `SALE` | `SHORTLET`
- `minPrice`, `maxPrice`
- `bedrooms` — exact match
- `term` — free-text, case-insensitive substring match over `title` OR
  `address`
- `lat`, `lng`, `radiusKm` — return listings within `radiusKm` kilometers of
  `(lat, lng)`, with a `distanceKm` field added to each result. **All three
  must be provided together** — providing only `lat`, for example, returns
  a `400`.
- `sortBy` — `distance` | `price` | `bedrooms` | `createdAt`. `distance`
  only makes sense (and is only accepted) alongside `lat`/`lng`/`radiusKm`;
  omitting `sortBy` defaults to `distance` for a location search, or
  `createdAt` otherwise.
- `sortDirection` — `asc` | `desc`; defaults to `asc` for `distance`,
  `desc` otherwise.

Examples:

```
GET /listings/search?type=SHORTLET&bedrooms=1&lat=6.45&lng=3.43&radiusKm=5
GET /listings/search?term=lekki&sortBy=price&sortDirection=asc
GET /listings/search?lat=6.45&lng=3.43&radiusKm=10&sortBy=price
```

## Design choices

- **`ListingsService` extends a small generic `CrudService` base class**
  (`src/common/database/crud.service.ts`) rather than calling
  `prisma.listing.*` directly. `CrudService<D, T>` wraps a Prisma model
  delegate and provides `create`, `update`, `delete` (with friendly
  handling of Prisma's `P2003` foreign-key-violation error on delete),
  `findFirst(OrThrow)`, `findUnique(OrThrow)`, `count`, and
  `findManyPaginate` (see [Pagination](#pagination)) — so any future model
  gets the same CRUD surface for free by extending the base class and
  supplying a `<Model>MapType` binding its operations to that model's
  Prisma arg types (see `src/listings/dto/listing.maptype.ts`). Domain
  methods on `ListingsService` are named `createListing`/`updateListing`
  rather than `create`/`update`, since reusing those names would override
  (and break the type of) the base class's own generic verbs, which take
  raw Prisma args rather than a flat DTO.

- **`findAll` and the non-geo branch of `search` return
  `findManyPaginate`'s result as-is** — no reshaping on top. The response
  shape depends on `paginationType` (see [Pagination](#pagination)). The
  geo branch of `search` can't use `findManyPaginate` at all, since it
  needs to filter by computed distance _after_ fetching candidates from the
  database — so it paginates in memory by hand, but still returns the same
  `{ pageItems, pageMeta }` shape as page-mode `findManyPaginate`, for
  consistency.

- **`type` is a native Prisma `enum`** (`ListingType`, defined in
  `prisma/schema.prisma`), not a hand-rolled TypeScript one — Postgres
  supports Prisma enums natively, so the database schema itself is the
  single source of truth for valid values, and `@IsEnum(ListingType)`
  (imported straight from `@prisma/client`) is just enforcing at the API
  boundary what the column already guarantees at the storage layer.

- **`DATABASE_URL`/`TEST_DATABASE_URL` are built from smaller
  `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` variables**
  via `${VAR}`-style interpolation in `.env`, rather than one opaque
  connection string per environment — easier to see and change one piece
  (e.g. just the host) without retyping the whole URL. Plain `dotenv`
  (what `@nestjs/config` uses by default) doesn't expand `${VAR}`
  references on its own, so `ConfigModule.forRoot()` is configured with
  `expandVariables: true` (`src/app.module.ts`), which uses `dotenv-expand`
  under the hood.

- **Radius search is computed in application code (Haversine), not
  PostGIS/SQL.** The service applies the non-geo filters (`type`, price
  range, `bedrooms`, `term`) at the database level, then computes distance
  and filters/sorts/paginates the remaining rows in memory
  (`src/common/utils/geo.util.ts`). This is fine at small scale but doesn't
  scale past a few thousand candidate rows — see
  [What I'd improve](#what-id-improve-with-more-time).

- **Response envelope and error shape are consistent across the API**:
  `{ statusCode, message, data }` on success via a global
  `ResponseInterceptor`, and `{ statusCode, message, path, timestamp }` on
  error via a global `HttpExceptionFilter`.

- **`agentId` on `Listing` is a real foreign key to `Agent`**, derived from
  the authenticated caller's JWT rather than accepted as client input — so
  enforcing it as a database relation (rather than a loose string) came for
  free and rules out an agent claiming a listing that isn't theirs.

- **Sessions back the JWTs instead of relying on stateless expiry alone.**
  Every login/register opens a `Session` row; both the access and refresh
  token carry that session's id as a claim. `JwtAuthGuard`
  (`src/auth/guards/jwt-auth.guard.ts`) verifies the token's signature _and_
  that its session still exists and hasn't expired, on every request —
  which is what makes logout/logout-all take effect immediately rather than
  only once the token's own expiry catches up. This trades a bit of
  per-request DB overhead (one indexed lookup by session id) for that
  immediacy, which is the right tradeoff at this scale.

- **Ownership is enforced per-request, not via a separate guard class.**
  `ListingsService.assertOwnership` loads the listing and compares
  `listing.agentId` to the caller's `agentId` before any update/delete,
  throwing `ForbiddenException` on mismatch — simpler than a dedicated
  guard when there's only one resource type and one role to check.

- **`PATCH` for updates** (partial update via `PartialType`) rather than
  `PUT`, since a client updating one field shouldn't have to resend the
  whole listing.

- **One shared rate-limit bucket per IP for `/auth/*`, not per-endpoint.**
  Register/login/refresh all draw from the same `AUTH_THROTTLE_LIMIT`
  budget (via a single `@Throttle()` override applied to all three) rather
  than three separate counters — an attacker trying register-spam,
  credential-stuffing, or refresh-token brute-forcing all hits the same
  wall, without needing to reason about which specific endpoint's counter
  they're consuming.

## What I'd improve with more time

- **Refresh token rotation.** Refresh tokens are currently reusable until
  they expire or the session is revoked; rotating them on each use (and
  detecting reuse of an already-rotated token as a signal of theft) would
  close that gap.
- **Role/admin support.** Right now the only actor is "agent, scoped to
  their own listings" — there's no admin role that can moderate/manage
  other agents' listings.
- **Real geospatial querying.** Add PostGIS (or at minimum a bounding-box
  pre-filter in SQL before the precise Haversine pass) so radius search
  doesn't require loading every type/price/bedroom/term match into memory,
  and so cursor pagination could work for geo search too.
- **Soft delete** (`status: boolean` + filtered queries) instead of a hard
  `DELETE`.
- **Session cleanup.** Expired `Session` rows are never actually deleted —
  a request against one just gets rejected, since `expiresAt < now()` fails
  the guard's check — but a periodic job to prune them would keep the table
  from growing unbounded.
- **Distributed rate-limit storage.** The throttler's counters are
  in-memory per process, which is fine for a single instance but wouldn't
  coordinate correctly across multiple instances behind a load balancer; a
  shared store (e.g. Redis) would be needed for that.
