import { describe, expect, it } from "vitest";
import { createWhatsAppUrl, toWhatsAppPhoneNumber } from "@/lib/whatsapp";

describe("WhatsApp contact links", () => {
  it.each([
    "0581234567",
    "058-123-4567",
    "058 123 4567",
    "+972581234567",
    "00972581234567",
    "581234567",
  ])("normalizes %s to the same Israeli WhatsApp number", (phone) => {
    expect(toWhatsAppPhoneNumber(phone)).toBe("972581234567");
  });

  it("creates a direct WhatsApp URL without a prewritten message", () => {
    const url = createWhatsAppUrl("058-123-4567");

    expect(url).toBe("https://wa.me/972581234567");
    expect(url).not.toContain("text=");
    expect(url).not.toContain("?");
  });

  it.each(["", "1234", "0721234567", "+441234567890"])(
    "rejects invalid or non-mobile contact number %s",
    (phone) => {
      expect(toWhatsAppPhoneNumber(phone)).toBeNull();
      expect(createWhatsAppUrl(phone)).toBeNull();
    },
  );
});
