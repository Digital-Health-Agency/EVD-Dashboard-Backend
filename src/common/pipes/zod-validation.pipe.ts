import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    let normalizedValue: unknown = value;

    if (Buffer.isBuffer(normalizedValue)) {
      normalizedValue = normalizedValue.toString('utf-8');
    }

    // Some routes receive JSON body as string or double-encoded JSON string.
    // Normalize by parsing at most twice.
    for (let i = 0; i < 2 && typeof normalizedValue === 'string'; i += 1) {
      const trimmed = normalizedValue.trim();
      if (!trimmed) break;
      try {
        normalizedValue = JSON.parse(trimmed);
      } catch {
        break;
      }
    }

    try {
      return this.schema.parse(normalizedValue);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.issues,
        });
      }
      throw error;
    }
  }
}
