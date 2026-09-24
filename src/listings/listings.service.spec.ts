import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListingsService } from './listings.service';
import { ListingType } from '@prisma/client';
import { Listing } from './entities/listing.entity';

type MockPrisma = {
  listing: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
};

const makeListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 'id-1',
  title: 'Test listing',
  price: 1000,
  type: ListingType.RENT,
  bedrooms: 2,
  latitude: 6.45,
  longitude: 3.43,
  address: null,
  agentId: 'agent-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ListingsService', () => {
  let service: ListingsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    const mockPrisma: MockPrisma = {
      listing: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ListingsService);
    prisma = module.get(PrismaService);
  });

  describe('createListing', () => {
    it('delegates to prisma.listing.create with the authenticated agent id', async () => {
      const dto = {
        title: 'New listing',
        price: 500,
        type: ListingType.SALE,
        bedrooms: 3,
        latitude: 6.5,
        longitude: 3.4,
      };
      const created = makeListing({ ...dto, agentId: 'agent-2' });
      prisma.listing.create.mockResolvedValue(created);

      const result = await service.createListing(dto, 'agent-2');

      expect(prisma.listing.create).toHaveBeenCalledWith({
        data: { ...dto, agentId: 'agent-2' },
      });
      expect(result).toEqual(created);
    });
  });

  describe('findOne', () => {
    it('returns the listing when found', async () => {
      const listing = makeListing();
      prisma.listing.findUnique.mockResolvedValue(listing);

      const result = await service.findOne('id-1');

      expect(result).toEqual(listing);
    });

    it('throws NotFoundException when missing', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateListing', () => {
    it('throws NotFoundException if the listing does not exist', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.updateListing('missing', { price: 100 }, 'agent-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.listing.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller does not own the listing', async () => {
      prisma.listing.findUnique.mockResolvedValue(
        makeListing({ agentId: 'agent-1' }),
      );

      await expect(
        service.updateListing('id-1', { price: 100 }, 'agent-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.listing.update).not.toHaveBeenCalled();
    });

    it('updates when the listing exists and the caller owns it', async () => {
      const listing = makeListing({ agentId: 'agent-1' });
      prisma.listing.findUnique.mockResolvedValue(listing);
      prisma.listing.update.mockResolvedValue({ ...listing, price: 999 });

      const result = await service.updateListing(
        'id-1',
        { price: 999 },
        'agent-1',
      );

      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'id-1' },
        data: { price: 999 },
      });
      expect((result as Listing).price).toBe(999);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException if the listing does not exist', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'agent-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.listing.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller does not own the listing', async () => {
      prisma.listing.findUnique.mockResolvedValue(
        makeListing({ agentId: 'agent-1' }),
      );

      await expect(service.remove('id-1', 'agent-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.listing.delete).not.toHaveBeenCalled();
    });

    it('deletes when the listing exists and the caller owns it', async () => {
      prisma.listing.findUnique.mockResolvedValue(
        makeListing({ agentId: 'agent-1' }),
      );
      prisma.listing.delete.mockResolvedValue(undefined);

      await service.remove('id-1', 'agent-1');

      expect(prisma.listing.delete).toHaveBeenCalledWith({
        where: { id: 'id-1' },
      });
    });
  });

  describe('findAll', () => {
    it('paginates using skip/take and returns meta (page mode, the default)', async () => {
      const items = [makeListing({ id: 'a' }), makeListing({ id: 'b' })];
      prisma.listing.findMany.mockResolvedValue(items);
      prisma.listing.count.mockResolvedValue({ id: 12 });

      const result = await service.findAll({ page: 2, limit: 2 });

      expect(prisma.listing.findMany).toHaveBeenCalledWith({
        skip: 2,
        take: 2,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.listing.count).toHaveBeenCalledWith({
        select: { id: true },
        where: undefined,
      });
      expect(result.pageMeta).toEqual({
        totalItems: 12,
        itemCount: 2,
        itemsPerPage: 2,
        totalPages: 6,
        currentPage: 2,
      });
    });

    it('uses cursor pagination when paginationType is "cursor" (CrudService.findManyPaginate\'s raw shape)', async () => {
      const items = [makeListing({ id: 'a' }), makeListing({ id: 'b' })];
      prisma.listing.findMany.mockResolvedValue(items);
      prisma.listing.count.mockResolvedValue({ id: 2 });

      const result = await service.findAll({
        paginationType: 'cursor',
        limit: 2,
      });

      expect(result.pageEdges).toHaveLength(2);
      expect(result.pageEdges.map((e: any) => e.node)).toEqual(items);
      expect(result.totalCount).toBe(2);
      expect(result.pageCursors).toHaveProperty('next');
      expect(result.pageCursors).toHaveProperty('previous');
    });
  });

  describe('search', () => {
    it('rejects a partial geo filter (lat without lng/radiusKm)', async () => {
      await expect(service.search({ lat: 6.45 } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.listing.findMany).not.toHaveBeenCalled();
    });

    it('filters by type/price/bedrooms via prisma when no geo params are given', async () => {
      prisma.listing.findMany.mockResolvedValue([]);
      prisma.listing.count.mockResolvedValue({ id: 0 });

      await service.search({
        type: ListingType.RENT,
        minPrice: 100,
        maxPrice: 500,
        bedrooms: 2,
        page: 1,
        limit: 10,
      });

      expect(prisma.listing.findMany).toHaveBeenCalledWith({
        where: {
          type: ListingType.RENT,
          bedrooms: 2,
          price: { gte: 100, lte: 500 },
        },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filters candidates outside the radius and sorts by distance', async () => {
      const origin = { lat: 6.4488, lng: 3.4732 };
      const near = makeListing({
        id: 'near',
        latitude: 6.4281,
        longitude: 3.4219,
      });
      const far = makeListing({
        id: 'far',
        latitude: 6.6018,
        longitude: 3.3515,
      });
      prisma.listing.findMany.mockResolvedValue([far, near]);

      const result = await service.search({
        lat: origin.lat,
        lng: origin.lng,
        radiusKm: 10,
        page: 1,
        limit: 10,
      } as any);

      expect(prisma.listing.findMany).toHaveBeenCalledWith({ where: {} });
      expect(result.pageItems.map((i: any) => i.id)).toEqual(['near']);
      expect(result.pageMeta.totalItems).toBe(1);
      expect((result.pageItems[0] as any).distanceKm).toBeGreaterThan(0);
    });

    it('paginates geo results in-memory', async () => {
      const origin = { lat: 6.4488, lng: 3.4732 };
      const nearby = Array.from({ length: 5 }, (_, i) =>
        makeListing({
          id: `listing-${i}`,
          latitude: origin.lat + i * 0.001,
          longitude: origin.lng,
        }),
      );
      prisma.listing.findMany.mockResolvedValue(nearby);

      const result = await service.search({
        lat: origin.lat,
        lng: origin.lng,
        radiusKm: 50,
        page: 2,
        limit: 2,
      } as any);

      expect(result.pageItems).toHaveLength(2);
      expect(result.pageMeta).toMatchObject({
        totalItems: 5,
        itemCount: 2,
        itemsPerPage: 2,
        totalPages: 3,
        currentPage: 2,
      });
    });
  });
});
