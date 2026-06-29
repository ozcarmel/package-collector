import type { ParsedDeliveryMessage, PickupLocation } from "@/lib/types";

const courierMatchers: Array<[string, RegExp]> = [
  ["Cheetah", /cheetah|צ'?יטה/i],
  ["דואר ישראל", /דואר ישראל|israel post|RS\d+/i],
  ["HFD international", /\bHFD\s+international\b/i],
  ["HFD", /\bHFD\b/i],
  ["Boxit", /boxit|בוקסיט/i],
  ["UPS", /\bUPS\b/i],
  ["FedEx", /fedex/i],
];

const senderMatchers: Array<[string, RegExp]> = [
  ["Epost", /\bEpost\b/i],
  ["Cheetah", /cheetah|צ'?יטה/i],
  ["דואר ישראל", /דואר ישראל|israel post/i],
];

function compactHebrewText(value: string) {
  return value
    .replace(/[־–—-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseDeliveryMessage(
  message: string,
  pickupLocations: PickupLocation[],
): ParsedDeliveryMessage {
  const normalized = message.trim();
  const url = normalized.match(/https?:\/\/\S+/i)?.[0];
  const tracking =
    normalized.match(/מספר\s+((?:[\d-]+\s*){2,})/)?.[1]?.trim().replace(/\s+/g, " ") ??
    normalized.match(/\b[A-Z]{1,3}\d{6,}[A-Z0-9]*\b/)?.[0] ??
    normalized.match(/\b\d{8,}\b/)?.[0];
  const code =
    normalized.match(/(?:קוד לקבלת החבילה|קוד|code)\D{0,16}(\d{3,8})/i)?.[1] ??
    normalized.match(/\b\d{4}\b/)?.[0];

  const courierCompany = courierMatchers.find(([, pattern]) =>
    pattern.test(normalized),
  )?.[0];

  const messageForLocationMatching = compactHebrewText(normalized);
  const matchedLocation = pickupLocations.find((location) =>
    messageForLocationMatching.includes(compactHebrewText(location.name)),
  );

  const messageSender = senderMatchers.find(([, pattern]) =>
    pattern.test(normalized),
  )?.[0];

  const addresseeName =
    normalized.match(/(?:שלום|עבור|for)\s+([A-Za-zא-ת]+(?:\s+[A-Za-zא-ת]+)?)/i)?.[1] ??
    normalized.match(/נמען[:\s]+([A-Za-zא-ת]+(?:\s+[A-Za-zא-ת]+)?)/i)?.[1];

  const pickupDeadline =
    normalized.match(/תוך\s+(\d+\s+ימי\s+עסקים)/)?.[1] ??
    normalized.match(/לוקר\s+תוך\s+(\d+\s+שעות)/)?.[1];

  const confidence =
    matchedLocation && (url || code) ? "high" : matchedLocation ? "medium" : "low";

  return {
    courierCompany,
    messageSender,
    pickupLocationId: matchedLocation?.id,
    pickupPlaceName: matchedLocation?.name,
    addresseeName,
    trackingNumber: tracking,
    packageCode: code,
    pickupLink: url,
    pickupDeadline,
    confidence,
  };
}
