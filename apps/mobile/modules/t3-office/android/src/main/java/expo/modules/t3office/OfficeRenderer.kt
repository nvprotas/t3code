package expo.modules.t3office

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Picture
import java.util.TimeZone
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

private const val WALL_TOP = 3f
private const val FIT_MARGIN = 0.97f
private const val MINI_SCALE = 0.68f

private fun normalized(x: Float, y: Float, z: Float): FloatArray {
  val length = sqrt(x * x + y * y + z * z)
  return floatArrayOf(x / length, y / length, z / length)
}

// Orthographic camera at (11, 12, 13) looking at the target.
private val TO_CAMERA = normalized(11f, 12f, 13f)
private val RIGHT = normalized(13f, 0f, -11f)
private val UP = floatArrayOf(
  RIGHT[1] * -TO_CAMERA[2] - RIGHT[2] * -TO_CAMERA[1],
  RIGHT[2] * -TO_CAMERA[0] - RIGHT[0] * -TO_CAMERA[2],
  RIGHT[0] * -TO_CAMERA[1] - RIGHT[1] * -TO_CAMERA[0],
)
private val LIGHT = normalized(-4f, 10f, 6f)

// Corner index bits are (x, y, z); each face is wound so its normal points outward. No bottom face.
private val FACES = arrayOf(
  intArrayOf(1, 3, 7, 5),
  intArrayOf(0, 4, 6, 2),
  intArrayOf(2, 6, 7, 3),
  intArrayOf(4, 5, 7, 6),
  intArrayOf(1, 0, 2, 3),
)

private val SKIN = Color.parseColor("#f1c9a5")
private val LEGS = Color.parseColor("#334155")
private val EYES = Color.parseColor("#1f2937")
private val OFFLINE = Color.parseColor("#6b7280")
private val ALERT = Color.parseColor("#f97316")
private val RING = Color.parseColor("#facc15")
private val LED_ON = intArrayOf(Color.parseColor("#22c55e"), Color.parseColor("#38bdf8"), Color.parseColor("#f59e0b"))
private val LED_OFF = Color.parseColor("#0b1220")
private val BALL = Color.parseColor("#fff7ed")
private val SKY_DAY = Color.parseColor("#8ecdf2")
private val SKY_NIGHT = Color.parseColor("#0f1d3a")
private val SKY_DUSK = Color.parseColor("#f59e0b")
private val BEACON_DIM = Color.parseColor("#7f1d1d")
private val BEACON_LIT = Color.parseColor("#ef4444")
private val VACUUM = listOf(
  Part(0.5f, 0.1f, 0.5f, 0f, 0.06f, 0f, Color.parseColor("#334155")),
  Part(0.4f, 0.03f, 0.4f, 0f, 0.125f, -0.02f, Color.parseColor("#64748b")),
  Part(0.3f, 0.05f, 0.06f, 0f, 0.08f, 0.25f, Color.parseColor("#0f172a")),
)
private val VACUUM_LED = Part(0.06f, 0.03f, 0.06f, 0f, 0.15f, 0.12f, Color.parseColor("#22c55e"), flat = true)
private const val GONG_RING_TIME = 2.5f

private fun mix(color: Int, other: Int, amount: Float): Int = Color.rgb(
  (Color.red(color) + (Color.red(other) - Color.red(color)) * amount).roundToInt(),
  (Color.green(color) + (Color.green(other) - Color.green(color)) * amount).roundToInt(),
  (Color.blue(color) + (Color.blue(other) - Color.blue(color)) * amount).roundToInt(),
)

