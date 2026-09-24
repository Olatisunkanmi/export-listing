import { ApiProperty } from '@nestjs/swagger';
import { Listing as PrismaListing, ListingType } from '@prisma/client';

export class Listing implements PrismaListing {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() price: number;
  @ApiProperty({ enum: ListingType }) type: ListingType;
  @ApiProperty() bedrooms: number;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
  @ApiProperty({ required: false, nullable: true }) address: string | null;
  @ApiProperty() agentId: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
