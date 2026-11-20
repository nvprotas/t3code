import { registerRootComponent } from "expo";
import { AppRegistry, LogBox } from "react-native";

import { installGlobalErrorCapture, startupFailure, withStartupGuard } from "./src/startupGuard";

// App modules load inside try/catch so a load-time crash shows its error instead of a blank screen.
try {
  require("./src/features/development/render-counter-entry");
  require("./src/features/development/behavior-probe-entry");
  // Crash reporting loads preferences, which can load GT and capture Hermes's Intl constructors.
  require("./src/i18n/intl-polyfills");
  // Record errors thrown while the rest of the app loads.
  require("./src/features/observability/observe");
  installGlobalErrorCapture();
  require("react-native-gesture-handler");
  const { featureFlags } = require("react-native-screens");
  const App = require("./src/App").default;
  const { sshNative } = require("./src/connection/ssh/native");

  AppRegistry.registerHeadlessTask(
    "T3SshConnection",
    () =>
      ({ leaseId }: { leaseId: string }) =>
        sshNative?.waitForBackgroundSession(leaseId) ?? Promise.resolve(),
  );

  // Enables iOS FormSheet sizing for nested native stacks in non-fitToContents sheets.
  featureFlags.experiment.synchronousScreenUpdatesEnabled = true;

  if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
    LogBox.ignoreAllLogs();
  }

  registerRootComponent(withStartupGuard(App));
} catch (error) {
  registerRootComponent(startupFailure(error));
}
