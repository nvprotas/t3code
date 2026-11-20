import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { msg, T, useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { m } from "../../i18n/messages";
import { sshNative, type SshKeyInfo } from "../../connection/ssh/native";
import { ConnectionFormField } from "./ConnectionFormField";

const MAX_KEY_BYTES = 64 * 1024;

async function importSshKeyFile() {
  const native = sshNative;
  if (native === null) return null;
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const file = new File(result.assets[0]!.uri);
  let text: string;
  try {
    if (file.size > MAX_KEY_BYTES) {
      throw new Error(m(msg("Choose a private key file no larger than 64 KiB.")));
    }
    text = await file.text();
    if (new TextEncoder().encode(text).byteLength > MAX_KEY_BYTES) {
      throw new Error(m(msg("Choose a private key file no larger than 64 KiB.")));
    }
  } finally {
    file.delete();
  }
  return native.importKey(text);
}

export function SshKeyPicker({
  keyInfo: key,
  busy,
  onChoose,
  onError: setError,
}: {
  readonly keyInfo: SshKeyInfo | null;
  readonly busy: boolean;
  readonly onChoose: (action: () => Promise<SshKeyInfo | null>) => Promise<void>;
  readonly onError: (error: string) => void;
}) {
  const gt = useGT();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [copied, setCopied] = useState(false);
  const chooseKey = (action: () => Promise<SshKeyInfo | null>) =>
    onChoose(async () => {
      const selected = await action();
      if (selected !== null) {
        setPrivateKey("");
        setPasteOpen(false);
      }
      return selected;
    });
  return (
    <>
      {key === null ? (
        <>
          <Button
            label={gt("Generate key")}
            disabled={busy}
            fullWidth
            onPress={() => void chooseKey(() => sshNative!.generateKey("t3code-android"))}
          />
          <Button
            label={gt("Import key file")}
            disabled={busy}
            fullWidth
            onPress={() => void chooseKey(importSshKeyFile)}
          />
          <Button
            label={gt("Paste key")}
            disabled={busy}
            fullWidth
            onPress={() => setPasteOpen((open) => !open)}
          />
          {pasteOpen ? (
            <>
              <ConnectionFormField
                label={gt("Private key")}
                multiline
                numberOfLines={6}
                value={privateKey}
                onChangeText={setPrivateKey}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
              />
              <Button
                label={gt("Import key")}
                disabled={busy || !privateKey.trim()}
                fullWidth
                onPress={() =>
                  void chooseKey(async () => {
                    const text = privateKey;
                    setPrivateKey("");
                    if (new TextEncoder().encode(text).byteLength > MAX_KEY_BYTES) {
                      throw new Error(gt("Paste a private key no larger than 64 KiB."));
                    }
                    return sshNative!.importKey(text);
                  })
                }
              />
            </>
          ) : null}
        </>
      ) : (
        <View className="gap-3">
          <AppText>
            {key.publicKey?.split(" ")[0] ??
              (key.encrypted ? gt("Encrypted SSH key") : gt("SSH key imported"))}
          </AppText>
          {key.publicKey !== null ? (
            <>
              <AppText selectable className="font-mono text-sm">
                {key.publicKey}
              </AppText>
              <Button
                label={copied ? gt("Copied") : gt("Copy public key")}
                fullWidth
                onPress={() => {
                  void Clipboard.setStringAsync(key.publicKey!)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(gt("Could not copy the public key. Select it to copy manually.")),
                    );
                }}
              />
              <AppText>
                <T>Add this public key to ~/.ssh/authorized_keys on the server.</T>
              </AppText>
            </>
          ) : (
            <AppText>
              <T>The public key is unavailable until this key is unlocked.</T>
            </AppText>
          )}
        </View>
      )}
    </>
  );
}
