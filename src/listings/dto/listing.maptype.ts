import { Prisma } from '@prisma/client';

export interface ListingMapType {
  aggregate: Prisma.ListingAggregateArgs;
  count: Prisma.ListingCountArgs;
  create: Prisma.ListingCreateArgs;
  createMany: Prisma.ListingCreateManyArgs;
  delete: Prisma.ListingDeleteArgs;
  deleteMany: Prisma.ListingDeleteManyArgs;
  findFirst: Prisma.ListingFindFirstArgs;
  findMany: Prisma.ListingFindManyArgs;
  findUnique: Prisma.ListingFindUniqueArgs;
  update: Prisma.ListingUpdateArgs;
  updateMany: Prisma.ListingUpdateManyArgs;
  upsert: Prisma.ListingUpsertArgs;
}
