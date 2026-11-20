package expo.modules.t3office

import android.graphics.Color
import kotlin.math.abs

class FloorPoint(val x: Float, val z: Float)

/** Floor plan of the office, in world units on the floor plane (x right, z towards the viewer). */
internal object OfficeWorld {
  const val ROOM_WIDTH = 14f
  const val ROOM_DEPTH = 10f
  const val DESKS = 12
  private val columns = floatArrayOf(-5f, -3f, -1f, 1f, 3f, 5f)
  private val rows = floatArrayOf(-3f, 0f)
  private const val SEAT_OFFSET = 0.85f
  // Walkers move only along these lanes and the corridor, so they never cut through a desk.
  private val lanes = floatArrayOf(-1.25f, 2f)
  private const val CORRIDOR_X = -6.3f

  val lounge = listOf(
    FloorPoint(5.9f, 3.4f),
    FloorPoint(-1.6f, 3.6f),
    FloorPoint(-5.6f, 3.2f),
    FloorPoint(2.6f, 3.8f),
  )
  val door = FloorPoint(-6.8f, -1.25f)

  fun desk(index: Int) = FloorPoint(columns[index % columns.size], rows[(index / columns.size) % rows.size])

  fun seat(index: Int): FloorPoint {
    val desk = desk(index)
    return FloorPoint(desk.x, desk.z + SEAT_OFFSET)
  }

  private fun lane(point: FloorPoint) = if (point.z < -0.5f) 0 else 1

  fun route(from: FloorPoint, to: FloorPoint): MutableList<FloorPoint> {
    val result = mutableListOf<FloorPoint>()
    if (abs(to.x - from.x) + abs(to.z - from.z) < 1e-3f) return result
    val start = lane(from)
    val end = lane(to)
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
}
