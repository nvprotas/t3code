package expo.modules.t3office

import android.graphics.Color
import kotlin.math.PI
import kotlin.math.abs

class FloorPoint(val x: Float, val z: Float)

enum class Activity { NONE, COFFEE, ARCADE, READ, PINGPONG, COUCH, CHAT, WANDER, SLEEP, GONG }

/** A place in the lounge where an idle agent does something; `lane` is the lane it is reached from. */
class Spot(val x: Float, val z: Float, val heading: Float, val activity: Activity, val lane: Int = -1)

private val HALF_PI = (PI / 2).toFloat()
private val PI_F = PI.toFloat()

/** Floor plan of the office, in world units on the floor plane (x right, z towards the viewer). */
internal object OfficeWorld {
  const val ROOM_WIDTH = 20f
  const val BACK_WALL = -7f
  private const val BASE_DEPTH = 14f
  private val columns = floatArrayOf(-6f, -3.6f, -1.2f, 1.2f, 3.6f, 6f)
  private val deskRows = floatArrayOf(-1.2f, 2f)
  private const val SEAT_OFFSET = 0.85f

  // The open plan grows by one row of three pods (twelve desks) whenever projects need more room.
  const val MAX_ROWS = 6
  const val PODS_PER_ROW = 3
  const val DESKS_PER_ROW = 12
  const val MAX_PODS = MAX_ROWS * PODS_PER_ROW
  const val MAX_DESKS = MAX_ROWS * DESKS_PER_ROW
  const val ROW_PITCH = 6.4f
  /** Furniture at or beyond this depth (in a one-row office) belongs to the lounge, which moves back with each new row. */
  const val LOUNGE_START = 4f

  var rows = 1
    private set
  val PODS get() = rows * PODS_PER_ROW
  val DESKS get() = rows * DESKS_PER_ROW
  val shift get() = (rows - 1) * ROW_PITCH
  val roomDepth get() = BASE_DEPTH + shift

  // Walkers move only along these lanes and the corridor, so they never cut through furniture.
  var lanes = buildLanes(1)
    private set
  const val CORRIDOR_X = -7.6f

  private fun buildLanes(rows: Int): FloatArray {
    val result = FloatArray(rows * 2 + 2)
    result[0] = -2.8f
    for (row in 0 until rows) {
      result[1 + row * 2] = 0.75f + row * ROW_PITCH
      result[2 + row * 2] = 3.9f + row * ROW_PITCH
    }
    result[result.size - 1] = 6.5f + (rows - 1) * ROW_PITCH
    return result
  }

  // Whether a pod shares its right-hand fence's place with the next pod: one project over several pods.
  private var joins = BooleanArray(MAX_PODS)

  fun joinedRight(pod: Int) = joins.getOrElse(pod) { false }

  fun joinedLeft(pod: Int) = pod % PODS_PER_ROW > 0 && joinedRight(pod - 1)

  fun setJoins(next: BooleanArray): Boolean {
    if (next.contentEquals(joins)) return false
    joins = next
    return true
  }

  /** Resizes the open plan; returns whether the layout changed. */
  fun setRows(count: Int): Boolean {
    val next = count.coerceIn(1, MAX_ROWS)
    if (next == rows) return false
    rows = next
    lanes = buildLanes(next)
    spots = buildSpots(shift)
    return true
  }

  // Private offices along the back wall, lent to a thread while it runs subagents.
  const val CABINETS = 4
  val cabinetX = floatArrayOf(-5.7f, -1.9f, 1.9f, 5.7f)
  const val CABINET_WIDTH = 3.8f
  const val CABINET_FRONT = -3.8f
  const val CABINET_DESK_Z = -6.2f
  const val MINIS_PER_CABINET = 4

  val door = FloorPoint(-9.6f, -2.8f)

  // A gong facing the room, rung by whoever just got a pull request merged.
  const val GONG_X = 9.2f
  const val GONG_Z = -1.9f
  val gongSpot = FloorPoint(GONG_X, GONG_Z + 0.85f)

