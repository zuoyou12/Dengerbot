// Detecting and stripping the tool calls a model writes into its text instead of making through
// the tool interface, and the correction message that asks it to call the tool for real.
//
// Ported from DeepSeek-Bot `ds-bot/src/host/turns.js` (https://github.com/DeepSeek-Bot/DeepSeek-Bot,
// Apache-2.0): the `WRITTEN_CALL` pattern, the strip and the wording of the correction are the
// original's, trimmed to the pure functions this backend needs. The detection misses some written
// calls and the strip could eat prose, so a wrong match only costs one bounded correction turn —
// the original reply is never rewritten for the user.

/** A tool call some models write into their text (the XML-like form of their own chat template). */
const WRITTEN_CALL = /<tool_call>\s*<function=|<function=[\w.-]+>\s*<parameter=/;

export const writesToolCall = (text: unknown): boolean => typeof text === "string" && WRITTEN_CALL.test(text);

export const stripWrittenCalls = (text: string): string =>
  text
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "")
    .replace(/<function=[\w.-]+>[\s\S]*?(?:<\/function>|$)/g, "")
    .trim();

/** The correction the next turn carries: what went wrong, and what to do instead. */
export const WRITTEN_TOOL_CALL_CORRECTION =
  "Your last reply wrote a tool call as plain text (<tool_call>…), so it did not run and nothing " +
  "happened. Call the tool through the tool interface now, then reply as you meant to.";
