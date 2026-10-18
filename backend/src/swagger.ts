import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/errors/error-response.dto.js';

export const BEARER_AUTH = 'access-token';

/**
 * API docs: interactive UI at /docs, raw OpenAPI JSON at /docs-json (for
 * Postman, Insomnia, or generating a typed frontend client).
 *
 * Request and response schemas come from DTOs and entities through the
 * @nestjs/swagger compiler plugin (nest-cli.json), including class-validator
 * rules, so fields need no @ApiProperty unless they want an example or
 * description.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Campus Pass API')
    .setDescription(
      'Multi-tenant club and event management. Every error uses the ErrorResponse shape; ' +
        'branch on `code`, not on `message`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from sign-in' },
      BEARER_AUTH,
    )
    .addCookieAuth('refresh_token', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Set by sign-in; sent automatically by the browser to /auth routes',
    })
    // responses any endpoint can return
    .addGlobalResponse(
      { status: 400, description: 'Invalid input (code VALIDATION_ERROR or INVALID_INPUT)', type: ErrorResponseDto },
      { status: 500, description: 'Unexpected server error', type: ErrorResponseDto },
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorResponseDto] });

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: {
      // keep the pasted token across page reloads
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  });
}
