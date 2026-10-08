import type { User } from "firebase/auth";

export const CAMPAIGN_READER_PAGE_PATH = "/campanas-lector";
export const CAMPAIGN_READER_FEED_PATH = "/api/campana-lector";
export const CAMPAIGN_READER_LINK_PATH = "/api/campana-lector-link";

export type CampaignReaderItemStatus = "verified" | "pending";

export interface CampaignReaderItem {
  id: string;
  name: string;
  amount: number;
  date: string;
  status: CampaignReaderItemStatus;
}

export interface CampaignReaderData {
  title: string;
  goalAmount: number;
  verifiedAmount: number;
  currentInstallment: number;
  totalInstallments: number;
  verifiedCount: number;
  pendingCount: number;
  items: CampaignReaderItem[];
}

export interface CampaignReaderLinkStatus {
  exists: boolean;
  active: boolean;
  rotation: number;
}

type AuthUser = Pick<User, "getIdToken">;

export function isWellFormedCampaignReaderToken(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{32}$/.test(value)
  );
}

export function campaignReaderTokenFromLocation(loc: {
  hash: string;
}): string | null {
  const raw =
    typeof loc.hash === "string"
      ? loc.hash.replace(/^#/, "")
      : "";

  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function publicCampaignReaderUrl(
  token: string,
  origin?: string,
) {
  const base = (
    origin ??
    (typeof window !== "undefined"
      ? window.location.origin
      : "")
  ).replace(/\/+$/, "");

  return (
    base +
    CAMPAIGN_READER_PAGE_PATH +
    "#" +
    encodeURIComponent(token)
  );
}

export class CampaignReaderError extends Error {
  constructor(
    public readonly kind:
      | "network"
      | "server"
      | "invalid"
      | "forbidden",
  ) {
    super("campaign-reader/" + kind);
    this.name = "CampaignReaderError";
  }
}

function isReaderData(value: unknown): value is CampaignReaderData {
  if (!value || typeof value !== "object") return false;

  const data = value as Record<string, unknown>;

  return (
    typeof data.title === "string" &&
    typeof data.goalAmount === "number" &&
    typeof data.verifiedAmount === "number" &&
    typeof data.currentInstallment === "number" &&
    typeof data.totalInstallments === "number" &&
    typeof data.verifiedCount === "number" &&
    typeof data.pendingCount === "number" &&
    Array.isArray(data.items)
  );
}

export async function fetchCampaignReader(
  token: unknown,
): Promise<CampaignReaderData | "unavailable"> {
  if (!isWellFormedCampaignReaderToken(token)) {
    return "unavailable";
  }

  let response: Response;

  try {
    response = await fetch(CAMPAIGN_READER_FEED_PATH, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    throw new CampaignReaderError("network");
  }

  if (response.status === 404) {
    return "unavailable";
  }

  if (!response.ok) {
    throw new CampaignReaderError("server");
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new CampaignReaderError("invalid");
  }

  const parsed = body as
    | { ok?: unknown; campaign?: unknown }
    | null;

  if (
    !parsed ||
    parsed.ok !== true ||
    !isReaderData(parsed.campaign)
  ) {
    throw new CampaignReaderError("invalid");
  }

  return parsed.campaign;
}

async function manageReaderLink(
  user: AuthUser,
  campaignId: string,
  action: "status" | "issue" | "deactivate",
) {
  const idToken = await user.getIdToken();

  let response: Response;

  try {
    response = await fetch(CAMPAIGN_READER_LINK_PATH, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: JSON.stringify({
        campaignId,
        action,
      }),
    });
  } catch {
    throw new CampaignReaderError("network");
  }

  if (response.status === 401 || response.status === 403) {
    throw new CampaignReaderError("forbidden");
  }

  if (!response.ok) {
    throw new CampaignReaderError("server");
  }

  return (await response.json()) as {
    ok: true;
    token?: string;
    status: CampaignReaderLinkStatus;
  };
}

export async function getCampaignReaderLinkStatus(
  user: AuthUser,
  campaignId: string,
) {
  return manageReaderLink(user, campaignId, "status");
}

export async function issueCampaignReaderLink(
  user: AuthUser,
  campaignId: string,
) {
  const result = await manageReaderLink(
    user,
    campaignId,
    "issue",
  );

  if (!isWellFormedCampaignReaderToken(result.token)) {
    throw new CampaignReaderError("invalid");
  }

  return {
    ...result,
    token: result.token,
  };
}

export async function deactivateCampaignReaderLink(
  user: AuthUser,
  campaignId: string,
) {
  return manageReaderLink(user, campaignId, "deactivate");
}
