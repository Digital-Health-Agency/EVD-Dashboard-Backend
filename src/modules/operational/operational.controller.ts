import { Controller, Get, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  operationalFiltersSchema,
  type OperationalFiltersDto,
} from './dto/operational-filters.dto.js';
import {
  filterOptionsQuerySchema,
  type FilterOptionsQueryDto,
} from './dto/filter-options.dto.js';
import { OperationalService } from './operational.service.js';
import {
  OperationalOptionsService,
  type FilterOptionsPayload,
} from './operational-options.service.js';
import type { TabPayload } from './tab-payload.js';

@Controller('api/operational')
export class OperationalController {
  constructor(
    private readonly operational: OperationalService,
    private readonly options: OperationalOptionsService,
  ) {}

  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.summaryTab(query);
  }

  @Get('labs')
  labs(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.labsTab(query);
  }

  @Get('poe')
  poe(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.poeTab(query);
  }

  @Get('hf')
  hf(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.hfTab(query);
  }

  @Get('contacts')
  contacts(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.contactsTab(query);
  }

  @Get('community')
  community(
    @Query(new ZodValidationPipe(operationalFiltersSchema))
    query: OperationalFiltersDto,
  ): Promise<TabPayload> {
    return this.operational.communityTab(query);
  }

  @Get('filter-options')
  filterOptions(
    @Query(new ZodValidationPipe(filterOptionsQuerySchema))
    query: FilterOptionsQueryDto,
  ): Promise<FilterOptionsPayload> {
    return this.options.getFilterOptions(query);
  }
}
