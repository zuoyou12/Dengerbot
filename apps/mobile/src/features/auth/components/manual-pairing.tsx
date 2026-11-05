import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { type MobileSession, redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { useText } from "@/shared/lib/text";
import { useSignInColors } from "./sign-in-colors";
import { PaneItem, type PaneMotion, SignInButton, TextAction } from "./sign-in-panes";

/**
 * The paste-a-link entry of the sign-in screen. The desktop's Mobile Connect tab can show the
 * connection as text instead of a QR — a phone whose camera cannot read the code, or a link that
 * arrived over another channel, pairs here. It redeems with the same
 * {@link redeemMobileConnectUrl} the scanner uses, so the session, its storage and the error
 * wording are the one path.
 */
export function ManualPairing({
  motion,
  onDone,
  onScanInstead,
  reduced,
}: {
  motion: PaneMotion;
  onDone: (session: MobileSession) => void;
  onScanInstead: () => void;
  reduced: boolean;
}) {
  const { t } = useText();
  const colors = useSignInColors();
  const input = useRef<TextInput>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await redeemMobileConnectUrl(link.trim());
      onDone(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("mobile.auth.error.invalidCode"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <PaneItem index={0} motion={motion}>
        <Typography.Heading type="h2" accessibilityRole="header" className="tracking-openbot-tight">
          {t("mobile.auth.manual.title")}
        </Typography.Heading>
      </PaneItem>
      <PaneItem index={1} motion={motion} className="mt-2.5">
        <Typography.Paragraph color="muted">{t("mobile.auth.manual.description")}</Typography.Paragraph>
      </PaneItem>
      <PaneItem index={2} motion={motion} className="mt-5">
        <TextInput
          ref={input}
          value={link}
          onChangeText={setLink}
          placeholder={t("mobile.auth.manual.placeholder")}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardAppearance="dark"
          editable={!busy}
          multiline
          className="min-h-20 rounded-xl border border-hairline px-3.5 py-3 text-base text-color"
        />
        {error ? <Typography.Paragraph className="mt-2 text-danger-text">{error}</Typography.Paragraph> : null}
      </PaneItem>
      <PaneItem index={3} motion={motion} className="mt-2">
        <SignInButton
          brand
          label={busy ? t("mobile.auth.manual.connecting") : t("mobile.auth.manual.connect")}
          onPress={() => void connect()}
          busy={busy}
          reduced={reduced}
        />
      </PaneItem>
      <PaneItem index={4} motion={motion} className="mt-1.5 flex-row">
        <TextAction
          label={t("mobile.auth.email.useQrCode")}
          onPress={onScanInstead}
          disabled={busy}
          reduced={reduced}
        />
      </PaneItem>
    </View>
  );
}
