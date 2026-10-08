import { describe, expect, it } from "vitest";
import {
  campaignReaderTokenFromLocation,
  isWellFormedCampaignReaderToken,
  publicCampaignReaderUrl,
} from "../lib/campaigns/reader-client";

describe("campaign reader link helpers", () => {
  it("accepts only 32-character base64url tokens", () => {
    expect(
      isWellFormedCampaignReaderToken("A".repeat(32)),
    ).toBe(true);

    expect(
      isWellFormedCampaignReaderToken("A".repeat(31)),
    ).toBe(false);

    expect(
      isWellFormedCampaignReaderToken(
        "A".repeat(31) + "+",
      ),
    ).toBe(false);
  });

  it("reads the token only from the URL fragment", () => {
    expect(
      campaignReaderTokenFromLocation({
        hash: "#" + encodeURIComponent("A".repeat(32)),
      }),
    ).toBe("A".repeat(32));

    expect(
      campaignReaderTokenFromLocation({ hash: "" }),
    ).toBeNull();
  });

  it("builds a reader URL with the token in the fragment", () => {
    const token = "A".repeat(32);

    expect(
      publicCampaignReaderUrl(
        token,
        "https://cds-administracion.web.app/",
      ),
    ).toBe(
      "https://cds-administracion.web.app/campanas-lector#" +
        token,
    );
  });
});
