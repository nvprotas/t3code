import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  buildOfficeSnapshot,
  type OfficeSceneEnvironment,
  type OfficeSceneTarget,
  type OfficeSceneThread,
} from "./officeSnapshot";

/** Built from vendor/t3-office and copied into the APK's assets by the Android SSH workflow. */
const SCENE_URI = "file:///android_asset/office/index.html";

function readSceneMessage(data: string): { type: "ready" } | { type: "open"; id: string } | null {
  try {
    const message: unknown = JSON.parse(data);
    if (typeof message !== "object" || message === null || !("type" in message)) return null;
    if (message.type === "ready") return { type: "ready" };
    if (message.type === "open" && "id" in message && typeof message.id === "string") {
      return { type: "open", id: message.id };
    }
    return null;
  } catch {
    return null;
  }
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the OS app state so the hidden scene stops rendering
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
}

export function OfficeScene(props: {
  readonly environments: ReadonlyArray<OfficeSceneEnvironment>;
  readonly threads: ReadonlyArray<OfficeSceneThread>;
  readonly projects: Parameters<typeof buildOfficeSnapshot>[0]["projects"];
  readonly offlineLabel: string;
  readonly visible: boolean;
  readonly onOpenThread: (target: OfficeSceneTarget) => void;
  readonly onFailed: () => void;
}) {
  const view = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const appActive = useAppActive();
  const { environments, threads, projects, offlineLabel } = props;
  const { targets, json } = useMemo(() => {
    const built = buildOfficeSnapshot({
      environments,
      threads,
      projects,
      now: Date.now(),
      offlineLabel,
    });
    return { targets: built.targets, json: JSON.stringify(built.snapshot) };
  }, [environments, threads, projects, offlineLabel]);
  const paused = !(props.visible && appActive);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes thread snapshots into the WebView scene once it has loaded
  useEffect(() => {
    if (!ready) return;
    view.current?.injectJavaScript(`window.__t3office&&window.__t3office.push(${json});true;`);
  }, [ready, json]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops the scene's render loop while its tab or the app is hidden
  useEffect(() => {
    if (!ready) return;
    view.current?.injectJavaScript(`window.__t3office&&window.__t3office.pause(${paused});true;`);
  }, [ready, paused]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = readSceneMessage(event.nativeEvent.data);
    if (message?.type === "ready") setReady(true);
    if (message?.type === "open") {
      const target = targets.get(message.id);
      if (target) props.onOpenThread(target);
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: "#1d2024" }}>
      <WebView
        ref={view}
        source={{ uri: SCENE_URI }}
        originWhitelist={["file://*"]}
        onShouldStartLoadWithRequest={(request) => request.url.startsWith(SCENE_URI)}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction
        allowsFullscreenVideo={false}
        overScrollMode="never"
        onMessage={onMessage}
        onLoadStart={() => setReady(false)}
        onError={props.onFailed}
        onHttpError={props.onFailed}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
