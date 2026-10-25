import { OrgRole } from './entities/org-member.entity.js';
import { orgRoleRank } from './org-roles.js';

/**
 * Who a workspace member can see by name (the Members page, search, the
 * default club's members). Open workspaces let anyone in, so a plain member
 * doesn't get the whole list: they see themselves, the workspace's staff
 * (who runs it), and people they share a club with. The default club
 * doesn't count: everyone is in it. Staff (moderator and up) see everyone.
 */
export const seesEveryone = (role: OrgRole): boolean => orgRoleRank(role) >= orgRoleRank(OrgRole.Moderator);

/**
 * SQL that's true when `me` may see the person `userColumn`, whose
 * workspace role is `roleColumn`. Inside the workspace's tenant transaction.
 */
export const visibleTo = (me: string, userColumn: string, roleColumn: string): string => `(
  ${userColumn} = ${me}
  OR ${roleColumn} IN ('owner', 'admin', 'moderator')
  OR EXISTS (
    SELECT 1 FROM club_members mine
    JOIN club_members theirs ON theirs.club_id = mine.club_id
    JOIN clubs shared ON shared.id = mine.club_id AND NOT shared.is_default
    WHERE mine.user_id = ${me} AND theirs.user_id = ${userColumn}
  )
)`;
