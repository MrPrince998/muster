import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { Readable } from 'node:stream';

/** What a stored file is, by its name: only the kinds Muster stores. */
export const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/**
 * Where uploaded files live. An abstract class, so a deployment can swap
 * the disk for object storage (S3 and the like) without touching the rest.
 * Keys are paths like "covers/<random>.webp": random, so unguessable, and
 * never reused, so a file at a key never changes (caches can keep it forever).
 */
export abstract class FileStorage {
  abstract put(key: string, data: Buffer): Promise<void>;
  // null when there's no such file
  abstract get(key: string): Promise<{ stream: Readable; size: number } | null>;
  abstract delete(key: string): Promise<void>;
}

/** Files on a local disk (in production, a volume that outlives the container). */
export class DiskStorage extends FileStorage {
  constructor(private readonly root: string) {
    super();
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<{ stream: Readable; size: number } | null> {
    const path = this.path(key);
    try {
      const { size } = await stat(path);
      return { stream: createReadStream(path), size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  // a key stays inside the root, whatever it says
  private path(key: string): string {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root) + '/')) throw new Error(`Bad file key: ${key}`);
    return path;
  }
}

/** The kind of image these bytes are, by their first bytes (never the name they came with); null if not one we take. */
export function imageKind(data: Buffer): 'webp' | 'jpg' | 'png' | null {
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}
