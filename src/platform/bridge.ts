import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { assert } from "../errors.js";
import { createTokenPair } from "../security.js";
import { accountSession } from "./service.js";
import { platformEnabled } from "./config.js";
import { entitlement } from "./billing.js";

/** Compatibility boundary. Legacy tokens bypass this module entirely. */
export async function platformWorkspaceBridge(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (req.path.startsWith("/api/platform/")) return next();
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer pg1.")) return next();
  try {
    assert(
      platformEnabled(),
      503,
      "PLATFORM_NOT_ENABLED",
      "Account services are not activated yet.",
    );
    const { membership } = await accountSession(header.slice(7));
    assert(
      membership && membership.actor && membership.actor.status === "ACTIVE",
      403,
      "WORKSPACE_REQUIRED",
      "Choose an active workspace.",
    );
    const path = req.path;
    // The legacy provider account must never receive a new organisation's rent.
    assert(
      membership.organisation.legacyAccess ||
        !(req.method === "POST" && path.startsWith("/api/student/payments/")) ||
        path === "/api/student/payments/order" ||
        path === "/api/student/payments/verify",
      409,
      "MERCHANT_ACTIVATION_REQUIRED",
      "Only a verified Razorpay Route order can collect new owners' rent. Fixed QR collection to PGOne's shared account is disabled.",
    );
    const owner = membership.role === "OWNER";
    assert(
      owner || membership.role === "RESIDENT",
      403,
      "FORBIDDEN",
      "Staff must use their assigned workspace.",
    );
    assert(
      path === "/api/auth/me" ||
        path.startsWith("/api/receipts/") ||
        path.startsWith("/api/notifications/") ||
        path.startsWith(owner ? "/api/owner/" : "/api/student/"),
      403,
      "PLATFORM_ROUTE_NOT_ALLOWED",
      "Use account settings for this action.",
    );
    assert(
      (owner &&
        membership.actor.role === "OWNER" &&
        membership.property.ownerId === membership.actor.id &&
        membership.organisation.legacyOwnerId === membership.actor.id) ||
        (!owner && membership.actor.role === "STUDENT"),
      403,
      "MEMBERSHIP_INVALID",
      "Workspace access needs to be confirmed.",
    );
    if (!owner) {
      const student = await prisma.student.findFirst({
        where: {
          userId: membership.actor.id,
          propertyId: membership.propertyId,
          status: "ACTIVE",
        },
      });
      assert(
        student,
        403,
        "RESIDENT_INACTIVE",
        "This residency is not active.",
      );
    }
    const requestedProperty = req.header("x-property-id");
    assert(
      !requestedProperty || requestedProperty === membership.propertyId,
      403,
      "PROPERTY_ACCESS_DENIED",
      "Choose that property through your workspaces.",
    );
    // A subscription gates the owner dashboard AND operational reads, not
    // merely writes. Prevent direct API calls / cached routes from bypassing
    // onboarding. Keep authentication, platform subscription and legal routes
    // outside this guard so unpaid owners can recover their account.
    if (owner && path.startsWith("/api/owner/")) {
      assert(
        await entitlement(membership.organisation.id),
        402,
        "SUBSCRIPTION_REQUIRED",
        "Activate PGOne for ₹249/month before accessing your management workspace.",
      );
    }
    if (owner && req.method !== "GET") {
      assert(
        !(path === "/api/owner/properties" && req.method === "POST"),
        409,
        "USE_ONBOARDING",
        "Create properties through PG setup.",
      );
      // Non-dashboard financial/notification mutations keep their historical
      // restrictions while the paid owner operational API is guarded above.
      if (!path.startsWith("/api/owner/")) {
        assert(
          await entitlement(membership.organisation.id),
          402,
          "SUBSCRIPTION_REQUIRED",
          "Your PGOne subscription needs attention. Existing records remain available.",
        );
      }
    }
    req.headers["x-property-id"] = membership.propertyId;
    // The existing handlers still perform their normal actor, role and property checks.
    // This request-local token is never returned to the client or persisted.
    req.headers.authorization = `Bearer ${createTokenPair(membership.actor).accessToken}`;
    next();
  } catch (error) {
    next(error);
  }
}
