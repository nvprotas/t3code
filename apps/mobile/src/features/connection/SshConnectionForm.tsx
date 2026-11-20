import { StackActions, useNavigation } from "@react-navigation/native";
import { sshTargetKey } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { msg, T, useGT } from "gt-react-native";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { m } from "../../i18n/messages";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import {
  deleteSshCredentials,
  readSshCredentials,
  writeSshCredentials,
} from "../../connection/ssh/credentials";
import { isSshSupported, sshNativeErrorCode, type SshKeyInfo } from "../../connection/ssh/native";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { ConnectionFormField } from "./ConnectionFormField";
import {
  cleanupSshCredentials,
  cleanupUnusedSshKey,
  currentSshTargets,
} from "./sshCredentialsCleanup";
import { parseSshTarget } from "./sshTarget";
import { SshKeyPicker } from "./SshKeyPicker";
import { sshDiagnosticsText } from "../../connection/ssh/diagnostics";
import { useConnectionController } from "./useConnectionController";

function sshErrorMessage(error: unknown): string {
  if (sshNativeErrorCode(error) === "SSH_KEY_INVALID") {
    return m(msg("This private key could not be read. Use an OpenSSH, PEM, or PuTTY private key."));
  }
  return error instanceof Error ? error.message : m(msg("Could not connect over SSH. Try again."));
}

