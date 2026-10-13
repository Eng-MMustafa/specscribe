import { Controller, HttpCode, HttpStatus, Post, VERSION_NEUTRAL } from '@nestjs/common';

/** Version-neutral: stays at /api/reports even with a defaultVersion. */
@Controller({ path: 'reports', version: VERSION_NEUTRAL })
export class ReportsController {
  /** Generate several reports at once. */
  @Post()
  @HttpCode(HttpStatus.MULTI_STATUS)
  generate(): { ok: boolean } {
    return { ok: true };
  }
}
