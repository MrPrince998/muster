import { Global, Module } from '@nestjs/common';
import { config } from '../../config/config.js';
import { DiskStorage, FileStorage } from './file-storage.js';
import { FilesController } from './files.controller.js';

/** Uploaded files: kept on disk (UPLOADS_DIR), served at /files. Global, like the database. */
@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: FileStorage, useFactory: () => new DiskStorage(config.uploads.dir) }],
  exports: [FileStorage],
})
export class FilesModule {}
