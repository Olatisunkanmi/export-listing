import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { SearchListingsDto } from './dto/search-listings.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@ApiTags('listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Post()
  create(
    @Body() createListingDto: CreateListingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.listingsService.createListing(createListingDto, user.agentId);
  }

  @Public()
  @Get('search')
  search(@Query() query: SearchListingsDto) {
    return this.listingsService.search(query);
  }

  @Public()
  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.listingsService.findAll(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateListingDto: UpdateListingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.listingsService.updateListing(
      id,
      updateListingDto,
      user.agentId,
    );
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.listingsService.remove(id, user.agentId);
    return { id };
  }
}
