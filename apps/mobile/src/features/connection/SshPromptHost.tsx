import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import {
  answerSshPrompt,
  useCurrentSshPrompt,
  type SshPrompt,
} from "../../connection/ssh/prompts";
import { ConnectionFormField } from "./ConnectionFormField";

export function SshPromptHost() {
  const prompt = useCurrentSshPrompt();
  return prompt === null ? null : <SshPromptSheet key={prompt.id} prompt={prompt} />;
}

function SshPromptSheet({ prompt }: { readonly prompt: SshPrompt }) {
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
      title={prompt.kind === "host-key" ? "Verify SSH host key" : "Unlock SSH key"}
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
              <AppText>{`Verify the SSH host key for ${prompt.destination}`}</AppText>
              <AppText selectable className="font-mono">
                {prompt.fingerprint}
              </AppText>
              <AppText>
                Compare it with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server.
              </AppText>
            </>
          ) : (
            <>
              <AppText>{`Unlock the SSH key for ${prompt.destination}`}</AppText>
              {prompt.retry ? (
                <AppText accessibilityLiveRegion="polite" className="text-danger-foreground">
                  Wrong passphrase
                </AppText>
              ) : null}
              <ConnectionFormField
                label="Passphrase"
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
            label={prompt.kind === "host-key" ? "Trust" : "Unlock"}
            tone="primary"
            fullWidth
            onPress={() => answer(true)}
          />
          <Button label="Cancel" fullWidth onPress={() => answer(false)} />
        </View>
      </ScreenScrollView>
    </Sheet>
  );
}
