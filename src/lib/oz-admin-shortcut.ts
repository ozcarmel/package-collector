import type { CreateJoinRequestInput } from "@/lib/app-state-actions";

export const ozAdminFullName = "\u05e2\u05d5\u05d6 \u05db\u05e8\u05de\u05dc";
export const ozAdminPhones = ["0504411883", "0584411883"];
export const ozAdminPhone = ozAdminPhones[0];

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function isOzAdminShortcut(input: Pick<CreateJoinRequestInput, "fullName" | "phone">) {
  return input.fullName.trim().replace(/\s+/g, " ") === ozAdminFullName &&
    ozAdminPhones.includes(normalizePhone(input.phone));
}
