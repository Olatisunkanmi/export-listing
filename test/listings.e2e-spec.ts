import * as path from 'path';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as dotenvExpand from 'dotenv-expand';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

dotenvExpand.expand(
  dotenv.config({ path: path.join(__dirname, '..', '.env') }),
);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('Listings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let agentAToken: string;
  let agentAId: string;
  let agentBToken: string;

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      stdio: 'inherit',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "sessions", "listings", "agents" RESTART IDENTITY CASCADE',
    );

    const agentA = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'agent-a@example.com', password: 'password123' });
    agentAToken = agentA.body.data.accessToken;
    agentAId = agentA.body.data.agent.id;

    const agentB = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'agent-b@example.com', password: 'password123' });
    agentBToken = agentB.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.listing.deleteMany();
  });

  const authHeader = (token: string): [string, string] => [
    'Authorization',
    `Bearer ${token}`,
  ];

  const validPayload = {
    title: '2-bed apartment in Yaba',
    price: 2500000,
    type: 'RENT',
    bedrooms: 2,
    latitude: 6.5158,
    longitude: 3.3707,
    address: 'Yaba, Lagos',
  };

  describe('Auth', () => {
    it('registers a new agent and returns access + refresh tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'new-agent@example.com', password: 'password123' })
        .expect(201);

      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
      expect(res.body.data.agent.email).toBe('new-agent@example.com');
      expect(res.body.data.agent.password).toBeUndefined();
    });

    it('rejects registering the same email twice', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dup@example.com', password: 'password123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'dup@example.com', password: 'password123' })
        .expect(409);
    });

    it('logs in with correct credentials and rejects incorrect ones', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'login-test@example.com', password: 'password123' });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'login-test@example.com', password: 'password123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'login-test@example.com', password: 'wrong-password' })
        .expect(401);
    });

    it('exchanges a refresh token for a new access token', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'refresh-test@example.com', password: 'password123' });
      const { refreshToken } = registered.body.data;

      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

      await request(app.getHttpServer())
        .get('/listings')
        .set(...authHeader(refreshed.body.data.accessToken))
        .expect(200);
    });

    it('rejects a refresh with an access token instead of a refresh token', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'refresh-wrong-type@example.com',
          password: 'password123',
        });

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: registered.body.data.accessToken })
        .expect(401);
    });

    it('logout revokes the session so the access token stops working', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'logout-test@example.com', password: 'password123' });
      const { accessToken, refreshToken } = registered.body.data;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set(...authHeader(accessToken))
        .expect(201);

      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(accessToken))
        .send(validPayload)
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('logout-all revokes every session for the agent, not just the current one', async () => {
      const email = 'logout-all-test@example.com';
      const password = 'password123';
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });

      const session1 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      const session2 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      await request(app.getHttpServer())
        .post('/auth/logout-all')
        .set(...authHeader(session1.body.data.accessToken))
        .expect(201);

      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(session2.body.data.accessToken))
        .send(validPayload)
        .expect(401);
    });
  });

  describe('POST /listings', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .send(validPayload)
        .expect(401);
    });

    it('creates a listing owned by the authenticated agent', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send(validPayload)
        .expect(201);

      expect(res.body).toMatchObject({
        statusCode: 201,
        message: 'success',
        data: { title: validPayload.title, type: 'RENT', agentId: agentAId },
      });
      expect(res.body.data.id).toBeDefined();
    });

    it('rejects an invalid payload with a 400 and field messages', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({ title: '', price: -1 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.join(' ')).toContain('title should not be empty');
    });

    it('rejects unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({ ...validPayload, notAField: true })
        .expect(400);
    });
  });

  describe('GET /listings/:id', () => {
    it('returns 404 for a non-existent (but valid) uuid', async () => {
      await request(app.getHttpServer())
        .get('/listings/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await request(app.getHttpServer())
        .get('/listings/not-a-uuid')
        .expect(400);
    });

    it('is publicly readable without a token', async () => {
      const created = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send(validPayload);

      const res = await request(app.getHttpServer())
        .get(`/listings/${created.body.data.id}`)
        .expect(200);

      expect(res.body.data.id).toBe(created.body.data.id);
    });
  });

  describe('PATCH and DELETE /listings/:id', () => {
    it('rejects unauthenticated update/delete', async () => {
      const created = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send(validPayload);
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .patch(`/listings/${id}`)
        .send({ price: 1 })
        .expect(401);
      await request(app.getHttpServer()).delete(`/listings/${id}`).expect(401);
    });

    it("rejects update/delete by an agent who doesn't own the listing", async () => {
      const created = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send(validPayload);
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .patch(`/listings/${id}`)
        .set(...authHeader(agentBToken))
        .send({ price: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/listings/${id}`)
        .set(...authHeader(agentBToken))
        .expect(403);
    });

    it('lets the owning agent update and then delete their listing', async () => {
      const created = await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send(validPayload);
      const id = created.body.data.id;

      const updated = await request(app.getHttpServer())
        .patch(`/listings/${id}`)
        .set(...authHeader(agentAToken))
        .send({ price: 3000000 })
        .expect(200);
      expect(updated.body.data.price).toBe(3000000);

      await request(app.getHttpServer())
        .delete(`/listings/${id}`)
        .set(...authHeader(agentAToken))
        .expect(200);

      await request(app.getHttpServer()).get(`/listings/${id}`).expect(404);
    });
  });

  describe('GET /listings (pagination)', () => {
    it('paginates results without requiring a token', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/listings')
          .set(...authHeader(agentAToken))
          .send({ ...validPayload, title: `Listing ${i}` });
      }

      const res = await request(app.getHttpServer())
        .get('/listings?page=1&limit=2')
        .expect(200);

      expect(res.body.data.pageItems).toHaveLength(2);
      expect(res.body.data.pageMeta).toMatchObject({
        totalItems: 3,
        itemsPerPage: 2,
        currentPage: 1,
        totalPages: 2,
      });
    });

    it("supports cursor pagination and walking to the next page (CrudService.findManyPaginate's raw shape)", async () => {
      const titles = ['Cursor A', 'Cursor B', 'Cursor C'];
      for (const title of titles) {
        await request(app.getHttpServer())
          .post('/listings')
          .set(...authHeader(agentAToken))
          .send({ ...validPayload, title });
      }

      const firstPage = await request(app.getHttpServer())
        .get('/listings?paginationType=cursor&limit=2')
        .expect(200);

      expect(firstPage.body.data.pageEdges).toHaveLength(2);
      expect(firstPage.body.data.totalCount).toBe(3);
      const nextCursor = firstPage.body.data.pageCursors.next.cursor;
      expect(nextCursor).toEqual(expect.any(String));

      const secondPage = await request(app.getHttpServer())
        .get(
          `/listings?paginationType=cursor&limit=2&cursor=${encodeURIComponent(
            nextCursor,
          )}`,
        )
        .expect(200);

      expect(secondPage.body.data.pageEdges).toHaveLength(1);
      const firstPageIds = firstPage.body.data.pageEdges.map(
        (e: any) => e.node.id,
      );
      const secondPageIds = secondPage.body.data.pageEdges.map(
        (e: any) => e.node.id,
      );
      expect(secondPageIds).not.toEqual(expect.arrayContaining(firstPageIds));
    });

    it('rejects cursor pagination combined with a location search', async () => {
      const res = await request(app.getHttpServer())
        .get(
          '/listings/search?paginationType=cursor&lat=6.4488&lng=3.4732&radiusKm=50',
        )
        .expect(400);

      expect(res.body.message).toContain('Cursor pagination');
    });
  });

  describe('GET /listings/search', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({
          title: 'Near origin',
          price: 1000,
          type: 'RENT',
          bedrooms: 2,
          latitude: 6.4488,
          longitude: 3.4732,
        });
      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({
          title: 'Far away',
          price: 1000,
          type: 'RENT',
          bedrooms: 2,
          latitude: 9.082,
          longitude: 8.6753,
        });
    });

    it('filters by type, price range and bedrooms', async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({
          ...validPayload,
          title: 'Sale listing',
          type: 'SALE',
          price: 50000000,
        });

      const res = await request(app.getHttpServer())
        .get('/listings/search?type=RENT&minPrice=500&maxPrice=1500&bedrooms=2')
        .expect(200);

      expect(res.body.data.pageItems.every((l: any) => l.type === 'RENT')).toBe(
        true,
      );
    });

    it('returns only listings within the given radius', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings/search?lat=6.4488&lng=3.4732&radiusKm=50')
        .expect(200);

      expect(res.body.data.pageItems).toHaveLength(1);
      expect(res.body.data.pageItems[0].title).toBe('Near origin');
      expect(res.body.data.pageItems[0].distanceKm).toBeLessThan(50);
    });

    it('rejects a partial geo filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings/search?lat=6.4488')
        .expect(400);

      expect(res.body.message).toContain('radiusKm');
    });

    it('free-text searches over title and address, case-insensitively', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings/search?term=ORIGIN')
        .expect(200);

      expect(res.body.data.pageItems).toHaveLength(1);
      expect(res.body.data.pageItems[0].title).toBe('Near origin');
    });

    it('sorts geo search results by price instead of distance', async () => {
      await request(app.getHttpServer())
        .post('/listings')
        .set(...authHeader(agentAToken))
        .send({
          title: 'Cheap and far-ish',
          price: 1,
          type: 'RENT',
          bedrooms: 2,
          latitude: 6.55,
          longitude: 3.5,
        });

      const res = await request(app.getHttpServer())
        .get(
          '/listings/search?lat=6.4488&lng=3.4732&radiusKm=50&sortBy=price&sortDirection=asc',
        )
        .expect(200);

      const prices = res.body.data.pageItems.map((l: any) => l.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      expect(prices[0]).toBe(1);
    });

    it('rejects sortBy=distance without a location search', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings/search?sortBy=distance')
        .expect(400);

      expect(res.body.message).toContain('sortBy=distance');
    });
  });

  describe('Rate limiting', () => {
    let throttledApp: INestApplication;

    beforeAll(async () => {
      process.env.AUTH_THROTTLE_LIMIT = '2';
      process.env.AUTH_THROTTLE_TTL_MS = '60000';

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      throttledApp = moduleRef.createNestApplication();
      throttledApp.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      throttledApp.useGlobalFilters(new HttpExceptionFilter());
      throttledApp.useGlobalInterceptors(new ResponseInterceptor());
      await throttledApp.init();
    });

    afterAll(async () => {
      await throttledApp.close();
      delete process.env.AUTH_THROTTLE_LIMIT;
      delete process.env.AUTH_THROTTLE_TTL_MS;
    });

    it('returns 429 once the login limit is exceeded', async () => {
      const attempt = () =>
        request(throttledApp.getHttpServer())
          .post('/auth/login')
          .send({ email: 'nobody@example.com', password: 'wrong' });

      await attempt().expect(401);
      await attempt().expect(401);
      const blocked = await attempt();

      expect(blocked.status).toBe(429);
    });

    it('does not throttle unrelated routes at the same low limit', async () => {
      for (let i = 0; i < 5; i++) {
        await request(throttledApp.getHttpServer())
          .get('/listings')
          .expect(200);
      }
    });
  });
});
