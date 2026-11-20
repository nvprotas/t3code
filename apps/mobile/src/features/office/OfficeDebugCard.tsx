import { useGT } from "gt-react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";

/** Shows the saved 3D trail; it is the only log a release build keeps across a crash. */
export function OfficeDebugCard(props: {
  readonly log: string;
  readonly crashed: boolean;
  readonly onStart: () => void;
}) {
  const gt = useGT();
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <Text className="font-t3-bold text-foreground">
        {props.crashed ? gt("The 3D office stopped last time") : gt("3D office log")}
      </Text>
      <Text selectable className="font-mono text-xs text-foreground-muted">
        {props.log || gt("Empty")}
      </Text>
      <View className="flex-row gap-2">
        <Button label={gt("Start 3D")} onPress={props.onStart} tone="primary" />
        <Button
          label={gt("Copy log")}
          onPress={() => copyTextWithHaptic(props.log, { target: "debug log" })}
        />
      </View>
    </View>
  );
}
