import { describe, expect, it } from "vitest";
import { sortUsersByHebrewSurname } from "@/lib/user-sort";

describe("sortUsersByHebrewSurname", () => {
  it("sorts approved-user names by Hebrew surname", () => {
    const users = [
      { id: "u-cohen", fullName: "אמיר כהן" },
      { id: "u-avraham", fullName: "נועה אברהם" },
      { id: "u-zemler", fullName: "גיא זמלר" },
    ];

    expect(sortUsersByHebrewSurname(users).map((user) => user.fullName)).toEqual([
      "נועה אברהם",
      "גיא זמלר",
      "אמיר כהן",
    ]);
  });

  it("uses the full name as a stable tie-breaker for the same surname", () => {
    const users = [
      { id: "u-yael", fullName: "יעל כהן" },
      { id: "u-amir", fullName: "אמיר כהן" },
    ];

    expect(sortUsersByHebrewSurname(users).map((user) => user.fullName)).toEqual([
      "אמיר כהן",
      "יעל כהן",
    ]);
  });

  it("does not mutate the original user list", () => {
    const users = [
      { id: "u-nevo", fullName: "הילה נבו" },
      { id: "u-example", fullName: "חבר לדוגמה" },
    ];

    sortUsersByHebrewSurname(users);

    expect(users.map((user) => user.id)).toEqual(["u-nevo", "u-example"]);
  });
});