import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { applyInputHistoryKey, collectInputHistory, isSameInputHistoryScope } from "./history";

type HistoryKeyInput = Parameters<typeof applyInputHistoryKey>[0];
type HandledHistoryResult = Extract<ReturnType<typeof applyInputHistoryKey>, { handled: true }>;

const HISTORY = ["first prompt", "second prompt"];
const DRAFT = "unfinished draft";

function applyKey(overrides: Partial<HistoryKeyInput> = {}) {
  return applyInputHistoryKey({
    state: { kind: "idle" },
    history: HISTORY,
    key: "ArrowUp",
    value: DRAFT,
    selection: { start: 0, end: 0 },
    ...overrides,
  });
}

function expectHandled(
  result: ReturnType<typeof applyInputHistoryKey>,
): asserts result is HandledHistoryResult {
  expect(result.handled).toBe(true);
}

function userMessage(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date("2026-01-01T00:00:00.000Z") };
}

function assistantMessage(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date("2026-01-01T00:00:00.000Z") };
}

describe("composer input history", () => {
  it("navigates older and newer inputs without wrapping, then restores the draft", () => {
    const newest = applyKey();
    expect(newest).toEqual({
      handled: true,
      value: "second prompt",
      state: { kind: "browsing", history: HISTORY, index: 1, draft: DRAFT },
    });
    expectHandled(newest);

    const older = applyKey({
      state: newest.state,
      value: newest.value,
      selection: { start: newest.value.length, end: newest.value.length },
    });
    expect(older).toEqual({
      handled: true,
      value: "first prompt",
      state: { kind: "browsing", history: HISTORY, index: 0, draft: DRAFT },
    });
    expectHandled(older);

    expect(
      applyKey({
        state: older.state,
        value: older.value,
        selection: { start: older.value.length, end: older.value.length },
      }),
    ).toEqual({
      handled: true,
      value: "first prompt",
      state: { kind: "browsing", history: HISTORY, index: 0, draft: DRAFT },
    });

    const newer = applyKey({
      state: older.state,
      key: "ArrowDown",
      value: older.value,
      selection: { start: older.value.length, end: older.value.length },
    });
    expect(newer).toEqual({
      handled: true,
      value: "second prompt",
      state: { kind: "browsing", history: HISTORY, index: 1, draft: DRAFT },
    });
    expectHandled(newer);

    expect(
      applyKey({
        state: newer.state,
        key: "ArrowDown",
        value: newer.value,
        selection: { start: newer.value.length, end: newer.value.length },
      }),
    ).toEqual({ handled: true, value: DRAFT, state: { kind: "idle" } });
  });

  it("collects non-empty user inputs from the tail and active head in order", () => {
    const tail = [
      userMessage("user-1", "first prompt"),
      assistantMessage("assistant-1", "response"),
      userMessage("user-empty", "   "),
    ];
    const head = [userMessage("user-2", "second prompt")];

    expect(collectInputHistory(tail, head)).toEqual(HISTORY);
  });

  const browsingNewest = {
    kind: "browsing" as const,
    history: HISTORY,
    index: 1,
    draft: DRAFT,
  };
  const nativeBehaviorCases: Array<{ name: string; input: Partial<HistoryKeyInput> }> = [
    { name: "the history is empty", input: { history: [] } },
    { name: "the cursor is not at the start", input: { selection: { start: 4, end: 4 } } },
    { name: "text is selected", input: { selection: { start: 0, end: 4 } } },
    { name: "ArrowDown is pressed before navigation starts", input: { key: "ArrowDown" } },
    { name: "ArrowUp is modified while idle", input: { isModified: true } },
    {
      name: "ArrowDown is modified while browsing",
      input: {
        state: browsingNewest,
        key: "ArrowDown",
        value: "second prompt",
        selection: { start: 13, end: 13 },
        isModified: true,
      },
    },
    { name: "the draft has attachments", input: { hasAttachments: true } },
  ];

  it.each(nativeBehaviorCases)("leaves native input behavior alone when $name", ({ input }) => {
    expect(applyKey(input)).toEqual({ handled: false });
  });

  it("keeps navigation scoped to the same server, agent, and draft", () => {
    const scope = { serverId: "server-1", agentId: "agent-1", draftValue: "draft" };

    expect([
      isSameInputHistoryScope(scope, { ...scope }),
      isSameInputHistoryScope(scope, { ...scope, serverId: "server-2" }),
      isSameInputHistoryScope(scope, { ...scope, agentId: "agent-2" }),
      isSameInputHistoryScope(scope, { ...scope, draftValue: "changed" }),
    ]).toEqual([true, false, false, false]);
  });

  const multilineValue = "line one\nline two";
  const multilineBrowsing = {
    kind: "browsing" as const,
    history: ["older prompt", multilineValue],
    index: 1,
    draft: "draft",
  };

  it.each([
    { name: "ArrowUp is pressed below the first line", key: "ArrowUp", start: 12, end: 12 },
    { name: "ArrowDown is pressed above the last line", key: "ArrowDown", start: 4, end: 4 },
    { name: "text is selected", key: "ArrowUp", start: 0, end: 4 },
  ])("preserves multiline input when $name", ({ key, start, end }) => {
    expect(
      applyKey({
        state: multilineBrowsing,
        history: multilineBrowsing.history,
        key,
        value: multilineValue,
        selection: { start, end },
      }),
    ).toEqual({ handled: false });
  });
});
