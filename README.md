# Property Listings API

A CRUD + search API for property listings, built with NestJS and Prisma/PostgreSQL. Agents register and manage their own listings; browsing and searching are public.

## Stack

- NestJS (Express)
- Prisma + PostgreSQL
- class-validator / class-transformer for request validation
- `@nestjs/jwt` + bcrypt for auth
- `@nestjs/throttler` for rate limiting
- Swagger for interactive API docs
- Jest + Supertest for unit and integration tests

## Setup

Requires a running Postgres instance. Quickest way to get one:

```bash
docker run --name property-listings-db \
  -e POSTGRES_USER=pgUser -e POSTGRES_PASSWORD=pgPass1 \
  -p 5432:5432 -d postgres
```

Then:

```bash
npm install
cp .env.example .env
# fill in DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE (DATABASE_URL
# and TEST_DATABASE_URL are built from these); create both databases first,
# e.g. createdb <DB_DATABASE> && createdb <DB_DATABASE>_test
npx prisma migrate dev
npm run start:dev
```

The API runs on `http://localhost:3000`. Swagger docs are at `/docs`.

Seed data — three agents (`agent1@example.com` / `agent2@example.com` / `agent3@example.com`, password `password123` for all) plus a few listings each:

```bash
npm run db:seed
```

### Tests

```bash
npm test          # unit tests, mocked Prisma client
npm run test:e2e  # integration tests against TEST_DATABASE_URL
```

The e2e suite applies migrations and truncates all tables before running, so it needs `TEST_DATABASE_URL` pointing at a real (disposable) database. It never touches your dev database.

## API

All responses are wrapped as `{ statusCode, message, data }`. Errors are `{ statusCode, message, path, timestamp }`.

| Method | Path                | Auth                   | Description                            |
| ------ | ------------------- | ----------------------- | -------------------------------------- |
| POST   | `/auth/register`   | Public                  | Register a new agent                    |
| POST   | `/auth/login`      | Public                  | Log in, get access + refresh tokens     |
| POST   | `/auth/refresh`    | Public (refresh token)  | Exchange a refresh token for a new access token |
| POST   | `/auth/logout`     | Bearer token             | Revoke the current session              |
| POST   | `/auth/logout-all` | Bearer token             | Revoke every session for the agent      |
| POST   | `/listings`        | Bearer token             | Create a listing (owned by the caller)  |
| GET    | `/listings`        | Public                  | List listings, paginated                |
| GET    | `/listings/search` | Public                  | Search/filter listings                  |
| GET    | `/listings/:id`    | Public                  | Get one listing                         |
| PATCH  | `/listings/:id`    | Bearer token, owner only | Update a listing                      |
| DELETE | `/listings/:id`    | Bearer token, owner only | Delete a listing                      |

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
  "address": "Lekki Phase 1, Lagos",
  "agentId": "uuid",
  "createdAt": "2026-09-24T15:21:17.443Z",
  "updatedAt": "2026-09-24T15:21:17.443Z"
}
```

`agentId` is set from the authenticated caller's token — it's not part of the request body.

## Authentication

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@example.com","password":"password123","name":"Jane Agent"}'
# => { "data": { "accessToken": "...", "refreshToken": "...", "agent": {...} } }

curl -X POST http://localhost:3000/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"title":"2-bed flat","price":1500000,"type":"RENT","bedrooms":2,"latitude":6.45,"longitude":3.43}'
```

Login/register return an access token (`JWT_EXPIRES_IN`, default `15m`) and a refresh token (`JWT_REFRESH_EXPIRES_IN`, default `7d`), both tied to a `Session` row. Exchange the refresh token for a new access token via `POST /auth/refresh`. `POST /auth/logout` revokes the current session; `POST /auth/logout-all` revokes all of them. Revocation is checked on every request, so it takes effect immediately rather than waiting for the token to expire.

`PATCH`/`DELETE /listings/:id` require the caller to own the listing (`403` otherwise, `401` if unauthenticated). Reading listings needs no auth at all.

## Rate limiting

`/auth/register`, `/auth/login` and `/auth/refresh` share a limit of `AUTH_THROTTLE_LIMIT` requests (default `30`) per `AUTH_THROTTLE_TTL_MS` (default `60000`ms) per IP, to slow down credential stuffing. Everything else uses a more generous app-wide default.

## Pagination

