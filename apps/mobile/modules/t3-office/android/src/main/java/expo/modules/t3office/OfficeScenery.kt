package expo.modules.t3office

import android.graphics.Color

class Part(
  val w: Float,
  val h: Float,
  val d: Float,
  val x: Float,
  val y: Float,
  val z: Float,
  val color: Int,
  val flat: Boolean = false,
)

/** A piece of furniture drawn as one block; its anchor decides whether walkers pass in front of it. */
class Furniture(val ax: Float, val ay: Float, val az: Float, val parts: List<Part>, val desk: Int = -1)

private fun c(hex: String) = Color.parseColor(hex)

private fun part(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, hex: String) =
  Part(w, h, d, x, y, z, c(hex))

internal object OfficeScenery {
  private const val HW = OfficeWorld.ROOM_WIDTH / 2f
  private const val HD = OfficeWorld.ROOM_DEPTH / 2f
  private val mugs = arrayOf("#ef4444", "#3b82f6", "#f8fafc", "#10b981")

  val screenColors = mapOf(
    "working" to c("#5eead4"),
    "waiting" to c("#fbbf24"),
    "idle" to c("#334155"),
    "disconnected" to c("#1f2937"),
    "empty" to c("#111827"),
  )

  /** Floor, walls and wall decor, drawn first in this order. */
  fun backdrop(): List<Part> {
    val parts = mutableListOf<Part>()
    var x = -HW + 1f
    while (x < HW) {
      var z = -HD + 1f
      while (z < HD) {
        val even = ((x + z + OfficeWorld.ROOM_WIDTH).toInt() % 4) == 0
        parts.add(part(2f, 0.1f, 2f, x, -0.05f, z, if (even) "#d9c4a0" else "#cdb48c"))
        z += 2f
      }
      x += 2f
    }
    parts.add(part(OfficeWorld.ROOM_WIDTH + 0.4f, 3f, 0.2f, 0f, 1.5f, -HD - 0.1f, "#ece6da"))
    parts.add(part(0.2f, 3f, OfficeWorld.ROOM_DEPTH, -HW - 0.1f, 1.5f, 0f, "#e1d9c8"))
    parts.add(part(OfficeWorld.ROOM_WIDTH + 0.4f, 0.16f, 0.05f, 0f, 0.08f, -HD + 0.02f, "#8a6a4a"))
    parts.add(part(0.05f, 0.16f, OfficeWorld.ROOM_DEPTH, -HW + 0.02f, 0.08f, 0f, "#8a6a4a"))
    for (wx in floatArrayOf(-4f, 0f, 4f)) {
      parts.add(part(2.4f, 1.4f, 0.06f, wx, 1.85f, -HD + 0.02f, "#f8fafc"))
      parts.add(part(2.2f, 1.2f, 0.07f, wx, 1.85f, -HD + 0.03f, "#8ecdf2"))
      parts.add(part(0.06f, 1.2f, 0.08f, wx, 1.85f, -HD + 0.04f, "#f8fafc"))
    }
    // Door beside the far lane, then the whiteboard and the lounge rug.
    parts.add(part(0.08f, 2.1f, 1.1f, -HW + 0.03f, 1.05f, -1.25f, "#8a5a2b"))
    parts.add(part(0.06f, 0.08f, 0.08f, -HW + 0.08f, 1f, -0.85f, "#e5c07b"))
    parts.add(part(0.05f, 1.2f, 2.1f, -HW + 0.02f, 1.6f, 2.8f, "#94a3b8"))
    parts.add(part(0.06f, 1.05f, 1.95f, -HW + 0.03f, 1.6f, 2.8f, "#ffffff"))
    parts.add(part(0.07f, 0.05f, 1.2f, -HW + 0.04f, 1.85f, 2.6f, "#3b82f6"))
    parts.add(part(0.07f, 0.05f, 0.8f, -HW + 0.04f, 1.6f, 2.4f, "#ef4444"))
    parts.add(part(0.07f, 0.05f, 1f, -HW + 0.04f, 1.38f, 3f, "#10b981"))
    parts.add(part(4f, 0.02f, 2.2f, -1.6f, 0.01f, 3.7f, "#7c9cbf"))
    return parts
  }

