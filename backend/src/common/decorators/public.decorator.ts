import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or a whole controller) out of the global auth guard. Every
 * other route requires a valid access token, so forgetting to protect a new
 * endpoint is impossible; forgetting @Public() only makes it stricter.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
