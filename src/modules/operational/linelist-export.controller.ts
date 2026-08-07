import { once } from 'node:events';

import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { csvRow } from './csv.js';
import {
  linelistExportQuerySchema,
  type LinelistExportQueryDto,
} from './dto/linelist-export-query.dto.js';
import {
  LinelistExportService,
  type LinelistExportResult,
  type LinelistExportWindow,
} from './linelist-export.service.js';
import {
  resolveLinelistAccess,
  type AuthenticatedRequest,
} from './linelist.controller.js';

const logger = new Logger('LinelistExportController');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATASET_SLUGS = Object.freeze({
  'lab-results': 'lab-results',
  screenings: 'screenings',
  cases: 'cases',
  outcomes: 'outcomes',
  contacts: 'contacts',
  signals: 'signals',
});

type ExportDataset = keyof typeof DATASET_SLUGS;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function exportFilename(
  dataset: string,
  window: LinelistExportWindow,
  exportedAt = new Date(),
): string {
  if (!Object.prototype.hasOwnProperty.call(DATASET_SLUGS, dataset)) {
    throw new Error('Unknown export dataset');
  }
  if (!isCalendarDate(window.from) || !isCalendarDate(window.to)) {
    throw new Error('Invalid export window');
  }
  const exported = exportedAt.toISOString().slice(0, 10);
  if (!isCalendarDate(exported)) throw new Error('Invalid export date');

  return `evd-${DATASET_SLUGS[dataset as ExportDataset]}_${window.from}_to_${window.to}_exported-${exported}.csv`;
}

function accessFor(req: AuthenticatedRequest) {
  const access = resolveLinelistAccess(req);
  if (!access.userId) throw new UnauthorizedException('Authentication required');
  return access;
}

async function writeChunk(response: Response, chunk: string): Promise<void> {
  if (response.write(chunk)) return;
  await once(response, 'drain');
}

async function streamExport(
  dataset: ExportDataset,
  prepared: Promise<LinelistExportResult>,
  response: Response,
): Promise<void> {
  let result: LinelistExportResult | undefined;
  try {
    result = await prepared;
    const filename = exportFilename(dataset, result.window);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.setHeader('Cache-Control', 'no-store');

    await writeChunk(
      response,
      csvRow(result.columns.map((column) => column.label)),
    );
    for await (const row of result.rows) {
      if (response.destroyed) break;
      await writeChunk(
        response,
        csvRow(result.columns.map((column) => row[column.name])),
      );
    }
    if (!response.destroyed) response.end();
  } catch (error) {
    await result?.close();
    if (!response.headersSent) throw error;

    const failure = error instanceof Error ? error : new Error(String(error));
    logger.error(`CSV stream aborted: ${failure.message}`, failure.stack);
    if (!response.destroyed) response.destroy(failure);
  }
}

@Controller('api/operational/linelist')
export class LinelistExportController {
  constructor(private readonly linelist: LinelistExportService) {}

  @Get('lab-results/export')
  async labResults(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport(
      'lab-results',
      this.linelist.labResults(query, access),
      response,
    );
  }

  @Get('screenings/export')
  async screenings(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport(
      'screenings',
      this.linelist.screenings(query, access),
      response,
    );
  }

  @Get('cases/export')
  async cases(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport('cases', this.linelist.cases(query, access), response);
  }

  @Get('outcomes/export')
  async outcomes(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport(
      'outcomes',
      this.linelist.outcomes(query, access),
      response,
    );
  }

  @Get('contacts/export')
  async contacts(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport(
      'contacts',
      this.linelist.contacts(query, access),
      response,
    );
  }

  @Get('signals/export')
  async signals(
    @Query(new ZodValidationPipe(linelistExportQuerySchema))
    query: LinelistExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const access = accessFor(req);
    return streamExport(
      'signals',
      this.linelist.signals(query, access),
      response,
    );
  }
}
