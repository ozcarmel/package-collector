import type { CreateJoinRequestInput } from "@/lib/app-state-actions";
import type { AppUser } from "@/lib/types";

export const ozAdminFullName = "\u05e2\u05d5\u05d6 \u05db\u05e8\u05de\u05dc";
export const ozSuperAdminPhone = "0584411883";
export const ozAdminPhones = [ozSuperAdminPhone];
export const ozAdminPhone = ozAdminPhones[0];

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("00972") && digits.length > 5) {
    return `0${digits.slice(5).replace(/^0/, "")}`;
  }

  if (digits.startsWith("972") && digits.length > 3) {
    return `0${digits.slice(3).replace(/^0/, "")}`;
  }

  return digits;
}

export function isOzAdminShortcut(input: Pick<CreateJoinRequestInput, "fullName" | "phone">) {
  return input.fullName.trim().replace(/\s+/g, " ") === ozAdminFullName &&
    ozAdminPhones.includes(normalizePhone(input.phone));
}

export function isOzSuperAdminUser(
  user: Pick<AppUser, "phone" | "role" | "verificationStatus">,
) {
  return user.role === "owner" &&
    user.verificationStatus === "approved" &&
    normalizePhone(user.phone) === ozSuperAdminPhone;
}
