import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { relativeTime } from "../../lib/time";
import type { OfficeStatus } from "./officeStatus";

interface OfficeAgentThread {
  readonly title: string;
  readonly updatedAt: string;
  readonly runtime: {
    readonly providerName: string | null;
    readonly lastError: string | null;
  } | null;
}

/** The tapped agent, laid over the bottom of the scene so it stays under the thumb. */
export function OfficeAgentCard(props: {
  readonly thread: OfficeAgentThread;
  readonly status: OfficeStatus;
  readonly name: string;
  readonly environment: string;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** Queues a message to the thread; it reaches the agent like one sent from the chat. */
  readonly onSend: (text: string) => Promise<void>;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setFailed(false);
    const sent = await props.onSend(text).then(
      () => true,
      () => false,
    );
    setSending(false);
    if (sent) setDraft("");
    else setFailed(true);
  };
  const { thread } = props;
  const status =
    props.status === "working"
      ? gt("Working", { $context: "agent status" })
      : props.status === "waiting"
        ? gt("Waiting for you")
        : props.status === "disconnected"
          ? gt("Disconnected")
          : gt("Idle");
  const details = [
    props.name,
    status,
    thread.runtime?.providerName,
    gt("{time} ago", { time: relativeTime(thread.updatedAt) }),
    props.environment,
  ].filter(Boolean);
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3">
      <View className="gap-0.5">
        <Text className="font-t3-bold text-foreground" numberOfLines={2}>
          {thread.title}
        </Text>
        <Text textRole="caption" className="text-foreground-muted" numberOfLines={1}>
          {details.join(" · ")}
        </Text>
      </View>
      {thread.runtime?.lastError ? (
        <Text textRole="caption" className="text-danger-foreground" numberOfLines={2}>
          {thread.runtime.lastError}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-2">
        <AppTextInput
          className="min-h-11 flex-1 py-2"
          value={draft}
          onChangeText={setDraft}
          placeholder={gt("Message {name}", { name: props.name })}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => void send()}
          editable={!sending}
        />
        <Button
          label={gt("Send", { $context: "verb, sends the message" })}
          onPress={() => void send()}
          tone="primary"
          size="compact"
        />
      </View>
      {failed ? (
        <Text textRole="caption" className="text-danger-foreground">
          {gt("The message was not sent. Try again.")}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button label={gt("Open thread")} onPress={props.onOpen} size="compact" />
        <Button label={gt("Close")} onPress={props.onClose} size="compact" />
      </View>
    </View>
  );
}
