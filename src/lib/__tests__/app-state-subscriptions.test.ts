import { describe, expect, it } from "vitest";
import { mergePendingJoinRequests } from "@/lib/firebase/app-state-subscriptions";
import type { JoinRequest } from "@/lib/types";

const baseRequest: JoinRequest = {
  id: "join-old",
  userId: "user-old",
  fullName: "Old Pending",
  phone: "050-000-0000",
  status: "pending",
  createdAt: "2026-06-28T10:00:00.000Z",
};

describe("app state subscriptions", () => {
  it("removes stale pending join requests when the pending query changes", () => {
    const rejectedRequest: JoinRequest = {
      ...baseRequest,
      id: "join-rejected",
      status: "rejected",
    };
    const nextPendingRequest: JoinRequest = {
      ...baseRequest,
      id: "join-new",
      userId: "user-new",
      fullName: "New Pending",
    };

    const merged = mergePendingJoinRequests(
      [baseRequest, rejectedRequest],
      [nextPendingRequest],
    );

    expect(merged.map((request) => request.id)).toEqual(["join-new", "join-rejected"]);
    expect(merged.some((request) => request.id === "join-old")).toBe(false);
  });
});
