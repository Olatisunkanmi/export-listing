import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrudService } from '../common/database/crud.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { ListingMapType } from './dto/listing.maptype';
import { Listing } from './entities/listing.entity';

@Injectable()
export class ListingsService extends CrudService<
  Prisma.ListingDelegate,
  ListingMapType
> {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.listing);
  }

  async createListing(
    dto: CreateListingDto,
    agentId: string,
  ): Promise<Listing> {
    return (await this.create({ data: { ...dto, agentId } })) as Listing;
  }

  async findAll(query: PaginationDto) {
    return this.findManyPaginate(
      {},
      {
        paginationType: query.paginationType ?? 'page',
        page: query.page ?? 1,
        cursor: query.cursor,
        size: query.limit ?? 10,
        orderBy: 'createdAt',
        direction: 'desc',
      },
    );
  }

  async findOne(id: string): Promise<Listing> {
    return (await this.findUniqueOrThrow(
      { where: { id } },
      `Listing with id "${id}" not found`,
    )) as Listing;
  }

  async updateListing(
    id: string,
    dto: UpdateListingDto,
    agentId: string,
  ): Promise<Listing> {
    await this.assertOwnership(id, agentId);
    return (await this.update({ where: { id }, data: dto })) as Listing;
  }

  async remove(id: string, agentId: string): Promise<void> {
    await this.assertOwnership(id, agentId);
    await this.delete({ where: { id } });
  }

  private async assertOwnership(id: string, agentId: string): Promise<void> {
    const listing = await this.findOne(id);
    if (listing.agentId !== agentId) {
      throw new ForbiddenException('You do not own this listing');
    }
  }

  async search(query: SearchListingsDto) {
    const {
      type,
      minPrice,
      maxPrice,
      bedrooms,
      term,
      lat,
      lng,
      radiusKm,
      sortBy,
      sortDirection,
    } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const geoFieldsProvided = [lat, lng, radiusKm].filter(
      (v) => v !== undefined,
    ).length;
    if (geoFieldsProvided > 0 && geoFieldsProvided < 3) {
      throw new BadRequestException(
        'lat, lng and radiusKm must all be provided together for a location search',
      );
    }

    const isGeoSearch =
      lat !== undefined && lng !== undefined && radiusKm !== undefined;

    if (sortBy === 'distance' && !isGeoSearch) {
      throw new BadRequestException(
        'sortBy=distance requires a location search (lat, lng and radiusKm)',
      );
    }

    const effectiveSortBy = sortBy ?? (isGeoSearch ? 'distance' : 'createdAt');
    const effectiveSortDirection =
      sortDirection ?? (effectiveSortBy === 'distance' ? 'asc' : 'desc');

    const where: Prisma.ListingWhereInput = {
      ...(type && { type }),
      ...(bedrooms !== undefined && { bedrooms }),
      ...((minPrice !== undefined || maxPrice !== undefined) && {
        price: {
          ...(minPrice !== undefined && { gte: minPrice }),
          ...(maxPrice !== undefined && { lte: maxPrice }),
        },
      }),
      ...(term && {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { address: { contains: term, mode: 'insensitive' } },
        ],
      }),
    };

    if (isGeoSearch && (query.paginationType ?? 'page') === 'cursor') {
      throw new BadRequestException(
        'Cursor pagination is not supported for location search — distance is computed after the database query, so only page-based pagination (the default) works here.',
      );
    }

    if (!isGeoSearch) {
      return this.findManyPaginate(
        { where },
        {
          paginationType: query.paginationType ?? 'page',
          page,
          cursor: query.cursor,
          size: limit,
          orderBy: effectiveSortBy,
          direction: effectiveSortDirection,
        },
      );
    }

    const candidates = (await this.findMany({ where })) as Listing[];

    const withinRadius = candidates
      .map((listing: Listing) => ({
        listing,
        distanceKm: haversineDistanceKm(
          { latitude: lat as number, longitude: lng as number },
          { latitude: listing.latitude, longitude: listing.longitude },
        ),
      }))
      .filter(
        ({ distanceKm }: { distanceKm: number }) =>
          distanceKm <= (radiusKm as number),
      )
      .sort(
        (
          a: { listing: Listing; distanceKm: number },
          b: { listing: Listing; distanceKm: number },
        ) => {
          const dir = effectiveSortDirection === 'desc' ? -1 : 1;
          switch (effectiveSortBy) {
            case 'price':
              return (a.listing.price - b.listing.price) * dir;
            case 'bedrooms':
              return (a.listing.bedrooms - b.listing.bedrooms) * dir;
            case 'createdAt':
              return (
                (a.listing.createdAt.getTime() -
                  b.listing.createdAt.getTime()) *
                dir
              );
            case 'distance':
            default:
              return (a.distanceKm - b.distanceKm) * dir;
          }
        },
      );

    const totalItems = withinRadius.length;
    const paginated = withinRadius.slice((page - 1) * limit, page * limit);
    const pageItems = paginated.map(
      ({ listing, distanceKm }: { listing: Listing; distanceKm: number }) => ({
        ...listing,
        distanceKm: Number(distanceKm.toFixed(2)),
      }),
    );

    return {
      pageItems,
      pageMeta: {
        itemCount: pageItems.length,
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 0,
        currentPage: page,
      },
    };
  }
}
