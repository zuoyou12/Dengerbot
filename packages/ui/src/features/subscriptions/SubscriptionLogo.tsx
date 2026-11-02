import { findSubscriptionPlugin } from "@openbot/contracts/subscription-catalog";
import { Puzzle } from "@openbot/ui";
import { Show } from "solid-js";

const icons = import.meta.glob<string>("../../assets/subscription-icons/*.{svg,png}", {
  eager: true,
  import: "default",
  query: "?url",
});
const monochrome = new Set([
  "cline",
  "commandcode",
  "cursor",
  "devin",
  "factory",
  "githubcopilot",
  "kimi",
  "mimocode",
  "nousresearch",
  "opencode",
  "qoder",
  "trae",
  "xai",
  "zed",
]);

/** Subscription vendor marks bundled from Magpie. License files are kept beside the assets. */
export function SubscriptionLogo(props: { providerId: string; icon?: string | undefined; class?: string | undefined }) {
  const icon = () => props.icon ?? findSubscriptionPlugin(props.providerId)?.icon ?? "generic";
  const url = () =>
    icons[`../../assets/subscription-icons/${icon()}.svg`] ?? icons[`../../assets/subscription-icons/${icon()}.png`];
  const className = () => ["subscription-logo", props.class].filter(Boolean).join(" ");
  return (
    <Show when={url()} fallback={<Puzzle class={className()} aria-hidden="true" />}>
      {(source) => (
        <Show when={monochrome.has(icon())} fallback={<img class={className()} src={source()} alt="" />}>
          <span
            class={className()}
            aria-hidden="true"
            style={{
              "background-color": "currentColor",
              "mask-image": `url("${source()}")`,
              "mask-size": "contain",
              "mask-position": "center",
              "mask-repeat": "no-repeat",
            }}
          />
        </Show>
      )}
    </Show>
  );
}
