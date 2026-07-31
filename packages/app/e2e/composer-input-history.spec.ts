import { expect, test } from "./fixtures";
import { composerLocator, expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

const PREVIOUS_PROMPT = "Explain the current workspace state.";

async function moveComposerCursorToStart(input: ReturnType<typeof composerLocator>): Promise<void> {
  await input.press("Home");
  await expect
    .poll(() =>
      input.evaluate((element) =>
        element instanceof HTMLTextAreaElement ? element.selectionStart : -1,
      ),
    )
    .toBe(0);
}

test.describe("Composer input history", () => {
  test("recalls the previous prompt and restores the current draft", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "composer-input-history-",
      title: "Composer input history",
      initialPrompt: PREVIOUS_PROMPT,
    });

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await expect(page.getByText(PREVIOUS_PROMPT, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      const input = composerLocator(page);
      const draft = "Keep this unfinished draft.";
      await input.fill(draft);

      await input.press("ArrowUp");
      await expect(input).toHaveValue(draft);

      await moveComposerCursorToStart(input);
      await input.press("ArrowUp");
      await expect(input).toHaveValue(PREVIOUS_PROMPT);

      await input.press("ArrowDown");
      await expect(input).toHaveValue(draft);

      await moveComposerCursorToStart(input);
      await input.press("ArrowUp");
      await expect(input).toHaveValue(PREVIOUS_PROMPT);

      const editedRecall = "Expand the recalled prompt with this detail.";
      await input.fill(editedRecall);
      await moveComposerCursorToStart(input);
      await input.press("ArrowUp");
      await expect(input).toHaveValue(PREVIOUS_PROMPT);
      await input.press("ArrowDown");
      await expect(input).toHaveValue(editedRecall);
    } finally {
      await session.cleanup();
    }
  });
});
