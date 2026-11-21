package expo.modules.t3office

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3OfficeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3Office")

    View(T3OfficeView::class) {
      Prop("agentsJson") { view: T3OfficeView, json: String -> view.setAgentsJson(json) }
      Prop("selectedId") { view: T3OfficeView, id: String -> view.setSelectedId(id) }
      Prop("active") { view: T3OfficeView, active: Boolean -> view.setActive(active) }
      Prop("focusRequest") { view: T3OfficeView, request: String -> view.setFocusRequest(request) }
      Events("onSelectAgent", "onRendered")
      OnViewDestroys { view: T3OfficeView -> view.cleanup() }
    }
  }
}
