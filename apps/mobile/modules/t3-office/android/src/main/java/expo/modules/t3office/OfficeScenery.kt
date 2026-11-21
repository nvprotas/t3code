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

enum class Kind { PLAIN, DESK, CABINET_DESK, RACK, GONG }

/** A piece of furniture drawn as one block; its anchor decides whether walkers pass in front of it. */
class Furniture(
  val ax: Float,
  val ay: Float,
  val az: Float,
  val parts: List<Part>,
  val kind: Kind = Kind.PLAIN,
  val index: Int = -1,
)

private fun c(hex: String) = Color.parseColor(hex)

private fun part(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, hex: String) =
  Part(w, h, d, x, y, z, c(hex))

private fun flat(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, hex: String) =
  Part(w, h, d, x, y, z, c(hex), flat = true)

internal object OfficeScenery {
  private const val HW = OfficeWorld.ROOM_WIDTH / 2f
  private const val HD = OfficeWorld.ROOM_DEPTH / 2f
  private val mugs = arrayOf("#ef4444", "#3b82f6", "#f8fafc", "#10b981")
  private val bookColors = arrayOf("#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#f8fafc", "#0ea5e9", "#e11d48")

  const val CLOCK_Z = 3.0f
  const val CLOCK_Y = 2.2f
  const val WALL_X = -HW + 0.04f