  fun furniture(): List<Furniture> {
    val items = mutableListOf(
      Furniture(
        -1.6f, 0.4f, 4.5f,
        listOf(
          part(2.4f, 0.42f, 0.8f, -1.6f, 0.21f, 4.45f, "#4f6d7a"),
          part(2.4f, 0.5f, 0.2f, -1.6f, 0.67f, 4.8f, "#4f6d7a"),
          part(2.2f, 0.12f, 0.6f, -1.6f, 0.48f, 4.4f, "#628796"),
          part(0.2f, 0.6f, 0.8f, -2.9f, 0.3f, 4.45f, "#44606b"),
          part(0.2f, 0.6f, 0.8f, -0.3f, 0.3f, 4.45f, "#44606b"),
        ),
      ),
      Furniture(
        6.5f, 0.6f, 3.4f,
        listOf(
          part(0.5f, 1f, 0.5f, 6.5f, 0.5f, 3.4f, "#e5e7eb"),
          part(0.36f, 0.45f, 0.36f, 6.5f, 1.23f, 3.4f, "#60a5fa"),
          part(0.08f, 0.06f, 0.1f, 6.22f, 0.8f, 3.4f, "#1f2937"),
        ),
      ),
      Furniture(
        2.6f, 0.5f, 4.5f,
        listOf(
          part(0.1f, 0.7f, 0.1f, 2.6f, 0.35f, 4.5f, "#8a5a2b"),
          part(1f, 0.06f, 0.8f, 2.6f, 0.72f, 4.5f, "#c08a53"),
          part(0.2f, 0.14f, 0.2f, 2.4f, 0.82f, 4.45f, "#ef4444"),
          part(0.16f, 0.16f, 0.16f, 2.75f, 0.83f, 4.55f, "#facc15"),
        ),
      ),
    )
    for ((px, pz) in listOf(-6.4f to 4.4f, 6.4f to -4.4f)) {
      items.add(
        Furniture(
          px, 0.6f, pz,
          listOf(
            part(0.5f, 0.5f, 0.5f, px, 0.25f, pz, "#b45309"),
            part(0.7f, 0.6f, 0.7f, px, 0.8f, pz, "#16a34a"),
            part(0.45f, 0.4f, 0.45f, px + 0.05f, 1.25f, pz - 0.05f, "#22c55e"),
          ),
        ),
      )
    }
    for (index in 0 until OfficeWorld.DESKS) {
      val desk = OfficeWorld.desk(index)
      val seat = OfficeWorld.seat(index)
      val x = desk.x
      val z = desk.z
      items.add(
        Furniture(
          x, 0.74f, z,
          listOf(
            part(0.07f, 0.7f, 0.76f, x - 0.64f, 0.36f, z, "#8a5a2b"),
            part(0.07f, 0.7f, 0.76f, x + 0.64f, 0.36f, z, "#8a5a2b"),
            part(1.4f, 0.07f, 0.8f, x, 0.74f, z, "#c08a53"),
            part(0.3f, 0.02f, 0.18f, x, 0.785f, z - 0.25f, "#4b5263"),
            part(0.08f, 0.22f, 0.08f, x, 0.86f, z - 0.25f, "#4b5263"),
            part(0.72f, 0.44f, 0.05f, x, 1.06f, z - 0.22f, "#1f2430"),
            part(0.5f, 0.03f, 0.16f, x, 0.79f, z + 0.12f, "#e5e7eb"),
            part(0.08f, 0.1f, 0.08f, x + 0.5f, 0.82f, z + 0.05f, mugs[index % 4]),
          ),
          desk = index,
        ),
      )
      items.add(
        Furniture(
          x, 0.4f, seat.z + 0.15f,
          listOf(
            part(0.45f, 0.04f, 0.45f, x, 0.03f, seat.z, "#475569"),
            part(0.07f, 0.36f, 0.07f, x, 0.2f, seat.z, "#475569"),
            part(0.5f, 0.08f, 0.5f, x, 0.42f, seat.z, "#334155"),
            part(0.5f, 0.38f, 0.07f, x, 0.65f, seat.z + 0.27f, "#334155"),
          ),
        ),
      )
    }
    return items
  }

  /** The monitor face, drawn over the desk's monitor frame in the agent's status colour. */
  fun screen(index: Int, color: Int): Part {
    val desk = OfficeWorld.desk(index)
    return Part(0.64f, 0.36f, 0.01f, desk.x, 1.07f, desk.z - 0.19f, color, flat = true)
  }
}
