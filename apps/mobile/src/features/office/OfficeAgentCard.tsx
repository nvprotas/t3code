import { useGT } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { relativeTime } from "../../lib/time";
import type { OfficeStatus } from "./officeStatus";

interface OfficeAgentThread {
  readonly title: string;
  readonly branch: string | null;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runtime: {
    readonly providerName: string | null;
    readonly lastError: string | null;
  } | null;
  readonly pendingBackgroundTasks: readonly unknown[];
}

function Stat(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="min-w-0 flex-1 gap-0.5">
      <Text textRole="caption" className="text-foreground-muted">
        {props.label}
      </Text>
      <Text className="font-t3-bold text-foreground" numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

/** What the tapped agent is doing, in the spirit of the T3 office stats. */
export function OfficeAgentCard(props: {
  readonly thread: OfficeAgentThread;
  readonly status: OfficeStatus;
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
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <View className="gap-0.5">
        <Text className="font-t3-bold text-foreground" numberOfLines={2}>
          {thread.title}
        </Text>
        <Text textRole="caption" className="text-foreground-muted" numberOfLines={1}>
          {props.environment}
        </Text>
      </View>
      <View className="flex-row gap-3">
        <Stat label={gt("Status")} value={status} />
        <Stat label={gt("Provider")} value={thread.runtime?.providerName ?? gt("Unknown")} />
      </View>
      <View className="flex-row gap-3">
        <Stat label={gt("Items")} value={String(thread.itemCount)} />
        <Stat
          label={gt("Last activity")}
          value={gt("{time} ago", { time: relativeTime(thread.updatedAt) })}
        />
      </View>
      <View className="flex-row gap-3">
        <Stat
          label={gt("Started")}
          value={gt("{time} ago", { time: relativeTime(thread.createdAt) })}
        />
        <Stat label={gt("Background tasks")} value={String(thread.pendingBackgroundTasks.length)} />
      </View>
      {thread.branch ? <Stat label={gt("Branch")} value={thread.branch} /> : null}
      {thread.runtime?.lastError ? (
        <Text textRole="caption" className="text-danger-foreground" numberOfLines={3}>
          {thread.runtime.lastError}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button label={gt("Open thread")} onPress={props.onOpen} tone="primary" />
        <Button label={gt("Close")} onPress={props.onClose} />
      </View>
    </View>
  );
}
