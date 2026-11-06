// Detecting and stripping the tool calls a model writes into its text instead of making through
// the tool interface, and the correction message that asks it to call the tool for real.
//
// Ported from DeepSeek-Bot `ds-bot/src/host/turns.js` (https://github.com/DeepSeek-Bot/DeepSeek-Bot,
// Apache-2.0): the `WRITTEN_CALL` pattern, the strip and the wording of the correction are the
// original's, trimmed to the pure functions this backend needs.
//
// A written call inside a code region is the model showing an example, not making a call. The
// detector therefore ignores fenced blocks (``` and ~~~, also unclosed), indented code, block
// quotes and inline code spans; the strip applies to the same regions.

/** A tool call some models write into their text (the XML-like form of their own chat template). */
const WRITTEN_CALL = /<tool_call>\s*<function=|<function=[\w.-]+>\s*<parameter=/;

/** Fenced blocks, block quote lines, indented code lines and inline code spans. */
const CODE_REGIONS = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|^[ \t]*>[^\n]*\n?|^(?: {4}|\t)[^\n]*\n?|`[^`\n]*`/gm;

/**
 * The text without its code regions. A fenced block that never closes runs to the end, so an
 * unclosed fence hides a real call after it too — the correction may then wait one turn, which is
 * cheaper than telling the model off over its own example.
 */
export const outsideCodeRegions = (text: string): string => text.replace(CODE_REGIONS, "");

export const writesToolCall = (text: unknown): boolean => {
  if (typeof text !== "string") return false;
  return WRITTEN_CALL.test(outsideCodeRegions(text));
};

export const stripWrittenCalls = (text: string): string =>
  outsideCodeRegions(text)
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "")
    .replace(/<function=[\w.-]+>[\s\S]*?(?:<\/function>|$)/g, "")
    .trim();

/** The correction the next turn carries: what went wrong, and what to do instead. */
export const WRITTEN_TOOL_CALL_CORRECTION =
  "Your last reply wrote a tool call as plain text (<tool_call>…), so it did not run and nothing " +
  "happened. Call the tool through the tool interface now, then reply as you meant to.";