  // The robot vacuum's dock, and the floor it cleans.
  val dock = FloorPoint(9.4f, 3.1f)

  /** A random point on a lane, where the vacuum heads next. */
  fun randomFloorPoint(random: kotlin.random.Random): FloorPoint =
    FloorPoint(-7.2f + random.nextFloat() * 16f, lanes[random.nextInt(lanes.size)])

  var spots = buildSpots(0f)
    private set

  private fun buildSpots(dz: Float) = listOf(
    Spot(5.0f, 5.35f + dz, PI_F, Activity.COFFEE),
    Spot(6.2f, 5.35f + dz, PI_F, Activity.COFFEE),
    Spot(8.0f, 5.35f + dz, PI_F, Activity.ARCADE),
    Spot(9.0f, 5.35f + dz, PI_F, Activity.ARCADE),
    Spot(2.2f, 5.35f + dz, PI_F, Activity.READ),
    Spot(3.0f, 5.35f + dz, PI_F, Activity.READ),
    Spot(-3.0f, 5.4f + dz, HALF_PI, Activity.PINGPONG),
    Spot(0f, 5.4f + dz, -HALF_PI, Activity.PINGPONG),
    Spot(-6.45f, 4.6f + dz, 0f, Activity.COUCH, lane = lanes.size - 1),
    Spot(-5.55f, 4.6f + dz, 0f, Activity.COUCH, lane = lanes.size - 1),
    Spot(-9.3f, 1.6f, HALF_PI, Activity.CHAT),
    Spot(-8.5f, 1.6f, -HALF_PI, Activity.CHAT),
  )
  const val PING_PONG_LEFT = 6
  const val PING_PONG_RIGHT = 7

  // Each row's desks split into fenced pods of four, each lent to one project.
  const val DESKS_PER_POD = 4
  val podPositions = floatArrayOf(-4.8f, 0f, 4.8f)
  const val POD_HALF_WIDTH = 2.25f
  private const val POD_BACK_OFFSET = -1.95f
  private const val POD_FRONT_OFFSET = 3.35f

  fun podX(pod: Int) = podPositions[pod % PODS_PER_ROW]
  private fun rowShift(pod: Int) = (pod / PODS_PER_ROW) * ROW_PITCH
  fun podBack(pod: Int) = POD_BACK_OFFSET + rowShift(pod)
  fun podFront(pod: Int) = POD_FRONT_OFFSET + rowShift(pod)
  /** The lane that runs between a pod's two rows of desks. */
  fun podMiddleLane(pod: Int) = lanes[1 + (pod / PODS_PER_ROW) * 2]

  fun podOf(desk: Int) = (desk / DESKS_PER_ROW) * PODS_PER_ROW + (desk % columns.size) / 2

  fun podDesks(pod: Int): IntArray {
    val base = (pod / PODS_PER_ROW) * DESKS_PER_ROW + (pod % PODS_PER_ROW) * 2
    return intArrayOf(base, base + 1, base + columns.size, base + columns.size + 1)
  }

  fun desk(index: Int): FloorPoint {
    val local = index % DESKS_PER_ROW
    return FloorPoint(columns[local % columns.size], deskRows[local / columns.size] + (index / DESKS_PER_ROW) * ROW_PITCH)
  }

  fun seat(index: Int): FloorPoint {
    val desk = desk(index)
    return FloorPoint(desk.x, desk.z + SEAT_OFFSET)
  }

  /** Behind the chair, so the waiting agent stays inside its pod's fence. */
  fun deskWaitSpot(index: Int): FloorPoint {
    val seat = seat(index)
    return FloorPoint(seat.x + 0.35f, seat.z + 0.75f)
  }

  fun cabinetSeat(cabinet: Int) = FloorPoint(cabinetX[cabinet], CABINET_DESK_Z + SEAT_OFFSET)

