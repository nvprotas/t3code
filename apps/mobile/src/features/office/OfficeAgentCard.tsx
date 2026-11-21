import { useGT } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
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
}) {
  const gt = useGT();
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
      <View className="flex-row gap-2">
        <Button label={gt("Open thread")} onPress={props.onOpen} tone="primary" size="compact" />
        <Button label={gt("Close")} onPress={props.onClose} size="compact" />
      </View>
    </View>
  );
}