`GET /listings` and non-geo `GET /listings/search` support two modes via `paginationType` (`limit`, default `10`, max `100`, applies to both):

- **`page`** (default):

  ```jsonc
  { "pageItems": [...], "pageMeta": { "totalItems": 12, "itemCount": 10, "itemsPerPage": 10, "totalPages": 2, "currentPage": 1 } }
  ```

- **`cursor`** (`?paginationType=cursor`) — pass `pageCursors.next.cursor` back as `cursor` for the next page:

  ```jsonc
  { "pageEdges": [{ "cursor": null, "node": {...} }], "pageCursors": { "next": { "cursor": "..." }, "previous": false, ... }, "totalCount": 12 }
  ```

Geo search (below) only supports `page` mode, since distance is computed after the database query — combining it with `paginationType=cursor` returns a `400`.

## Search

`GET /listings/search` accepts any combination of:

- `type` — `RENT` | `SALE` | `SHORTLET`
- `minPrice`, `maxPrice`, `bedrooms`
- `term` — free-text, case-insensitive match over `title` or `address`
- `lat`, `lng`, `radiusKm` — listings within `radiusKm` km of `(lat, lng)`, with a `distanceKm` field on each result. All three must be provided together, or it's a `400`.
- `sortBy` (`distance` | `price` | `bedrooms` | `createdAt`) and `sortDirection` (`asc` | `desc`). `distance` requires a location search; defaults to `distance` for a location search and `createdAt` otherwise.

```
GET /listings/search?type=SHORTLET&bedrooms=1&lat=6.45&lng=3.43&radiusKm=5
GET /listings/search?term=lekki&sortBy=price&sortDirection=asc
```

## Design choices

**Generic `CrudService` base class.** `ListingsService` extends `CrudService<D, T>` (`src/common/database/crud.service.ts`), which wraps a Prisma model delegate and provides `create`/`update`/`delete`/`findFirst(OrThrow)`/`findUnique(OrThrow)`/`count`/`findManyPaginate`. Any future model gets the same CRUD surface by extending it and supplying a `<Model>MapType`. Domain methods are named `createListing`/`updateListing` rather than `create`/`update` to avoid overriding the base class's own verbs, which take raw Prisma args instead of a flat DTO.

**Pagination results are passed through unchanged.** `findAll` and non-geo `search` return `findManyPaginate`'s result directly rather than reshaping it, so the response shape is exactly what the pagination mode produces. The geo branch can't use `findManyPaginate` (it needs to filter by a distance computed after the query), so it paginates in memory, but returns the same `{ pageItems, pageMeta }` shape for consistency.

**`type` is a native Prisma enum**, not a hand-rolled TypeScript one — the database schema is the single source of truth, and `@IsEnum(ListingType)` (imported from `@prisma/client`) just enforces at the API boundary what the column already guarantees.

**Radius search is computed in application code (Haversine), not PostGIS.** The service filters by `type`/price/`bedrooms`/`term` at the database level first, then computes distance and sorts/paginates the remaining rows in memory. Fine at small scale, doesn't scale past a few thousand candidates — see below.

**`agentId` is a real foreign key**, set from the JWT rather than accepted as client input, so an agent can't claim a listing that isn't theirs.

**Sessions back the JWTs.** Every login opens a `Session` row; both tokens carry its id as a claim, and `JwtAuthGuard` checks the session still exists on every request. This is what makes logout/logout-all take effect immediately instead of waiting out the token's own expiry, at the cost of one extra indexed lookup per request.

**Ownership is checked per-request** (`ListingsService.assertOwnership`) rather than via a dedicated guard class — simpler when there's one resource type and one role.

**`PATCH` for updates**, since a client changing one field shouldn't have to resend the whole listing.

## What I'd improve with more time

- **Refresh token rotation** — refresh tokens are reusable until they expire or the session is revoked; rotating them per use (and flagging reuse of an already-rotated token) would close that gap.
- **Admin role** — right now every agent is scoped only to their own listings, with no way to moderate others'.
- **Real geospatial querying** — PostGIS, or at least a bounding-box pre-filter in SQL, so radius search doesn't load every non-geo match into memory, and so cursor pagination could work for it too.
- **Soft delete** instead of a hard `DELETE`.
- **Session cleanup** — expired sessions are rejected but never pruned from the table.
- **Distributed rate limiting** — the throttler's counters are in-memory per process, fine for one instance but not for multiple behind a load balancer.