  fun cabinetWaitSpot(cabinet: Int) = FloorPoint(cabinetX[cabinet], -4.5f)

  /** Where the subagents of a cabinet sit, at small laptop tables beside the lead's desk. */
  fun miniSeat(cabinet: Int, index: Int): FloorPoint {
    val side = if (index % 2 == 0) -1.3f else 1.3f
    val z = if (index < 2) -4.55f else -5.95f
    return FloorPoint(cabinetX[cabinet] + side, z)
  }

  fun nearestLane(point: FloorPoint): Int {
    var best = 0
    for (i in lanes.indices) if (abs(lanes[i] - point.z) < abs(lanes[best] - point.z)) best = i
    return best
  }

  /** Path from one floor point to another along the lanes; lanes of -1 mean the nearest one. */
  fun route(from: FloorPoint, to: FloorPoint, fromLane: Int = -1, toLane: Int = -1): MutableList<FloorPoint> {
    val result = mutableListOf<FloorPoint>()
    if (abs(to.x - from.x) + abs(to.z - from.z) < 1e-3f) return result
    val start = if (fromLane >= 0) fromLane else nearestLane(from)
    val end = if (toLane >= 0) toLane else nearestLane(to)
    val points = mutableListOf(FloorPoint(from.x, lanes[start]))
    if (start != end) {
      points.add(FloorPoint(CORRIDOR_X, lanes[start]))
      points.add(FloorPoint(CORRIDOR_X, lanes[end]))
    }
    points.add(FloorPoint(to.x, lanes[end]))
    points.add(to)
    var lastX = from.x
    var lastZ = from.z
    for (point in points) {
      if (abs(point.x - lastX) + abs(point.z - lastZ) < 1e-3f) continue
      result.add(point)
      lastX = point.x
      lastZ = point.z
    }
    return result
  }

  private val hairColors = intArrayOf(
    Color.parseColor("#3b2417"),
    Color.parseColor("#111827"),
    Color.parseColor("#a16207"),
    Color.parseColor("#7c2d12"),
    Color.parseColor("#d6d3d1"),
    Color.parseColor("#b45309"),
  )
  private val shirtColors = intArrayOf(
    Color.parseColor("#3b82f6"),
    Color.parseColor("#ef4444"),
    Color.parseColor("#10b981"),
    Color.parseColor("#a855f7"),
    Color.parseColor("#f97316"),
    Color.parseColor("#14b8a6"),
    Color.parseColor("#ec4899"),
    Color.parseColor("#eab308"),
  )

  /** Same FNV-1a hash as the JS list, so the dot next to a thread matches its shirt. */
  fun colors(id: String): IntArray {
    var hash = 0x811c9dc5L.toInt()
    for (char in id) {
      hash = hash xor char.code
      hash *= 0x01000193
    }
    val unsigned = hash.toLong() and 0xffffffffL
    return intArrayOf(
      hairColors[(unsigned % hairColors.size).toInt()],
      shirtColors[((unsigned ushr 8) % shirtColors.size).toInt()],
    )
  }

  /** A badge colour for the model provider running a thread. */
  fun providerColor(provider: String): Int {
    val id = provider.lowercase()
    return when {
      id.isEmpty() -> Color.TRANSPARENT
      id.contains("codex") || id.contains("openai") -> Color.parseColor("#10a37f")
      id.contains("claude") -> Color.parseColor("#d97757")
      id.contains("cursor") -> Color.parseColor("#3b82f6")
      id.contains("opencode") -> Color.parseColor("#a855f7")
      id.contains("grok") -> Color.parseColor("#e5e7eb")
      id.contains("gemini") || id.contains("antigravity") -> Color.parseColor("#38bdf8")
      else -> shirtColors[((colors(id)[1].toLong() and 0xffffffffL) % shirtColors.size).toInt()]
    }
  }

  fun hair(index: Int) = hairColors[index % hairColors.size]

  fun shirt(index: Int) = shirtColors[index % shirtColors.size]
}
