import { StackActions, useNavigation } from "@react-navigation/native";
import { sshTargetKey } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import {
  deleteSshCredentials,
  readSshCredentials,
  writeSshCredentials,
} from "../../connection/ssh/credentials";
import {
  isSshSupported,
  sshNative,
  sshNativeErrorCode,
  type SshKeyInfo,
} from "../../connection/ssh/native";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { ConnectionFormField } from "./ConnectionFormField";
import {
  cleanupSshCredentials,
  cleanupUnusedSshKey,
  currentSshTargets,
} from "./sshCredentialsCleanup";
import { parseSshTarget } from "./sshTarget";
import { useConnectionController } from "./useConnectionController";

const MAX_KEY_BYTES = 64 * 1024;

function sshErrorMessage(error: unknown): string {
  if (sshNativeErrorCode(error) === "SSH_KEY_INVALID") {
    return "This private key could not be read. Use an OpenSSH, PEM, or PuTTY private key.";
  }
  return error instanceof Error ? error.message : "Could not connect over SSH. Try again.";
}

export function SshConnectionForm({
  expectedEnvironmentId,
  formSheet,
}: {
  readonly expectedEnvironmentId: EnvironmentId | undefined;
  readonly formSheet: boolean;
}) {
  const navigation = useNavigation();
  const { connectSsh } = useConnectionController();
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("22");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState<SshKeyInfo | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resources = useRef({
    mounted: false,
    busy: false,
    key: null as SshKeyInfo | null,
    targets: new Map<string, DesktopSshEnvironmentTarget>(),
  });

  useEffect(() => {
    const owned = resources.current;
    owned.mounted = true;
    return () => {
      owned.mounted = false;
      // An in-flight operation releases its resources when it settles.
      if (!owned.busy) void cleanup();
    };

    async function cleanup() {
      for (const target of owned.targets.values()) await cleanupSshCredentials(target);
      if (owned.key !== null) await cleanupUnusedSshKey(owned.key.keyRef);
    }
  }, []);

  const finishOperation = async () => {
    const owned = resources.current;
    owned.busy = false;
    if (owned.mounted) {
      setBusy(false);
    } else {
      for (const target of owned.targets.values()) await cleanupSshCredentials(target);
      if (owned.key !== null) await cleanupUnusedSshKey(owned.key.keyRef);
    }
  };

  const chooseKey = async (action: () => Promise<SshKeyInfo | null>) => {
    const owned = resources.current;
    if (owned.busy || owned.key !== null) return;
    owned.busy = true;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next !== null) {
        owned.key = next;
        if (owned.mounted) {
          setKey(next);
          setPrivateKey("");
          setPasteOpen(false);
        }
      }
    } catch (cause) {
      if (owned.mounted) setError(sshErrorMessage(cause));
    } finally {
      await finishOperation();
    }
  };

  const importFile = async () => {
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
        throw new Error("Choose a private key file no larger than 64 KiB.");
      }
      text = await file.text();
      if (new TextEncoder().encode(text).byteLength > MAX_KEY_BYTES) {
        throw new Error("Choose a private key file no larger than 64 KiB.");
      }
    } finally {
      file.delete();
    }
    return native.importKey(text);
  };

  const submit = async () => {
    const owned = resources.current;
    if (owned.busy || owned.key === null) return;
    owned.busy = true;
    setBusy(true);
    setError(null);
    try {
      const target = parseSshTarget({ host, username, port });
      if (currentSshTargets().some((saved) => sshTargetKey(saved) === sshTargetKey(target))) {
        throw new Error("This SSH destination is already saved. Reconnect it from Environments.");
      }
      owned.targets.set(sshTargetKey(target), target);
      await writeSshCredentials(target, { keyRef: owned.key.keyRef, hostKey: null, bearerToken: null });
      if (!owned.mounted) return;
      const result = await connectSsh({
        target,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(expectedEnvironmentId === undefined ? {} : { expectedEnvironmentId }),
      });
      if (AsyncResult.isFailure(result)) throw Cause.squash(result.cause);
      // Registration owns this key now, even before the catalog atom catches up.
      const savedKeyRef = owned.key.keyRef;
      owned.key = null;
      owned.targets.delete(sshTargetKey(target));
      for (const attempted of owned.targets.values()) {
        try {
          if (currentSshTargets().some((saved) => sshTargetKey(saved) === sshTargetKey(attempted))) {
            continue;
          }
          const credentials = await readSshCredentials(attempted);
          if (credentials?.keyRef === savedKeyRef) await deleteSshCredentials(attempted);
        } catch {
          // Failure to clean an earlier attempt must not undo registration.
        }
      }
      owned.targets.clear();
      if (owned.mounted) {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.dispatch(StackActions.replace("Home"));
      }
    } catch (cause) {
      if (owned.mounted) setError(sshErrorMessage(cause));
    } finally {
      await finishOperation();
    }
  };

  return (
    <SettingsScreen formSheet={formSheet} title="Connect over SSH">
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {!isSshSupported() ? (
          <AppText>SSH connections require an Android build with SSH support.</AppText>
        ) : (
          <View collapsable={false} className="gap-4">
            <AppText>Connect to a running T3 Code server using an SSH key.</AppText>
            <ConnectionFormField
              label="Host"
              placeholder="user@server.example:22"
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <AppText className="text-sm text-foreground-muted">
              A username or port in Host overrides the fields below.
            </AppText>
            <ConnectionFormField
              label="Username"
              placeholder="user"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <ConnectionFormField
              label="Port"
              value={port}
              onChangeText={setPort}
              keyboardType="number-pad"
              editable={!busy}
            />
            <ConnectionFormField
              label="Label (optional)"
              placeholder="My server"
              value={label}
              onChangeText={setLabel}
              editable={!busy}
            />
            {key === null ? (
              <>
                <Button
                  label="Generate key"
                  disabled={busy}
                  fullWidth
                  onPress={() => void chooseKey(() => sshNative!.generateKey("t3code-android"))}
                />
                <Button
                  label="Import key file"
                  disabled={busy}
                  fullWidth
                  onPress={() => void chooseKey(importFile)}
                />
                <Button
                  label="Paste key"
                  disabled={busy}
                  fullWidth
                  onPress={() => setPasteOpen((open) => !open)}
                />
                {pasteOpen ? (
                  <>
                    <ConnectionFormField
                      label="Private key"
                      multiline
                      numberOfLines={6}
                      value={privateKey}
                      onChangeText={setPrivateKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!busy}
                    />
                    <Button
                      label="Import key"
                      disabled={busy || !privateKey.trim()}
                      fullWidth
                      onPress={() => void chooseKey(async () => {
                        const text = privateKey;
                        setPrivateKey("");
                        if (new TextEncoder().encode(text).byteLength > MAX_KEY_BYTES) {
                          throw new Error("Paste a private key no larger than 64 KiB.");
                        }
                        return sshNative!.importKey(text);
                      })}
                    />
                  </>
                ) : null}
              </>
            ) : (
              <View className="gap-3">
                <AppText>
                  {key.publicKey?.split(" ")[0] ??
                    (key.encrypted ? "Encrypted SSH key" : "SSH key imported")}
                </AppText>
                {key.publicKey !== null ? (
                  <>
                    <AppText selectable className="font-mono text-sm">
                      {key.publicKey}
                    </AppText>
                    <Button
                      label={copied ? "Copied" : "Copy public key"}
                      fullWidth
                      onPress={() => {
                        void Clipboard.setStringAsync(key.publicKey!)
                          .then(() => setCopied(true))
                          .catch(() => setError("Could not copy the public key. Select it to copy manually."));
                      }}
                    />
                    <AppText>Add this public key to ~/.ssh/authorized_keys on the server.</AppText>
                  </>
                ) : (
                  <AppText>The public key is unavailable until this key is unlocked.</AppText>
                )}
              </View>
            )}
            <AppText accessibilityLiveRegion="polite" className="text-danger-foreground">
              {error}
            </AppText>
            <Button
              label="Connect"
              tone="primary"
              loading={busy}
              disabled={key === null}
              fullWidth
              onPress={() => void submit()}
            />
          </View>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