async function cleanupEarlierSshAttempts(
  targets: Iterable<DesktopSshEnvironmentTarget>,
  savedKeyRef: string,
) {
  for (const attempted of targets) {
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
}

export function SshConnectionForm({
  expectedEnvironmentId,
}: {
  readonly expectedEnvironmentId: EnvironmentId | undefined;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const { connectSsh } = useConnectionController();
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("22");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState<SshKeyInfo | null>(null);
  const [useBastion, setUseBastion] = useState(false);
  const [bastionHost, setBastionHost] = useState("");
  const [bastionUsername, setBastionUsername] = useState("");
  const [bastionPort, setBastionPort] = useState("22");
  const [bastionKey, setBastionKey] = useState<SshKeyInfo | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [attemptedTarget, setAttemptedTarget] = useState<DesktopSshEnvironmentTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resources = useRef({
    mounted: false,
    busy: false,
    key: null as SshKeyInfo | null,
    bastionKey: null as SshKeyInfo | null,
    targets: new Map<string, DesktopSshEnvironmentTarget>(),
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release temporary native SSH keys and credentials when their form unmounts.
  useEffect(() => {
    const owned = resources.current;
    owned.mounted = true;
    async function cleanup() {
      for (const target of owned.targets.values()) await cleanupSshCredentials(target);
      for (const selected of [owned.key, owned.bastionKey]) {
        if (selected !== null) await cleanupUnusedSshKey(selected.keyRef);
      }
    }
    return () => {
      owned.mounted = false;
      // An in-flight operation releases its resources when it settles.
      if (!owned.busy) void cleanup();
    };
  }, []);

  const finishOperation = async () => {
    const owned = resources.current;
    owned.busy = false;
    if (owned.mounted) {
      setBusy(false);
    } else {
      for (const target of owned.targets.values()) await cleanupSshCredentials(target);
      for (const selected of [owned.key, owned.bastionKey]) {
        if (selected !== null) await cleanupUnusedSshKey(selected.keyRef);
      }
    }
  };

  const chooseKey = async (
    role: "target" | "bastion",
    action: () => Promise<SshKeyInfo | null>,
  ) => {
    const owned = resources.current;
    const slot = role === "target" ? "key" : "bastionKey";
    if (owned.busy || owned[slot] !== null) return;
    owned.busy = true;
    setBusy(true);
    setError(null);
    await Promise.resolve()
      .then(action)
      .then((next) => {
        if (next !== null) {
          owned[slot] = next;
          if (owned.mounted) {
            if (role === "target") setKey(next);
            else setBastionKey(next);
          }
        }
      })
      .catch((cause: unknown) => {
        if (owned.mounted) setError(sshErrorMessage(cause));
      })
      .finally(finishOperation);
  };

  const submit = async () => {
    const owned = resources.current;
    const selectedKey = owned.key;
    if (owned.busy || selectedKey === null || (useBastion && owned.bastionKey === null)) return;
    owned.busy = true;
    setBusy(true);
    setError(null);
    setDiagnosticsCopied(false);
    setAttemptedTarget(null);
    await Promise.resolve()
      .then(async () => {
        const target = {
          ...parseSshTarget({ host, username, port }),
          ...(useBastion
            ? {
                bastion: parseSshTarget({
                  host: bastionHost,
                  username: bastionUsername,
                  port: bastionPort,
                }),
              }
            : {}),
        };
        setAttemptedTarget(target);
        if (currentSshTargets().some((saved) => sshTargetKey(saved) === sshTargetKey(target))) {
          throw new Error(
            gt("This SSH destination is already saved. Reconnect it from Environments."),
          );
        }
        const previous = owned.targets.has(sshTargetKey(target))
          ? await readSshCredentials(target)
          : null;
        owned.targets.set(sshTargetKey(target), target);
        await writeSshCredentials(
          target,
          previous ?? {
            keyRef: selectedKey.keyRef,
            hostKey: null,
            bearerToken: null,
            ...(useBastion && owned.bastionKey !== null
              ? { bastion: { keyRef: owned.bastionKey.keyRef, hostKey: null } }
              : {}),
          },
        );
        if (!owned.mounted) return;
        const result = await connectSsh({
          target,
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(expectedEnvironmentId === undefined ? {} : { expectedEnvironmentId }),
        });
        if (AsyncResult.isFailure(result)) throw Cause.squash(result.cause);
        // Registration owns this key now, even before the catalog atom catches up.
        const savedKeyRef = selectedKey.keyRef;
        owned.key = null;
        const unusedBastionKey = useBastion ? null : owned.bastionKey;
        owned.bastionKey = null;
        if (unusedBastionKey !== null && unusedBastionKey.keyRef !== savedKeyRef) {
          await cleanupUnusedSshKey(unusedBastionKey.keyRef);
        }
        owned.targets.delete(sshTargetKey(target));
        await cleanupEarlierSshAttempts(owned.targets.values(), savedKeyRef);
        owned.targets.clear();
        if (owned.mounted) {
          if (navigation.canGoBack()) navigation.goBack();
          else navigation.dispatch(StackActions.replace("Home"));
        }
      })
      .catch((cause: unknown) => {
        if (owned.mounted) setError(sshErrorMessage(cause));
      })
      .finally(finishOperation);
  };

  return (
    <SettingsScreen title={gt("Connect over SSH")}>
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {!isSshSupported() ? (
          <AppText>
            <T>SSH connections require an Android build with SSH support.</T>
          </AppText>
        ) : (
          <View collapsable={false} className="gap-4">
            <AppText>
              <T>Connect to a running T3 Code server using an SSH key.</T>
            </AppText>
            <ConnectionFormField
              label={gt("Host")}
              placeholder="user@server.example:22"
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <AppText className="text-sm text-foreground-muted">
              <T>A username or port in Host overrides the fields below.</T>
            </AppText>
            <ConnectionFormField
              label={gt("Username")}
              placeholder="user"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <ConnectionFormField
              label={gt("Port")}
              value={port}
              onChangeText={setPort}
              keyboardType="number-pad"
              editable={!busy}
            />
            <ConnectionFormField
              label={gt("Label (optional)")}
              placeholder={gt("My server")}
              value={label}
              onChangeText={setLabel}
              editable={!busy}
            />
            <AppText>
              <T>Target SSH key</T>
            </AppText>
            <SshKeyPicker
              keyInfo={key}
              busy={busy}
              onChoose={(action) => chooseKey("target", action)}
              onError={setError}
            />
            <Button
              label={useBastion ? gt("Remove bastion") : gt("Use bastion")}
              disabled={busy}
              onPress={() => setUseBastion(!useBastion)}
            />
            {useBastion ? (
              <View className="gap-4">
                <AppText>
                  <T>Bastion</T>
                </AppText>
                <ConnectionFormField
                  label={gt("Bastion host")}
                  placeholder="user@bastion.example:22"
                  value={bastionHost}
                  onChangeText={setBastionHost}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                />
                <ConnectionFormField
                  label={gt("Bastion username")}
                  value={bastionUsername}
                  onChangeText={setBastionUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                />
                <ConnectionFormField
                  label={gt("Bastion port")}
                  value={bastionPort}
                  onChangeText={setBastionPort}
                  keyboardType="number-pad"
                  editable={!busy}
                />
                <AppText>
                  <T>
                    The target host is reached from the bastion. For a reverse tunnel, use its
                    assigned loopback address and port.
                  </T>
                </AppText>
                <AppText>
                  <T>Bastion SSH key</T>
                </AppText>
                <SshKeyPicker
                  keyInfo={bastionKey}
                  busy={busy}
                  onChoose={(action) => chooseKey("bastion", action)}
                  onError={setError}
                />
                {bastionKey === null && key !== null ? (
                  <Button
                    label={gt("Use target key for bastion")}
                    disabled={busy}
                    onPress={() => void chooseKey("bastion", async () => key)}
                  />
                ) : null}
              </View>
            ) : null}
            <AppText accessibilityLiveRegion="polite" className="text-danger-foreground">
              {error}
            </AppText>
            {error ? (
              <Button
                label={diagnosticsCopied ? gt("Copied diagnostics") : gt("Copy diagnostics")}
                fullWidth
                onPress={() => {
                  const diagnostics =
                    attemptedTarget === null ? "" : sshDiagnosticsText(attemptedTarget);
                  void Clipboard.setStringAsync(
                    diagnostics || "SSH configuration failed before connecting.",
                  )
                    .then(() => setDiagnosticsCopied(true))
                    .catch(() => setError(gt("Could not copy diagnostics. Try again.")));
                }}
              />
            ) : null}
            <Button
              label={gt("Connect")}
              tone="primary"
              loading={busy}
              disabled={key === null || (useBastion && bastionKey === null)}
              fullWidth
              onPress={() => void submit()}
            />
          </View>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
