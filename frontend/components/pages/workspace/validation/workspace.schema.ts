import { z } from "zod";

// Mirrors the API's CreateOrganisationDto; the address (slug) is made from the name.
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Use 100 characters or fewer"),
});
export type CreateWorkspaceValues = z.infer<typeof createWorkspaceSchema>;

// Workspace addresses: lowercase letters, digits and single hyphens.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Accepts what people paste: a full link (https://muster.app/o/state-uni),
 * a path (/o/state-uni) or just the address (state-uni). Gives back the slug.
 */
export function slugFromAddress(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const fromPath = trimmed.match(/\/o\/([^/?#\s]+)/);
  return (fromPath ? fromPath[1] : trimmed).replace(/^\/+|\/+$/g, "");
}

export const joinWorkspaceSchema = z.object({
  address: z
    .string()
    .trim()
    .min(1, "Paste the workspace's link or address")
    .refine((value) => SLUG.test(slugFromAddress(value)), "That doesn't look like a workspace address"),
});
export type JoinWorkspaceValues = z.infer<typeof joinWorkspaceSchema>;

// Mirrors UpdateOrganisationDto: the same rules as the API's slug check.
export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Use 100 characters or fewer"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters")
    .max(50, "Use 50 characters or fewer")
    .regex(SLUG, "Lowercase letters, numbers and single hyphens only, like state-uni"),
});
export type WorkspaceSettingsValues = z.infer<typeof workspaceSettingsSchema>;
