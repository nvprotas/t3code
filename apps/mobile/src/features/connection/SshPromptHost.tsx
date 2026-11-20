import { T, useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { answerSshPrompt, useCurrentSshPrompt, type SshPrompt } from "../../connection/ssh/prompts";
import { ConnectionFormField } from "./ConnectionFormField";

export function SshPromptHost() {
  const prompt = useCurrentSshPrompt();
  return prompt === null ? null : <SshPromptSheet key={prompt.id} prompt={prompt} />;
}

function SshPromptSheet({ prompt }: { readonly prompt: SshPrompt }) {
  const gt = useGT();
  const [passphrase, setPassphrase] = useState("");
  const answer = (accept: boolean) => {
    answerSshPrompt(prompt.id, {
      accept,
      ...(accept && prompt.kind === "passphrase" ? { passphrase } : {}),
    });
    setPassphrase("");
  };

  return (
    <Sheet
      title={prompt.kind === "host-key" ? gt("Verify SSH host key") : gt("Unlock SSH key")}
      onClose={() => answer(false)}
    >
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20 }}
      >
        <View className="gap-4">
          {prompt.kind === "host-key" ? (
            <>
              <AppText>
                {gt("Verify the SSH host key for {destination}", {
                  destination: prompt.destination,
                })}
              </AppText>
              <AppText selectable className="font-mono">
                {prompt.fingerprint}
              </AppText>
              <AppText>
                {gt("Compare it with {command} on the server.", {
                  command: "`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`",
                })}
              </AppText>
            </>
          ) : (
            <>
              <AppText>
                {gt("Unlock the SSH key for {destination}", { destination: prompt.destination })}
              </AppText>
              {prompt.retry ? (
                <AppText accessibilityLiveRegion="polite" className="text-danger-foreground">
                  <T>Wrong passphrase</T>
                </AppText>
              ) : null}
              <ConnectionFormField
                label={gt("Passphrase")}
                secureTextEntry
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                value={passphrase}
                onChangeText={setPassphrase}
                returnKeyType="go"
                onSubmitEditing={() => answer(true)}
              />
            </>
          )}
          <Button
            label={prompt.kind === "host-key" ? gt("Trust") : gt("Unlock")}
            tone="primary"
            fullWidth
            onPress={() => answer(true)}
          />
          <Button label={gt("Cancel")} fullWidth onPress={() => answer(false)} />
        </View>
      </ScreenScrollView>
    </Sheet>
  );
}
