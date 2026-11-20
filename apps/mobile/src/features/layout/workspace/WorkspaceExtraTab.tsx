import type { PageTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { OfficeScreen } from "../../office/OfficeScreen";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";

export function WorkspaceExtraTab(props: { tab: PageTab }) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "office" ? <OfficeScreen /> : <UsageRouteScreen workspace />}
    </>
  );
}
