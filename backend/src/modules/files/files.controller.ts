import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { CONTENT_TYPES, FileStorage } from './file-storage.js';

/**
 * Uploaded files, for anyone with the link (an event's cover image shows on
 * its public page and in link previews). Keys are random, so a members-only
 * event's image can't be found by guessing; and a key's file never
 * changes, so browsers and proxies keep it for a year.
 */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: FileStorage) {}

  @Public()
  @Get(':folder/:name')
  async file(
    @Param('folder') folder: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const match = /^[a-z0-9-]{8,64}\.(webp|jpg|png)$/.exec(name);
    if (folder !== 'covers' || !match) throw new NotFoundException();
    const file = await this.storage.get(`${folder}/${name}`);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', CONTENT_TYPES[match[1]]);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // the web app (another origin) and link-preview renderers draw it
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(file.stream);
  }
}
