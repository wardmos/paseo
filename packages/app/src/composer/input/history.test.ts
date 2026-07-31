import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { applyInputHistoryKey, collectInputHistory, isSameInputHistoryScope } from "./history";

function userMessage(id: string, text: string, timestamp: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(timestamp) };
}

function assistantMessage(id: string, text: string, timestamp: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(timestamp) };
}

describe("composer input history", () => {
  it("recalls the newest input and preserves the draft when ArrowUp starts navigation", () => {
    expect(
      applyInputHistoryKey({
        state: { kind: "idle" },
        history: ["first prompt", "second prompt"],
        key: "ArrowUp",
        value: "unfinished draft",
        selection: { start: 0, end: 0 },
      }),
    ).toEqual({
      handled: true,
      value: "second prompt",
      state: {
        kind: "browsing",
        history: ["first prompt", "second prompt"],
        index: 1,
        draft: "unfinished draft",
      },
    });
  });

  it("moves toward older inputs without wrapping past the oldest entry", () => {
    const browsing = {
      kind: "browsing" as const,
      history: ["first prompt", "second prompt"],
      index: 1,
      draft: "unfinished draft",
    };

    const older = applyInputHistoryKey({
      state: browsing,
      history: browsing.history,
      key: "ArrowUp",
      value: "second prompt",
      selection: { start: 13, end: 13 },
    });

    expect(older).toEqual({
      handled: true,
      value: "first prompt",
      state: { ...browsing, index: 0 },
    });
    if (!older.handled) {
      throw new Error("Expected ArrowUp to continue history navigation");
    }

    expect(
      applyInputHistoryKey({
        state: older.state,
        history: browsing.history,
        key: "ArrowUp",
        value: older.value,
        selection: { start: 12, end: 12 },
      }),
    ).toEqual({
      handled: true,
      value: "first prompt",
      state: { ...browsing, index: 0 },
    });
  });

  it("moves toward newer inputs and restores the draft after the newest entry", () => {
    const browsing = {
      kind: "browsing" as const,
      history: ["first prompt", "second prompt"],
      index: 0,
      draft: "unfinished draft",
    };

    const newer = applyInputHistoryKey({
      state: browsing,
      history: browsing.history,
      key: "ArrowDown",
      value: "first prompt",
      selection: { start: 12, end: 12 },
    });
    expect(newer).toEqual({
      handled: true,
      value: "second prompt",
      state: { ...browsing, index: 1 },
    });
    if (!newer.handled) {
      throw new Error("Expected ArrowDown to continue history navigation");
    }

    const restored = applyInputHistoryKey({
      state: newer.state,
      history: browsing.history,
      key: "ArrowDown",
      value: newer.value,
      selection: { start: 13, end: 13 },
    });
    expect(restored).toEqual({
      handled: true,
      value: "unfinished draft",
      state: { kind: "idle" },
    });
    if (!restored.handled) {
      throw new Error("Expected ArrowDown to restore the draft");
    }

    expect(
      applyInputHistoryKey({
        state: restored.state,
        history: browsing.history,
        key: "ArrowDown",
        value: restored.value,
        selection: { start: 16, end: 16 },
      }),
    ).toEqual({ handled: false });
  });

  it("collects non-empty user inputs from the tail and active head in order", () => {
    const tail = [
      userMessage("user-1", "first prompt", "2026-01-01T00:00:01.000Z"),
      assistantMessage("assistant-1", "response", "2026-01-01T00:00:02.000Z"),
      userMessage("user-empty", "   ", "2026-01-01T00:00:03.000Z"),
    ];
    const head = [userMessage("user-2", "second prompt", "2026-01-01T00:00:04.000Z")];

    expect(collectInputHistory(tail, head)).toEqual(["first prompt", "second prompt"]);
  });

  it.each([
    {
      name: "the history is empty",
      history: [],
      key: "ArrowUp",
      selection: { start: 0, end: 0 },
    },
    {
      name: "the cursor is not at the start",
      history: ["first prompt"],
      key: "ArrowUp",
      selection: { start: 4, end: 4 },
    },
    {
      name: "text is selected",
      history: ["first prompt"],
      key: "ArrowUp",
      selection: { start: 0, end: 4 },
    },
    {
      name: "ArrowDown is pressed before navigation starts",
      history: ["first prompt"],
      key: "ArrowDown",
      selection: { start: 0, end: 0 },
    },
  ])("leaves native cursor movement alone when $name", ({ history, key, selection }) => {
    expect(
      applyInputHistoryKey({
        state: { kind: "idle" },
        history,
        key,
        value: "line one\nline two",
        selection,
      }),
    ).toEqual({ handled: false });
  });

  it("leaves modified arrow keys to the native input behavior", () => {
    expect(
      applyInputHistoryKey({
        state: { kind: "idle" },
        history: ["first prompt"],
        key: "ArrowUp",
        value: "draft",
        selection: { start: 0, end: 0 },
        isModified: true,
      }),
    ).toEqual({ handled: false });

    expect(
      applyInputHistoryKey({
        state: {
          kind: "browsing",
          history: ["first prompt"],
          index: 0,
          draft: "draft",
        },
        history: ["first prompt"],
        key: "ArrowDown",
        value: "first prompt",
        selection: { start: 12, end: 12 },
        isModified: true,
      }),
    ).toEqual({ handled: false });
  });

  it("does not replace a draft that already has attachments", () => {
    expect(
      applyInputHistoryKey({
        state: { kind: "idle" },
        history: ["first prompt"],
        key: "ArrowUp",
        value: "describe the attached file",
        selection: { start: 0, end: 0 },
        hasAttachments: true,
      }),
    ).toEqual({ handled: false });
  });

  it("keeps navigation scoped to the same server, agent, and draft", () => {
    const scope = { serverId: "server-1", agentId: "agent-1", draftValue: "draft" };

    expect(isSameInputHistoryScope(scope, { ...scope })).toBe(true);
    expect(isSameInputHistoryScope(scope, { ...scope, serverId: "server-2" })).toBe(false);
    expect(isSameInputHistoryScope(scope, { ...scope, agentId: "agent-2" })).toBe(false);
    expect(isSameInputHistoryScope(scope, { ...scope, draftValue: "changed" })).toBe(false);
  });

  it("preserves native selection and multiline cursor movement while browsing", () => {
    const browsing = {
      kind: "browsing" as const,
      history: ["older prompt", "line one\nline two"],
      index: 1,
      draft: "draft",
    };

    expect(
      applyInputHistoryKey({
        state: browsing,
        history: browsing.history,
        key: "ArrowUp",
        value: "line one\nline two",
        selection: { start: 12, end: 12 },
      }),
    ).toEqual({ handled: false });
    expect(
      applyInputHistoryKey({
        state: browsing,
        history: browsing.history,
        key: "ArrowDown",
        value: "line one\nline two",
        selection: { start: 4, end: 4 },
      }),
    ).toEqual({ handled: false });
    expect(
      applyInputHistoryKey({
        state: browsing,
        history: browsing.history,
        key: "ArrowUp",
        value: "line one\nline two",
        selection: { start: 0, end: 4 },
      }),
    ).toEqual({ handled: false });
  });
});
