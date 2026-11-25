import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

type Stream = {
  onDelta(text: string): void;
  onToolResult(tool: string, result: unknown): void;
  onDone(): void;
};
const root = new URL("..", import.meta.url);

test("route changes keep the same Bani conversation, unfinished reply and draft", async () => {
  const server = await createServer({
    root: fileURLToPath(root),
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    plugins: [{
      name: "mock-bani-chat-api",
      enforce: "pre",
      resolveId(id) { if (id === "../../lib/api") return "\0bani-chat-api"; },
      load(id) {
        if (id !== "\0bani-chat-api") return;
        return `
          export const createAIConversation = async () => ({ id: "chat" });
          export const getAIConversation = async () => ({ messages: globalThis.__baniSavedMessages ?? [] });
          export const streamAIChat = (...args) => globalThis.__baniTestStream(...args);
        `;
      },
    }],
  });
  const { BaniConversation } = await server.ssrLoadModule("/src/components/ai/BaniConversation.ts")
    .catch(async error => { await server.close(); throw error; });
  let stream: Stream | undefined;
  let finish!: () => void;
  let streamedFrom: unknown;
  let submittedChoice: unknown;
  let requestSignal: AbortSignal | undefined;
  let ready!: () => void;
  const streamReady = new Promise<void>(resolve => { ready = resolve; });
  const fake = (_org: string, _id: string, _prompt: string, callbacks: Stream,
    scope: { signal: AbortSignal }, _insight: unknown, page: unknown, choice: unknown) => new Promise<void>(resolve => {
      stream = callbacks;
      finish = resolve;
      streamedFrom = page;
      requestSignal = scope.signal;
      submittedChoice = choice;
      ready();
    });
  Object.assign(globalThis, { __baniTestStream: fake });
  const conversation = new BaniConversation("user", "org", "member");
  let opens = 0;
  const overview = { pathname: "/app/org/org/overview", search: "" };
  const action = { target: { destination: "budgets" }, label: "Budgets", immediate: true };
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
  try {
    const detach = conversation.attachNavigation(overview, () => { opens++; });
    const send = conversation.send("Open budgets");
    await streamReady;
    assert.deepEqual(streamedFrom, overview);
    assert.ok(stream);
    stream.onToolResult("navigate_to", action);
    assert.equal(opens, 1);
    conversation.setPrompt("Unsent follow-up");
    detach();
    conversation.invalidateHistory();
    conversation.activateHistory();
    conversation.attachNavigation({ pathname: "/app/org/org/budgets", search: "" }, () => { opens++; });
    stream.onToolResult("navigate_to", action);
    assert.equal(opens, 1, "A result from the previous page cannot open another destination");
    assert.equal(requestSignal?.aborted, false);
    assert.equal(conversation.getSnapshot().generationState, "thinking");
    stream.onDelta("Here is the destination.");
    stream.onDone();
    finish();
    await send;
    const snapshot = conversation.getSnapshot();
    assert.equal(snapshot.activeConversationId, "chat");
    assert.equal(snapshot.generationState, "completed");
    assert.equal(snapshot.prompt, "Unsent follow-up");
    assert.equal(snapshot.messages.at(-1)?.content, "Here is the destination.");
    assert.equal(snapshot.messages.at(-1)?.tool_results?.length, 2);

    const choice = { id: "transparency" };
    const actionResult = { kind: "clarification", actions: [{ kind: "prompt", label: "Financial transparency report", input: choice }] };
    Object.assign(globalThis, { __baniSavedMessages: JSON.parse(JSON.stringify([
      { ...snapshot.messages.at(-1), content: "Which report?", tool_results: [{ tool: "bani_actions", result: actionResult }] },
    ])) });
    conversation.dispose();
    const reopened = new BaniConversation("user", "org", "member");
    try {
      await reopened.selectConversation("chat");
      assert.deepEqual(reopened.getSnapshot().messages.at(-1)?.tool_results?.[0]?.result, actionResult);
      reopened.setPrompt("Keep this draft");
      const retryReady = new Promise<void>(resolve => { ready = resolve; });
      const actionSend = reopened.send("Financial transparency report", undefined, choice);
      await retryReady;
      assert.deepEqual(submittedChoice, choice);
      assert.equal(reopened.getSnapshot().prompt, "Keep this draft");
      stream.onDelta("Here is the report.");
      stream.onDone();
      finish();
      await actionSend;
      assert.equal(reopened.getSnapshot().generationState, "completed");
      assert.equal(reopened.getSnapshot().prompt, "Keep this draft");
    } finally {
      reopened.dispose();
    }
  } finally {
    conversation.dispose();
    Object.assign(globalThis, { requestAnimationFrame: originalRaf, cancelAnimationFrame: originalCancel });
    Reflect.deleteProperty(globalThis, "__baniTestStream");
    Reflect.deleteProperty(globalThis, "__baniSavedMessages");
    await server.close();
  }
});