private fun shade(color: Int, nx: Float, ny: Float, nz: Float): Int {
  val factor = 0.55f + 0.5f * max(0f, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
  return Color.rgb(
    min(255, (Color.red(color) * factor).roundToInt()),
    min(255, (Color.green(color) * factor).roundToInt()),
    min(255, (Color.blue(color) * factor).roundToInt()),
  )
}

/** Which body part a walker block belongs to; limbs swing about their pivot. */
private enum class Slot { BODY, LEG_LEFT, LEG_RIGHT, ARM_LEFT, ARM_RIGHT }

private enum class Tint { SHIRT, SKIN, HAIR, EYES, LEGS, FIXED }

private class WalkerBlock(val part: Part, val slot: Slot, val tint: Tint)

private fun block(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, slot: Slot, tint: Tint, color: Int = 0) =
  WalkerBlock(Part(w, h, d, x, y, z, color), slot, tint)

private fun prop(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, slot: Slot, hex: String) =
  block(w, h, d, x, y, z, slot, Tint.FIXED, Color.parseColor(hex))

private val BODY_BLOCKS = listOf(
  block(0.42f, 0.45f, 0.25f, 0f, 0.675f, 0f, Slot.BODY, Tint.SHIRT),
  block(0.3f, 0.3f, 0.3f, 0f, 1.06f, 0f, Slot.BODY, Tint.SKIN),
  block(0.32f, 0.09f, 0.32f, 0f, 1.235f, 0f, Slot.BODY, Tint.HAIR),
  block(0.32f, 0.2f, 0.08f, 0f, 1.12f, -0.13f, Slot.BODY, Tint.HAIR),
  block(0.05f, 0.05f, 0.02f, -0.07f, 1.08f, 0.151f, Slot.BODY, Tint.EYES),
  block(0.05f, 0.05f, 0.02f, 0.07f, 1.08f, 0.151f, Slot.BODY, Tint.EYES),
  block(0.14f, 0.45f, 0.14f, -0.1f, 0.225f, 0f, Slot.LEG_LEFT, Tint.LEGS),
  block(0.14f, 0.45f, 0.14f, 0.1f, 0.225f, 0f, Slot.LEG_RIGHT, Tint.LEGS),
  block(0.1f, 0.3f, 0.1f, -0.27f, 0.73f, 0f, Slot.ARM_LEFT, Tint.SHIRT),
  block(0.09f, 0.1f, 0.09f, -0.27f, 0.53f, 0f, Slot.ARM_LEFT, Tint.SKIN),
  block(0.1f, 0.3f, 0.1f, 0.27f, 0.73f, 0f, Slot.ARM_RIGHT, Tint.SHIRT),
  block(0.09f, 0.1f, 0.09f, 0.27f, 0.53f, 0f, Slot.ARM_RIGHT, Tint.SKIN),
)
private val CUP = listOf(prop(0.1f, 0.12f, 0.1f, 0.27f, 0.46f, 0.08f, Slot.ARM_RIGHT, "#f8fafc"))
private val PADDLE = listOf(prop(0.04f, 0.18f, 0.16f, 0.27f, 0.4f, 0.1f, Slot.ARM_RIGHT, "#dc2626"))
private val BOOK = listOf(prop(0.36f, 0.26f, 0.05f, 0f, 0.72f, 0.3f, Slot.BODY, "#7c3aed"))
// A subagent's stool, small table and laptop, carried in its own frame so they sort with it.
private val MINI_DESK = listOf(
  prop(0.4f, 0.4f, 0.4f, 0f, 0.2f, 0f, Slot.BODY, "#475569"),
  prop(0.1f, 0.72f, 0.1f, 0f, 0.36f, 0.62f, Slot.BODY, "#4a2c17"),
  prop(0.8f, 0.06f, 0.45f, 0f, 0.74f, 0.55f, Slot.BODY, "#c08a53"),
  prop(0.42f, 0.03f, 0.28f, 0f, 0.785f, 0.5f, Slot.BODY, "#cbd5e1"),
  prop(0.42f, 0.28f, 0.03f, 0f, 0.93f, 0.66f, Slot.BODY, "#cbd5e1"),
  prop(0.36f, 0.22f, 0.01f, 0f, 0.93f, 0.645f, Slot.BODY, "#5eead4"),
)

private const val ITEM_FURNITURE = 0
private const val ITEM_WALKER = 1
private const val ITEM_MINI = 2
private const val ITEM_BALL = 3
private const val ITEM_VACUUM = 4

private class DrawItem {
  var type = 0
  var index = 0
  var depth = 0f
  var walker: Walker? = null
}

/** Projects the office onto a canvas; furniture is recorded once, walkers are drawn every frame. */
class OfficeRenderer(val width: Int, val height: Int) {
  // The room's corners projected on the screen axes; the scale fits them all into the view.
  private val minU: Float
  private val maxU: Float
  private val minV: Float
  private val maxV: Float
  private val scale: Float

  init {
    var lowU = Float.MAX_VALUE
    var highU = -Float.MAX_VALUE
    var lowV = Float.MAX_VALUE
    var highV = -Float.MAX_VALUE
    val hw = OfficeWorld.ROOM_WIDTH / 2f
    val back = OfficeWorld.BACK_WALL
    val front = back + OfficeWorld.roomDepth
    for (x in floatArrayOf(-hw, hw)) for (y in floatArrayOf(0f, WALL_TOP)) for (z in floatArrayOf(back, front)) {
      val u = x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2]
      val v = x * UP[0] + y * UP[1] + z * UP[2]
      lowU = min(lowU, u)
      highU = max(highU, u)
      lowV = min(lowV, v)
      highV = max(highV, v)
    }
    minU = lowU
    maxU = highU
    minV = lowV
    maxV = highV
    scale = min(width / (maxU - minU), height / (maxV - minV)) * FIT_MARGIN
  }

  /** The room's bounds in unzoomed view coordinates. */
  val roomLeft get() = width / 2f - (maxU - minU) / 2f * scale
  val roomRight get() = width / 2f + (maxU - minU) / 2f * scale
  val roomTop get() = height / 2f - (maxV - minV) / 2f * scale
  val roomBottom get() = height / 2f + (maxV - minV) / 2f * scale

  /** View pixels per world unit at zoom 1. */
  val pixelsPerUnit get() = scale
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val handPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    color = Color.parseColor("#111827")
  }
  private val path = Path()
  private val world = FloatArray(24)
  private val sx = FloatArray(8)
  private val sy = FloatArray(8)

  // Current walker transform, set before drawing its blocks.
  private var wx = 0f
  private var wz = 0f
  private var k = 1f
  private var headingCos = 1f
  private var headingSin = 0f
  private var tiltCos = 1f
  private var tiltSin = 0f
  private var bob = 0f
  private var limbPivot = 0f
  private var limbCos = 1f
  private var limbSin = 0f
  private var hasLimb = false
  private var transformed = false

  private val backdrop: Picture
  private val furniture: List<Furniture> = OfficeScenery.furniture()
  private val furnitureDepths: FloatArray
  private val furniturePictures: List<Picture>
  private val rackLeds = listOf(OfficeScenery.rackLeds(0), OfficeScenery.rackLeds(1))
  private val carpets = List(OfficeWorld.CABINETS) { OfficeScenery.carpet(it) }
  private val signs = List(OfficeWorld.CABINETS) { OfficeScenery.sign(it) }
  private val deskScreens = List(OfficeWorld.DESKS) {
    val desk = OfficeWorld.desk(it)
    OfficeScenery.screen(desk.x, desk.z, 0)
  }
  private val cabinetScreens = List(OfficeWorld.CABINETS) {
    OfficeScenery.screen(OfficeWorld.cabinetX[it], OfficeWorld.CABINET_DESK_Z, 0)
  }
  private val windowPanes = OfficeScenery.windowPanes()
  private val windowBars = OfficeScenery.windowBars()
  private val deskBeacons = List(OfficeWorld.DESKS) {
    val desk = OfficeWorld.desk(it)
    OfficeScenery.beacon(desk.x, desk.z)
  }
  private val cabinetBeacons = List(OfficeWorld.CABINETS) {
    OfficeScenery.beacon(OfficeWorld.cabinetX[it], OfficeWorld.CABINET_DESK_Z)
  }
  private val deskAlarm = BooleanArray(OfficeWorld.DESKS)
  private val podRugs = List(OfficeWorld.PODS) { OfficeScenery.podRug(it) }
  private val pose = Pose()
  private val blocks = ArrayList<WalkerBlock>(24)
  private val blockOrder = IntArray(24)
  private val blockDepth = FloatArray(24)
  private val tmp = FloatArray(3)
  private val zoneOffsetMs = TimeZone.getDefault().getOffset(System.currentTimeMillis()).toLong()
  private val ball = Part(0.08f, 0.08f, 0.08f, 0f, 0f, 0f, BALL, flat = true)

  // Per frame: which agent sits at each desk and office.
  private val deskStatus = arrayOfNulls<String>(OfficeWorld.DESKS)
  private val cabinetOwner = arrayOfNulls<Walker>(OfficeWorld.CABINETS)
  private val items = ArrayList<DrawItem>()
  private var itemCount = 0

  init {
    backdrop = record { canvas -> for (part in OfficeScenery.backdrop()) drawBox(canvas, part) }
    furniturePictures = furniture.map { item -> record { canvas -> for (part in item.parts) drawBox(canvas, part) } }
    furnitureDepths = FloatArray(furniture.size) { depth(furniture[it].ax, furniture[it].ay, furniture[it].az) }
    handPaint.strokeWidth = 0.05f * scale
  }

  private fun record(draw: (Canvas) -> Unit): Picture {
    val picture = Picture()
    val canvas = picture.beginRecording(width, height)
    draw(canvas)
    picture.endRecording()
    return picture
  }

  private fun depth(x: Float, y: Float, z: Float) = x * TO_CAMERA[0] + y * TO_CAMERA[1] + z * TO_CAMERA[2]

  fun projectX(x: Float, y: Float, z: Float): Float =
    width / 2f + (x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2] - (minU + maxU) / 2f) * scale

  fun projectY(x: Float, y: Float, z: Float): Float =
    height / 2f - (x * UP[0] + y * UP[1] + z * UP[2] - (minV + maxV) / 2f) * scale

  /** Applies the current walker transform (scale, limb swing, tilt, bob, heading, position). */
  private fun place(x0: Float, y0: Float, z0: Float, out: FloatArray, o: Int) {
    var x = x0 * k
    var y = y0 * k
    var z = z0 * k
    if (hasLimb) {
      val pivot = limbPivot * k
      val ly = y - pivot
      y = pivot + ly * limbCos - z * limbSin
      z = ly * limbSin + z * limbCos
    }
    val ty = y * tiltCos - z * tiltSin + bob
    val tz = y * tiltSin + z * tiltCos
    out[o] = x * headingCos + tz * headingSin + wx
    out[o + 1] = ty
    out[o + 2] = -x * headingSin + tz * headingCos + wz
  }

  private fun drawBox(canvas: Canvas, part: Part, color: Int = part.color) {
    for (i in 0 until 8) {
      val x = part.x + (if (i and 1 != 0) part.w else -part.w) / 2f
      val y = part.y + (if (i and 2 != 0) part.h else -part.h) / 2f
      val z = part.z + (if (i and 4 != 0) part.d else -part.d) / 2f
      if (transformed) {
        place(x, y, z, world, i * 3)
      } else {
        world[i * 3] = x
        world[i * 3 + 1] = y
        world[i * 3 + 2] = z
      }
      sx[i] = projectX(world[i * 3], world[i * 3 + 1], world[i * 3 + 2])
      sy[i] = projectY(world[i * 3], world[i * 3 + 1], world[i * 3 + 2])
    }
    for (face in FACES) {
      val a = face[0] * 3
      val b = face[1] * 3
      val c = face[2] * 3
      val ux = world[b] - world[a]
      val uy = world[b + 1] - world[a + 1]
      val uz = world[b + 2] - world[a + 2]
      val vx = world[c] - world[a]
      val vy = world[c + 1] - world[a + 1]
      val vz = world[c + 2] - world[a + 2]
      var nx = uy * vz - uz * vy
      var ny = uz * vx - ux * vz
      var nz = ux * vy - uy * vx
      val length = sqrt(nx * nx + ny * ny + nz * nz)
      if (length < 1e-9f) continue
      nx /= length
      ny /= length
      nz /= length
      if (nx * TO_CAMERA[0] + ny * TO_CAMERA[1] + nz * TO_CAMERA[2] <= 0.001f) continue
      paint.color = if (part.flat) color else shade(color, nx, ny, nz)
      path.rewind()
      path.moveTo(sx[face[0]], sy[face[0]])
      path.lineTo(sx[face[1]], sy[face[1]])
      path.lineTo(sx[face[2]], sy[face[2]])
      path.lineTo(sx[face[3]], sy[face[3]])
      path.close()
      canvas.drawPath(path, paint)
    }
  }

  private fun drawDisc(canvas: Canvas, x: Float, z: Float, radius: Float, color: Int, alpha: Int) {
    path.rewind()
    for (i in 0 until 20) {
      val angle = (i / 20.0 * 2 * PI).toFloat()
      val px = projectX(x + cos(angle) * radius, 0.012f, z + sin(angle) * radius)
      val py = projectY(x + cos(angle) * radius, 0.012f, z + sin(angle) * radius)
      if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
    }
    path.close()
    paint.color = color
    paint.alpha = alpha
    canvas.drawPath(path, paint)
    paint.alpha = 255
  }

  private fun setLimb(slot: Slot) {
    hasLimb = slot != Slot.BODY
    val angle = when (slot) {
      Slot.LEG_LEFT -> pose.legLeft
      Slot.LEG_RIGHT -> pose.legRight
      Slot.ARM_LEFT -> pose.armLeft
      Slot.ARM_RIGHT -> pose.armRight
      Slot.BODY -> 0f
    }
    limbPivot = if (slot == Slot.LEG_LEFT || slot == Slot.LEG_RIGHT) 0.45f else 0.88f
    limbCos = cos(angle)
    limbSin = sin(angle)
  }

  /** Draws one character, with whatever it holds, using the pose already in [pose]. */
  private fun drawFigure(canvas: Canvas, x: Float, z: Float, heading: Float, hair: Int, shirt: Int, offline: Boolean) {
    fun tint(color: Int) = if (offline) mix(color, OFFLINE, 0.65f) else color
    wx = x
    wz = z
    headingCos = cos(heading)
    headingSin = sin(heading)
    tiltCos = cos(pose.tilt)
    tiltSin = sin(pose.tilt)
    bob = pose.bob
    transformed = true
    val count = blocks.size
    for (i in 0 until count) {
      val block = blocks[i]
      setLimb(block.slot)
      place(block.part.x, block.part.y, block.part.z, tmp, 0)
      blockDepth[i] = depth(tmp[0], tmp[1], tmp[2])
      blockOrder[i] = i
    }
    // Insertion sort, far to near; there are only a couple of dozen blocks.
    for (i in 1 until count) {
      val current = blockOrder[i]
      var j = i - 1
      while (j >= 0 && blockDepth[blockOrder[j]] > blockDepth[current]) {
        blockOrder[j + 1] = blockOrder[j]
        j--
      }
      blockOrder[j + 1] = current
    }
    for (o in 0 until count) {
      val block = blocks[blockOrder[o]]
      setLimb(block.slot)
      val color = when (block.tint) {
        Tint.SHIRT -> tint(shirt)
        Tint.SKIN -> tint(SKIN)
        Tint.HAIR -> tint(hair)
        Tint.LEGS -> tint(LEGS)
        Tint.EYES -> EYES
        Tint.FIXED -> block.part.color
      }
      drawBox(canvas, block.part, color)
    }
    hasLimb = false
    transformed = false
    k = 1f
  }

  private fun drawWalker(canvas: Canvas, sim: OfficeSim, walker: Walker, selected: Boolean) {
    sim.pose(walker, pose)
    val colors = OfficeWorld.colors(walker.id)
    drawDisc(canvas, walker.px, walker.pz, 0.32f, Color.BLACK, 46)
    if (selected) drawDisc(canvas, walker.px, walker.pz, 0.55f, RING, 150)
    if (walker.status == "waiting") {
      val pulse = (sin(sim.time * 5f) + 1f) / 2f
      drawDisc(canvas, walker.px, walker.pz, 0.45f + pulse * 0.25f, ALERT, (90 + pulse * 90).roundToInt())
    }
    blocks.clear()
    blocks.addAll(BODY_BLOCKS)
    if (!walker.walking && walker.status == "idle") {
      when (walker.activity) {
        Activity.COFFEE -> blocks.addAll(CUP)
        Activity.PINGPONG -> blocks.addAll(PADDLE)
        Activity.READ -> blocks.addAll(BOOK)
        else -> Unit
      }
    }
    k = 1f
    drawFigure(canvas, walker.px, walker.pz, walker.heading, colors[0], colors[1], walker.status == "disconnected")
  }

  private fun drawMini(canvas: Canvas, sim: OfficeSim, owner: Walker, index: Int) {
    val seat = OfficeWorld.miniSeat(owner.cabinet, index)
    val t = sim.time * 18f + index * 1.7f
    pose.legLeft = (-PI / 2).toFloat()
    pose.legRight = (-PI / 2).toFloat()
    pose.armLeft = -1.15f + sin(t) * 0.12f
    pose.armRight = -1.15f + sin(t + PI.toFloat()) * 0.12f
    pose.bob = 0f
    pose.tilt = 0f
    blocks.clear()
    blocks.addAll(BODY_BLOCKS)
    blocks.addAll(MINI_DESK)
    k = MINI_SCALE
    val shirt = OfficeWorld.colors(owner.id)[1]
    drawFigure(canvas, seat.x, seat.z, PI.toFloat(), OfficeWorld.hair(index + 1), mix(shirt, Color.WHITE, 0.35f), false)
  }

  private fun drawBall(canvas: Canvas, time: Float) {
    val u = (sin(time * 2.4f) + 1f) / 2f
    val x = -2.65f + u * 2.3f
    val y = 0.84f + abs(sin(time * 4.8f)) * 0.32f
    drawDisc(canvas, x, 5.4f, 0.05f, Color.BLACK, 40)
    drawBox(canvas, Part(ball.w, ball.h, ball.d, x, y, 5.4f, BALL, true))
  }

  /** Local time of day in hours, 0 to 24. */
  private fun hourOfDay(): Float = (((System.currentTimeMillis() + zoneOffsetMs) / 3600000.0) % 24.0).toFloat()

  /** 0 in daylight, 1 at night, in between at dusk and dawn. */
  fun nightness(): Float {
    val h = hourOfDay()
    return when {
      h < 5f -> 1f
      h < 7f -> 1f - (h - 5f) / 2f
      h < 19f -> 0f
      h < 21.5f -> (h - 19f) / 2.5f
      else -> 1f
    }
  }

  private fun skyColor(night: Float): Int {
    val base = mix(SKY_DAY, SKY_NIGHT, night)
    val dusk = 1f - abs(2f * night - 1f)
    return if (night > 0f && night < 1f) mix(base, SKY_DUSK, dusk * 0.55f) else base
  }

  /** How hard the gong is still ringing, 0 to 1. */
  fun gongRing(sim: OfficeSim): Float {
    val since = sim.time - sim.gongAt
    return if (since < 0f || since > GONG_RING_TIME) 0f else 1f - since / GONG_RING_TIME
  }

  /** Where a pod's sign hangs: over the back fence, on the left. */
  fun podSignX(pod: Int) = projectX(OfficeWorld.podX(pod), 0.75f, OfficeWorld.podBack(pod))

  fun podSignY(pod: Int) = projectY(OfficeWorld.podX(pod), 0.75f, OfficeWorld.podBack(pod))

  fun gongX() = projectX(OfficeWorld.GONG_X, 1.12f, OfficeWorld.GONG_Z)

  fun gongY() = projectY(OfficeWorld.GONG_X, 1.12f, OfficeWorld.GONG_Z)

  private fun drawVacuum(canvas: Canvas, vacuum: Vacuum, time: Float) {
    wx = vacuum.x
    wz = vacuum.z
    headingCos = cos(vacuum.heading)
    headingSin = sin(vacuum.heading)
    tiltCos = 1f
    tiltSin = 0f
    bob = 0f
    k = 1f
    hasLimb = false
    transformed = true
    for (part in VACUUM) drawBox(canvas, part)
    drawBox(canvas, VACUUM_LED, if (vacuum.route.isEmpty() || (time * 2f).toInt() % 2 == 0) VACUUM_LED.color else LED_OFF)
    transformed = false
  }

  private fun drawClock(canvas: Canvas) {
    val now = System.currentTimeMillis() + zoneOffsetMs
    val minutes = (now / 60000.0) % 60.0
    val hours = (now / 3600000.0) % 12.0
    val cx = projectX(OfficeScenery.WALL_X, OfficeScenery.CLOCK_Y, OfficeScenery.CLOCK_Z)
    val cy = projectY(OfficeScenery.WALL_X, OfficeScenery.CLOCK_Y, OfficeScenery.CLOCK_Z)
    for ((angle, length) in listOf(hours / 12.0 * 2 * PI to 0.18f, minutes / 60.0 * 2 * PI to 0.28f)) {
      // On the left wall, facing +x, the clock's right is towards -z.
      val y = OfficeScenery.CLOCK_Y + cos(angle).toFloat() * length
      val z = OfficeScenery.CLOCK_Z - sin(angle).toFloat() * length
      canvas.drawLine(cx, cy, projectX(OfficeScenery.WALL_X, y, z), projectY(OfficeScenery.WALL_X, y, z), handPaint)
    }
  }

  private fun drawRack(canvas: Canvas, rack: Int, time: Float) {
    val tick = (time * 3f).toInt()
    for ((i, led) in rackLeds[rack].withIndex()) {
      val hash = ((i + rack * 31) * 2654435761L + tick * 40503L * (i % 5 + 1)) ushr 7
      val on = (hash % 3L) != 0L
      drawBox(canvas, led, if (on) LED_ON[i % LED_ON.size] else LED_OFF)
    }
  }

  private fun addItem(type: Int, index: Int, depth: Float, walker: Walker? = null) {
    if (itemCount == items.size) items.add(DrawItem())
    val item = items[itemCount++]
    item.type = type
    item.index = index
    item.depth = depth
    item.walker = walker
  }

  /** Draws the scene in world projection; the caller applies zoom and pan to the canvas. */
  fun draw(canvas: Canvas, sim: OfficeSim, selectedId: String) {
    canvas.drawPicture(backdrop)
    val sky = skyColor(nightness())
    for (i in windowPanes.indices) {
      drawBox(canvas, windowPanes[i], sky)
      drawBox(canvas, windowBars[i])
    }
    for (pod in 0 until OfficeWorld.PODS) {
      val team = sim.podTeam[pod] ?: continue
      drawBox(canvas, podRugs[pod], mix(OfficeScenery.carpet, OfficeWorld.colors(team)[1], 0.45f))
    }
    deskStatus.fill(null)
    deskAlarm.fill(false)
    cabinetOwner.fill(null)
    itemCount = 0
    for (walker in sim.walkers.values) {
      if (walker.leaving) {
        // Its desk is already empty.
      } else if (walker.cabinet >= 0) {
        cabinetOwner[walker.cabinet] = walker
        deskStatus[walker.desk] = "idle"
      } else {
        deskStatus[walker.desk] = if (walker.activity == Activity.SLEEP) "idle" else walker.status
        deskAlarm[walker.desk] = walker.alarm
      }
      addItem(ITEM_WALKER, 0, depth(walker.px, 0.3f, walker.pz), walker)
    }
    for (cabinet in 0 until OfficeWorld.CABINETS) {
      val owner = cabinetOwner[cabinet]
      if (owner == null) {
        drawBox(canvas, carpets[cabinet])
        drawBox(canvas, signs[cabinet])
        continue
      }
      val shirt = OfficeWorld.colors(owner.id)[1]
      drawBox(canvas, carpets[cabinet], mix(OfficeScenery.carpet, shirt, 0.35f))
      drawBox(canvas, signs[cabinet], shirt)
      if (!owner.arrived) continue
      for (i in 0 until min(owner.subagents, OfficeWorld.MINIS_PER_CABINET)) {
        val seat = OfficeWorld.miniSeat(cabinet, i)
        addItem(ITEM_MINI, i, depth(seat.x, 0.3f, seat.z), owner)
      }
    }
    drawClock(canvas)
    for (i in furniture.indices) addItem(ITEM_FURNITURE, i, furnitureDepths[i])
    if (sim.pingPongPlayers() >= 2) addItem(ITEM_BALL, 0, depth(-1.5f, 0.9f, 5.4f))
    addItem(ITEM_VACUUM, 0, depth(sim.vacuum.x, 0.1f, sim.vacuum.z))
    items.subList(0, itemCount).sortBy { it.depth }
    for (n in 0 until itemCount) {
      val item = items[n]
      when (item.type) {
        ITEM_FURNITURE -> drawFurniture(canvas, item.index, sim)
        ITEM_WALKER -> item.walker?.let { drawWalker(canvas, sim, it, it.id == selectedId) }
        ITEM_MINI -> item.walker?.let { drawMini(canvas, sim, it, item.index) }
        ITEM_BALL -> drawBall(canvas, sim.time)
        ITEM_VACUUM -> drawVacuum(canvas, sim.vacuum, sim.time)
      }
    }
  }

  private fun drawFurniture(canvas: Canvas, index: Int, sim: OfficeSim) {
    canvas.drawPicture(furniturePictures[index])
    val item = furniture[index]
    when (item.kind) {
      Kind.DESK -> {
        val color = OfficeScenery.screenColors[deskStatus[item.index] ?: "empty"] ?: Color.BLACK
        drawBox(canvas, deskScreens[item.index], color)
        if (deskAlarm[item.index]) drawBox(canvas, deskBeacons[item.index], beaconColor(sim.time))
      }
      Kind.CABINET_DESK -> {
        val owner = cabinetOwner[item.index]
        drawBox(canvas, cabinetScreens[item.index], OfficeScenery.screenColors[owner?.status ?: "empty"] ?: Color.BLACK)
        if (owner?.alarm == true) drawBox(canvas, cabinetBeacons[item.index], beaconColor(sim.time))
      }
      Kind.RACK -> drawRack(canvas, item.index, sim.time)
      Kind.GONG -> {
        val ring = gongRing(sim)
        drawBox(canvas, OfficeScenery.gongDisc(sin(sim.time * 40f) * 0.05f * ring))
      }
      Kind.PLAIN -> Unit
    }
  }

  private fun beaconColor(time: Float) = mix(BEACON_DIM, BEACON_LIT, (sin(time * 8f) + 1f) / 2f)

  /** The agent under a point in unzoomed view coordinates. */
  fun pick(sim: OfficeSim, x: Float, y: Float, radius: Float): String? {
    var best: String? = null
    var bestDistance = max(radius, 0.45f * scale)
    for (walker in sim.walkers.values) {
      val dx = projectX(walker.px, 0.7f, walker.pz) - x
      val dy = projectY(walker.px, 0.7f, walker.pz) - y
      val distance = sqrt(dx * dx + dy * dy)
      if (distance < bestDistance) {
        bestDistance = distance
        best = walker.id
      }
    }
    return best
  }
}