  val screenColors = mapOf(
    "working" to c("#5eead4"),
    "waiting" to c("#fb923c"),
    "idle" to c("#334155"),
    "disconnected" to c("#1f2937"),
    "empty" to c("#111827"),
  )
  val carpet = c("#55627a")
  val signOff = c("#374151")

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
    // A window behind every office, plus posters in the corners.
    for (wx in OfficeWorld.cabinetX) {
      parts.add(flat(2.2f, 1.2f, 0.06f, wx, 1.75f, -HD + 0.02f, "#f8fafc"))
      parts.add(flat(2.0f, 1.0f, 0.07f, wx, 1.75f, -HD + 0.03f, "#8ecdf2"))
      parts.add(flat(0.06f, 1.0f, 0.08f, wx, 1.75f, -HD + 0.04f, "#f8fafc"))
    }
    parts.add(flat(0.9f, 0.6f, 0.05f, -8.9f, 2.45f, -HD + 0.02f, "#1e293b"))
    parts.add(flat(0.7f, 0.42f, 0.06f, -8.9f, 2.45f, -HD + 0.03f, "#f59e0b"))
    parts.add(flat(0.9f, 1.2f, 0.05f, 8.8f, 2.1f, -HD + 0.02f, "#0f172a"))
    parts.add(flat(0.7f, 0.5f, 0.06f, 8.8f, 2.3f, -HD + 0.03f, "#22d3ee"))
    parts.add(flat(0.7f, 0.3f, 0.06f, 8.8f, 1.8f, -HD + 0.03f, "#a855f7"))
    // Left wall: door, whiteboard, clock face and a big T3 sign over the couch.
    parts.add(part(0.08f, 2.1f, 1.1f, -HW + 0.03f, 1.05f, OfficeWorld.door.z, "#8a5a2b"))
    parts.add(part(0.06f, 0.08f, 0.08f, -HW + 0.08f, 1f, OfficeWorld.door.z + 0.4f, "#e5c07b"))
    parts.add(part(0.05f, 1.2f, 2.1f, -HW + 0.02f, 1.6f, -0.9f, "#94a3b8"))
    parts.add(flat(0.06f, 1.05f, 1.95f, -HW + 0.03f, 1.6f, -0.9f, "#ffffff"))
    parts.add(flat(0.07f, 0.05f, 1.2f, -HW + 0.04f, 1.85f, -1.1f, "#3b82f6"))
    parts.add(flat(0.07f, 0.05f, 0.8f, -HW + 0.04f, 1.6f, -1.3f, "#ef4444"))
    parts.add(flat(0.07f, 0.05f, 1f, -HW + 0.04f, 1.38f, -0.7f, "#10b981"))
    parts.add(flat(0.05f, 0.8f, 0.8f, -HW + 0.02f, CLOCK_Y, CLOCK_Z, "#1f2937"))
    parts.add(flat(0.06f, 0.7f, 0.7f, -HW + 0.03f, CLOCK_Y, CLOCK_Z, "#f8fafc"))
    parts.add(flat(0.05f, 1.0f, 1.8f, -HW + 0.02f, 2.0f, 5.4f, "#111827"))
    parts.add(flat(0.06f, 0.6f, 0.12f, -HW + 0.03f, 2.0f, 4.95f, "#f472b6"))
    parts.add(flat(0.06f, 0.12f, 0.5f, -HW + 0.03f, 2.24f, 5.25f, "#22d3ee"))
    parts.add(flat(0.06f, 0.6f, 0.12f, -HW + 0.03f, 2.0f, 5.25f, "#22d3ee"))
    parts.add(flat(0.06f, 0.12f, 0.36f, -HW + 0.03f, 2.24f, 5.7f, "#22d3ee"))
    parts.add(flat(0.06f, 0.12f, 0.36f, -HW + 0.03f, 2.0f, 5.7f, "#22d3ee"))
    parts.add(flat(0.06f, 0.12f, 0.36f, -HW + 0.03f, 1.76f, 5.7f, "#22d3ee"))
    parts.add(flat(0.06f, 0.6f, 0.1f, -HW + 0.03f, 2.0f, 5.86f, "#22d3ee"))
    // Rugs in the lounge.
    parts.add(flat(2.8f, 0.02f, 1.8f, -6f, 0.01f, 5.1f, "#7c9cbf"))
    parts.add(flat(3.6f, 0.02f, 2.2f, -1.5f, 0.01f, 5.4f, "#9a7b5c"))
    return parts
  }

  private fun plant(px: Float, pz: Float, big: Boolean = false): Furniture {
    val k = if (big) 1.4f else 1f
    return Furniture(
      px, 0.6f * k, pz,
      listOf(
        part(0.5f * k, 0.5f * k, 0.5f * k, px, 0.25f * k, pz, "#b45309"),
        part(0.7f * k, 0.6f * k, 0.7f * k, px, 0.8f * k, pz, "#16a34a"),
        part(0.45f * k, 0.4f * k, 0.45f * k, px + 0.05f, 1.25f * k, pz - 0.05f, "#22c55e"),
      ),
    )
  }

  private fun desk(x: Float, z: Float, index: Int, kind: Kind, wide: Boolean): Furniture {
    val w = if (wide) 1.8f else 1.4f
    val top = if (wide) "#6b4226" else "#c08a53"
    val leg = if (wide) "#4a2c17" else "#8a5a2b"
    val parts = mutableListOf(
      part(0.07f, 0.7f, 0.76f, x - w / 2f + 0.06f, 0.36f, z, leg),
      part(0.07f, 0.7f, 0.76f, x + w / 2f - 0.06f, 0.36f, z, leg),
      part(w, 0.07f, 0.8f, x, 0.74f, z, top),
      part(0.3f, 0.02f, 0.18f, x, 0.785f, z - 0.25f, "#4b5263"),
      part(0.08f, 0.22f, 0.08f, x, 0.86f, z - 0.25f, "#4b5263"),
      part(0.72f, 0.44f, 0.05f, x, 1.06f, z - 0.22f, "#1f2430"),
      part(0.5f, 0.03f, 0.16f, x, 0.79f, z + 0.12f, "#e5e7eb"),
    )
    when (if (wide) 4 else index % 4) {
      0 -> parts.add(part(0.08f, 0.1f, 0.08f, x + 0.5f, 0.82f, z + 0.05f, mugs[index % 4]))
      1 -> {
        parts.add(part(0.12f, 0.12f, 0.12f, x - 0.52f, 0.83f, z - 0.1f, "#b45309"))
        parts.add(part(0.16f, 0.14f, 0.16f, x - 0.52f, 0.95f, z - 0.1f, "#22c55e"))
      }
      2 -> {
        parts.add(part(0.26f, 0.05f, 0.2f, x + 0.5f, 0.8f, z - 0.05f, "#3b82f6"))
        parts.add(part(0.24f, 0.05f, 0.18f, x + 0.5f, 0.85f, z - 0.05f, "#f59e0b"))
      }
      3 -> {
        parts.add(part(0.05f, 0.3f, 0.05f, x - 0.55f, 0.92f, z - 0.2f, "#475569"))
        parts.add(part(0.18f, 0.08f, 0.18f, x - 0.5f, 1.08f, z - 0.15f, "#fde68a"))
      }
      else -> {
        parts.add(part(0.08f, 0.1f, 0.08f, x + 0.65f, 0.82f, z + 0.05f, "#f8fafc"))
        parts.add(part(0.14f, 0.12f, 0.14f, x - 0.7f, 0.84f, z - 0.15f, "#b45309"))
        parts.add(part(0.2f, 0.18f, 0.2f, x - 0.7f, 0.99f, z - 0.15f, "#16a34a"))
      }
    }
    return Furniture(x, 0.74f, z, parts, kind, index)
  }

  private fun chair(x: Float, z: Float, hex: String = "#334155") = Furniture(
    x, 0.4f, z + 0.15f,
    listOf(
      part(0.45f, 0.04f, 0.45f, x, 0.03f, z, "#475569"),
      part(0.07f, 0.36f, 0.07f, x, 0.2f, z, "#475569"),
      part(0.5f, 0.08f, 0.5f, x, 0.42f, z, hex),
      part(0.5f, 0.38f, 0.07f, x, 0.65f, z + 0.27f, hex),
    ),
  )

  private fun cabinets(items: MutableList<Furniture>) {
    val wall = "#9fb7c9"
    val trim = "#475569"
    val front = OfficeWorld.CABINET_FRONT
    val half = OfficeWorld.CABINET_WIDTH / 2f
    for (cabinet in 0 until OfficeWorld.CABINETS) {
      val cx = OfficeWorld.cabinetX[cabinet]
      for (side in floatArrayOf(-1f, 1f)) {
        val sx = cx + side * (half + 0.5f) / 2f
        items.add(
          Furniture(
            sx, 0.4f, front,
            listOf(
              part(half - 0.5f, 0.8f, 0.08f, sx, 0.4f, front, wall),
              part(half - 0.5f, 0.06f, 0.12f, sx, 0.83f, front, trim),
              part(0.1f, 2.2f, 0.1f, cx + side * 0.5f, 1.1f, front, trim),
            ),
          ),
        )
      }
      items.add(desk(cx, OfficeWorld.CABINET_DESK_Z, cabinet, Kind.CABINET_DESK, wide = true))
      items.add(chair(cx, OfficeWorld.CABINET_DESK_Z + 0.85f, "#7f1d1d"))
    }
    var bx = -OfficeWorld.CABINET_WIDTH * 2f
    while (bx <= OfficeWorld.CABINET_WIDTH * 2f + 0.01f) {
      for (zc in floatArrayOf(-6.2f, -4.6f)) {
        items.add(
          Furniture(
            bx, 0.4f, zc,
            listOf(
              part(0.08f, 0.8f, 1.6f, bx, 0.4f, zc, wall),
              part(0.12f, 0.06f, 1.6f, bx, 0.83f, zc, trim),
            ),
          ),
        )
      }
      bx += OfficeWorld.CABINET_WIDTH
    }
  }

  fun furniture(): List<Furniture> {
    val items = mutableListOf<Furniture>()
    cabinets(items)
    // Couch facing the room, with a floor lamp.
    items.add(
      Furniture(
        -6f, 0.4f, 4.3f,
        listOf(
          part(2.0f, 0.36f, 0.7f, -6f, 0.18f, 4.45f, "#4f6d7a"),
          part(2.0f, 0.55f, 0.18f, -6f, 0.63f, 4.15f, "#4f6d7a"),
          part(1.8f, 0.1f, 0.55f, -6f, 0.41f, 4.5f, "#628796"),
          part(0.18f, 0.6f, 0.7f, -7.05f, 0.3f, 4.45f, "#44606b"),
          part(0.18f, 0.6f, 0.7f, -4.95f, 0.3f, 4.45f, "#44606b"),
        ),
      ),
    )
    items.add(
      Furniture(
        -4.55f, 0.8f, 4.25f,
        listOf(
          part(0.3f, 0.04f, 0.3f, -4.55f, 0.02f, 4.25f, "#1f2937"),
          part(0.05f, 1.5f, 0.05f, -4.55f, 0.77f, 4.25f, "#1f2937"),
          part(0.36f, 0.26f, 0.36f, -4.55f, 1.6f, 4.25f, "#fde68a"),
        ),
      ),
    )
    // Ping-pong table.
    items.add(
      Furniture(
        -1.5f, 0.76f, 5.4f,
        listOf(
          part(0.1f, 0.72f, 0.1f, -2.4f, 0.36f, 5.4f, "#1f2937"),
          part(0.1f, 0.72f, 0.1f, -0.6f, 0.36f, 5.4f, "#1f2937"),
          part(2.4f, 0.06f, 1.3f, -1.5f, 0.76f, 5.4f, "#1e7a4a"),
          flat(2.3f, 0.005f, 0.03f, -1.5f, 0.792f, 5.4f, "#f8fafc"),
          part(0.03f, 0.15f, 1.36f, -1.5f, 0.865f, 5.4f, "#e5e7eb"),
        ),
      ),
    )
    // Bookshelf.
    val shelf = mutableListOf(
      part(1.6f, 1.3f, 0.4f, 2.6f, 0.65f, 4.55f, "#6b4226"),
      part(1.5f, 0.04f, 0.3f, 2.6f, 0.48f, 4.66f, "#4a2c17"),
      part(1.5f, 0.04f, 0.3f, 2.6f, 0.9f, 4.66f, "#4a2c17"),
    )
    for (row in 0 until 3) {
      for (i in 0 until 7) {
        val bxk = 2.0f + i * 0.2f
        val h = 0.26f + ((i * 7 + row * 3) % 4) * 0.025f
        shelf.add(part(0.13f, h, 0.06f, bxk, 0.08f + row * 0.42f + h / 2f, 4.78f, bookColors[(i + row * 3) % bookColors.size]))
      }
    }
    items.add(Furniture(2.6f, 0.65f, 4.75f, shelf))
    // Coffee bar.
    items.add(
      Furniture(
        5.6f, 0.6f, 4.75f,
        listOf(
          part(2.4f, 0.9f, 0.6f, 5.6f, 0.45f, 4.6f, "#94a3b8"),
          part(2.5f, 0.06f, 0.66f, 5.6f, 0.93f, 4.6f, "#e2e8f0"),
          part(0.45f, 0.55f, 0.4f, 5.0f, 1.235f, 4.55f, "#111827"),
          part(0.3f, 0.12f, 0.06f, 5.0f, 1.3f, 4.77f, "#ef4444"),
          part(0.1f, 0.12f, 0.1f, 5.9f, 1.02f, 4.6f, "#f8fafc"),
          part(0.1f, 0.12f, 0.1f, 6.1f, 1.02f, 4.5f, "#3b82f6"),
          part(0.36f, 0.24f, 0.3f, 6.6f, 1.08f, 4.55f, "#b45309"),
        ),
      ),
    )
    // Arcade machines.
    for ((ax, screen) in listOf(8.0f to "#22d3ee", 9.0f to "#e879f9")) {
      items.add(
        Furniture(
          ax, 0.7f, 4.8f,
          listOf(
            part(0.7f, 1.35f, 0.6f, ax, 0.675f, 4.6f, "#312e81"),
            part(0.72f, 0.2f, 0.62f, ax, 1.45f, 4.6f, screen),
            flat(0.5f, 0.38f, 0.02f, ax, 1.08f, 4.91f, screen),
            part(0.62f, 0.08f, 0.26f, ax, 0.86f, 5.0f, "#1e1b4b"),
            part(0.06f, 0.08f, 0.06f, ax - 0.12f, 0.93f, 5.0f, "#ef4444"),
            part(0.06f, 0.05f, 0.06f, ax + 0.12f, 0.92f, 5.0f, "#facc15"),
          ),
        ),
      )
    }
    // Water cooler by the chat corner.
    items.add(
      Furniture(
        -9.65f, 0.6f, 0.6f,
        listOf(
          part(0.38f, 0.95f, 0.38f, -9.65f, 0.475f, 0.6f, "#f1f5f9"),
          part(0.3f, 0.42f, 0.3f, -9.65f, 1.16f, 0.6f, "#7dd3fc"),
        ),
      ),
    )
    // Server racks and vending machine in the back corners.
    for ((index, rx) in listOf(-9.35f, -8.55f).withIndex()) {
      items.add(
        Furniture(
          rx, 0.9f, -6.1f,
          listOf(part(0.72f, 1.9f, 0.8f, rx, 0.95f, -6.5f, "#1f2937"), flat(0.6f, 1.7f, 0.01f, rx, 0.95f, -6.095f, "#111827")),
          Kind.RACK,
          index,
        ),
      )
    }
    items.add(
      Furniture(
        8.7f, 0.9f, -6.1f,
        listOf(
          part(1.0f, 1.85f, 0.7f, 8.7f, 0.925f, -6.5f, "#dc2626"),
          flat(0.6f, 1.3f, 0.01f, 8.55f, 1.05f, -6.145f, "#bae6fd"),
          flat(0.18f, 0.5f, 0.01f, 9.05f, 1.2f, -6.145f, "#1f2937"),
        ),
      ),
    )
    items.add(
      Furniture(
        9.3f, 0.5f, -4.3f,
        listOf(
          part(0.7f, 0.75f, 0.6f, 9.3f, 0.375f, -4.3f, "#e5e7eb"),
          part(0.6f, 0.2f, 0.5f, 9.3f, 0.85f, -4.3f, "#9ca3af"),
          part(0.4f, 0.02f, 0.3f, 9.3f, 0.96f, -4.25f, "#f8fafc"),
        ),
      ),
    )
    // The gong: a frame facing the room; its disc is drawn per frame so it can shake.
    val gx = OfficeWorld.GONG_X
    val gz = OfficeWorld.GONG_Z
    items.add(
      Furniture(
        gx, 0.9f, gz,
        listOf(
          part(1.5f, 0.06f, 0.3f, gx, 0.03f, gz, "#3f2a1a"),
          part(0.08f, 1.9f, 0.08f, gx - 0.68f, 0.95f, gz, "#6b4226"),
          part(0.08f, 1.9f, 0.08f, gx + 0.68f, 0.95f, gz, "#6b4226"),
          part(1.5f, 0.1f, 0.1f, gx, 1.9f, gz, "#6b4226"),
          part(0.02f, 0.25f, 0.02f, gx, 1.75f, gz, "#1f2937"),
        ),
        Kind.GONG,
      ),
    )
    items.add(plant(-9.4f, -4.4f, big = true))
    items.add(plant(8.3f, -1.2f))
    items.add(plant(8.3f, 2.0f))
    items.add(plant(-9.4f, 6.4f, big = true))
    items.add(plant(9.4f, 6.4f))
    for (index in 0 until OfficeWorld.DESKS) {
      val place = OfficeWorld.desk(index)
      items.add(desk(place.x, place.z, index, Kind.DESK, wide = false))
      items.add(chair(place.x, OfficeWorld.seat(index).z))
    }
    return items
  }

  /** The monitor face, drawn over a desk's monitor frame in the agent's status colour. */
  fun screen(x: Float, z: Float, color: Int) = Part(0.64f, 0.36f, 0.01f, x, 1.07f, z - 0.19f, color, flat = true)

  fun carpet(cabinet: Int) =
    Part(OfficeWorld.CABINET_WIDTH - 0.1f, 0.02f, 3.1f, OfficeWorld.cabinetX[cabinet], 0.012f, -5.4f, carpet, flat = true)

  fun sign(cabinet: Int) = Part(1.6f, 0.3f, 0.03f, OfficeWorld.cabinetX[cabinet], 2.72f, -HD + 0.04f, signOff, flat = true)

  /** The gong's disc, moved sideways by `swing` while it rings. */
  fun gongDisc(swing: Float) =
    Part(0.95f, 0.95f, 0.06f, OfficeWorld.GONG_X + swing, 1.12f, OfficeWorld.GONG_Z + 0.02f, c("#d4a017"))

  /** The glass of each window, drawn per frame in the colour of the sky outside. */
  fun windowPanes(): List<Part> = OfficeWorld.cabinetX.map { wx ->
    Part(2.0f, 1.0f, 0.07f, wx, 1.75f, -HD + 0.035f, Color.BLACK, flat = true)
  }

  fun windowBars(): List<Part> = OfficeWorld.cabinetX.map { wx ->
    Part(0.06f, 1.0f, 0.08f, wx, 1.75f, -HD + 0.045f, c("#f8fafc"), flat = true)
  }

  /** A warning light on top of a monitor, lit while the agent's last run or CI failed. */
  fun beacon(x: Float, z: Float) = Part(0.14f, 0.12f, 0.14f, x, 1.34f, z - 0.22f, Color.RED)

  /** Status lights on the front of a server rack. */
  fun rackLeds(rack: Int): List<Part> {
    val rx = if (rack == 0) -9.35f else -8.55f
    val leds = mutableListOf<Part>()
    for (row in 0 until 6) {
      for (column in 0 until 3) {
        leds.add(Part(0.08f, 0.06f, 0.01f, rx - 0.18f + column * 0.18f, 0.35f + row * 0.26f, -6.085f, Color.BLACK, flat = true))
      }
    }
    return leds
  }
}
