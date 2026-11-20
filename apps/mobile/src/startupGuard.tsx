import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";

// Deliberately outside gt(): this screen must work when the i18n stack itself fails to load.
const TITLE = "T3 Code hit an error";
const SHARE = "Share log";
const DISMISS = "Dismiss";

const errors: string[] = [];
const listeners = new Set<() => void>();

export function recordStartupError(error: unknown, label: string) {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error);
  errors.push(`[${new Date().toISOString()}] ${label}\n${text}`);
  for (const listener of listeners) listener();
}

/** Chains the app's own global handler, so fatal JS errors are shown on screen instead of leaving a blank view. */
export function installGlobalErrorCapture() {
  const utils = (
    globalThis as {
      ErrorUtils?: {
        getGlobalHandler(): (e: unknown, fatal?: boolean) => void;
        setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void;
      };
    }
  ).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    recordStartupError(error, fatal ? "fatal JS error" : "JS error");
    previous?.(error, fatal);
  });
}

function ErrorScreen(props: {
  readonly reports: readonly string[];
  readonly onDismiss?: () => void;
}) {
  const text = props.reports.join("\n\n");
  return (
    <View style={{ flex: 1, backgroundColor: "#1b1b1b", paddingTop: 56, padding: 16, gap: 12 }}>
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>{TITLE}</Text>
      <ScrollView style={{ flex: 1 }}>
        <Text selectable style={{ color: "#fca5a5", fontSize: 12, fontFamily: "monospace" }}>
          {text.slice(0, 20000)}
        </Text>
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable
          onPress={() => void Share.share({ message: text })}
          style={{ backgroundColor: "#3b82f6", padding: 12, borderRadius: 10 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{SHARE}</Text>
        </Pressable>
        {props.onDismiss ? (
          <Pressable
            onPress={props.onDismiss}
            style={{ backgroundColor: "#374151", padding: 12, borderRadius: 10 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{DISMISS}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

class RootBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    recordStartupError(error, `render error\n${info.componentStack ?? ""}`);
  }
  override render() {
    return this.state.failed ? <ErrorScreen reports={errors} /> : this.props.children;
  }
}

/** Shows captured errors over the app and keeps render crashes from blanking the screen. */
export function withStartupGuard(App: ComponentType): ComponentType {
  return function GuardedApp() {
    const [, bump] = useState(0);
    const [dismissed, setDismissed] = useState(0);
    // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module-level error log
    useEffect(() => {
      const listener = () => bump((n) => n + 1);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }, []);
    if (errors.length > dismissed) {
      return <ErrorScreen reports={errors} onDismiss={() => setDismissed(errors.length)} />;
    }
    return (
      <RootBoundary>
        <App />
      </RootBoundary>
    );
  };
}

export function startupFailure(error: unknown): ComponentType {
  recordStartupError(error, "startup failure while loading modules");
  return function StartupFailure() {
    return <ErrorScreen reports={errors} />;
  };
}
