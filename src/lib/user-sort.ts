import type { AppUser } from "@/lib/types";

const hebrewNameCollator = new Intl.Collator("he-IL", {
  sensitivity: "base",
  numeric: true,
  ignorePunctuation: true,
});

function getLastName(fullName: string) {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  return nameParts.at(-1) ?? "";
}

export function sortUsersByHebrewSurname<
  T extends Pick<AppUser, "id" | "fullName">,
>(users: T[]) {
  return [...users].sort((firstUser, secondUser) => {
    const surnameComparison = hebrewNameCollator.compare(
      getLastName(firstUser.fullName),
      getLastName(secondUser.fullName),
    );

    if (surnameComparison !== 0) return surnameComparison;

    const fullNameComparison = hebrewNameCollator.compare(
      firstUser.fullName.trim(),
      secondUser.fullName.trim(),
    );

    if (fullNameComparison !== 0) return fullNameComparison;

    return firstUser.id.localeCompare(secondUser.id);
  });
}