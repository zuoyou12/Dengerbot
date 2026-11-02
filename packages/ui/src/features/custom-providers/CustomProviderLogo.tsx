import { Show } from "solid-js";

const icons = import.meta.glob<string>("../../assets/provider-icons/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});
const monochrome = new Set(["moonshot", "kimi-code", "opencode-go", "commandcode", "zai", "xiaomi", "opencode"]);

/** Bundled vendor marks copied from Magpie; license files live beside the SVGs. */
export function CustomProviderLogo(props: { providerId: string }) {
  const url = () => icons[`../../assets/provider-icons/${props.providerId}.svg`];
  return (
    <Show when={url()}>
      {(source) => (
        <Show
          when={monochrome.has(props.providerId)}
          fallback={<img class="custom-provider-logo" src={source()} alt="" />}
        >
          <span
            class="custom-provider-logo custom-provider-logo-mono"
            aria-hidden="true"
            style={{ "mask-image": `url("${source()}")` }}
          />
        </Show>
      )}
    </Show>
  );
}
