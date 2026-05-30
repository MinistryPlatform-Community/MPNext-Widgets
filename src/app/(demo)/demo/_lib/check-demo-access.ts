import { MPHelper } from "@/lib/providers/ministry-platform";

// No tenant-specific default: fail closed when unconfigured so a fresh tenant
// never inherits another tenant's demo-access group IDs. Grant access via
// DEMO_ACCESS_GROUP_IDS or DEMO_PUBLIC_ACCESS instead.
const DEMO_ACCESS_GROUP_IDS = (process.env.DEMO_ACCESS_GROUP_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * Check if the current user has access to the demo pages.
 *
 * When DEMO_PUBLIC_ACCESS=true (or "authenticated"), any authenticated user
 * can view demos — no group membership required. This is useful for Vercel
 * preview deploys and internal QA where every logged-in staff member should
 * have access without being added to specific MP groups.
 */
export async function checkDemoAccess(userGuid: string): Promise<boolean> {
  const publicAccess = process.env.DEMO_PUBLIC_ACCESS?.toLowerCase();
  if (publicAccess === "true" || publicAccess === "authenticated") {
    return true;
  }

  // Fail closed: with no configured groups (and no public access), deny.
  if (DEMO_ACCESS_GROUP_IDS.length === 0) {
    console.warn(
      "checkDemoAccess: neither DEMO_ACCESS_GROUP_IDS nor DEMO_PUBLIC_ACCESS is set; denying demo access.",
    );
    return false;
  }

  try {
    const mp = new MPHelper();

    // Resolve User_GUID → User_ID
    const users = await mp.getTableRecords<{ User_ID: number }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "User_ID",
      top: 1,
    });

    if (!users.length) return false;

    const userId = users[0].User_ID;

    // Check if user is in any of the allowed groups
    const groupFilter = DEMO_ACCESS_GROUP_IDS.map(
      (gid) => `User_Group_ID = ${gid}`
    ).join(" OR ");

    const memberships = await mp.getTableRecords<{ User_ID: number }>({
      table: "dp_User_User_Groups",
      filter: `User_ID = ${userId} AND (${groupFilter})`,
      select: "User_ID",
      top: 1,
    });

    return memberships.length > 0;
  } catch (error) {
    console.error("Error checking demo access:", error);
    return false;
  }
}
