import type { StreamItem } from "@/types/stream";

export interface InputHistorySelection {
  start: number;
  end: number;
}

export interface InputHistoryScope {
  serverId: string;
  agentId: string;
  draftValue: string;
}

export type InputHistoryNavigationState =
  | { kind: "idle" }
  | {
      kind: "browsing";
      history: readonly string[];
      index: number;
      draft: string;
    };

export const IDLE_INPUT_HISTORY_STATE: InputHistoryNavigationState = { kind: "idle" };

export function isSameInputHistoryScope(
  left: InputHistoryScope,
  right: InputHistoryScope,
): boolean {
  return (
    left.serverId === right.serverId &&
    left.agentId === right.agentId &&
    left.draftValue === right.draftValue
  );
}

interface ApplyInputHistoryKeyInput {
  state: InputHistoryNavigationState;
  history: readonly string[];
  key: string;
  value: string;
  selection: InputHistorySelection;
  isModified?: boolean;
  hasAttachments?: boolean;
}

export type InputHistoryKeyResult =
  | { handled: false }
  | {
      handled: true;
      value: string;
      state: InputHistoryNavigationState;
    };

export function collectInputHistory(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
): string[] {
  const history: string[] = [];
  for (const items of [tail, head]) {
    for (const item of items) {
      if (item.kind === "user_message" && item.text.trim().length > 0) {
        history.push(item.text);
      }
    }
  }
  return history;
}

function canBrowseOlder(value: string, selection: InputHistorySelection): boolean {
  return selection.start === selection.end && !value.slice(0, selection.start).includes("\n");
}

function canBrowseNewer(value: string, selection: InputHistorySelection): boolean {
  return selection.start === selection.end && !value.slice(selection.end).includes("\n");
}

export function applyInputHistoryKey(input: ApplyInputHistoryKeyInput): InputHistoryKeyResult {
  if (input.isModified) {
    return { handled: false };
  }

  if (input.state.kind === "idle" && input.hasAttachments) {
    return { handled: false };
  }

  if (input.state.kind === "browsing" && input.key === "ArrowUp") {
    if (!canBrowseOlder(input.value, input.selection)) {
      return { handled: false };
    }
    const index = Math.max(0, input.state.index - 1);
    const value = input.state.history[index];
    if (value === undefined) {
      return { handled: false };
    }
    return {
      handled: true,
      value,
      state: { ...input.state, index },
    };
  }

  if (input.state.kind === "browsing" && input.key === "ArrowDown") {
    if (!canBrowseNewer(input.value, input.selection)) {
      return { handled: false };
    }
    const index = input.state.index + 1;
    if (index >= input.state.history.length) {
      return {
        handled: true,
        value: input.state.draft,
        state: IDLE_INPUT_HISTORY_STATE,
      };
    }
    const value = input.state.history[index];
    if (value === undefined) {
      return { handled: false };
    }
    return {
      handled: true,
      value,
      state: { ...input.state, index },
    };
  }

  const canStart =
    input.state.kind === "idle" &&
    input.key === "ArrowUp" &&
    input.selection.start === 0 &&
    input.selection.end === 0 &&
    input.history.length > 0;
  if (!canStart) {
    return { handled: false };
  }

  const index = input.history.length - 1;
  return {
    handled: true,
    value: input.history[index],
    state: {
      kind: "browsing",
      history: input.history,
      index,
      draft: input.value,
    },
  };
}
