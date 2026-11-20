import { useGT } from "gt-react-native";
import { View } from "react-native";

import type { RenderFailureProps } from "../../components/RenderErrorBoundary";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";

/** Shows why the 3D office failed in full, since release builds have no other way to see it. */
export function OfficeSceneFailure(props: RenderFailureProps) {
  const gt = useGT();
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <Text className="font-t3-bold text-foreground">{gt("The 3D office couldn't start")}</Text>
      <Text selectable className="font-mono text-xs text-danger-foreground">
        {props.details.slice(0, 2000)}
      </Text>
      <View className="flex-row gap-2">
        <Button label={gt("Try again")} onPress={props.retry} tone="primary" />
        <Button
          label={gt("Copy details")}
          onPress={() => copyTextWithHaptic(props.details, { target: "error details" })}
        />
      </View>
    </View>
  );
}
