package expo.modules.t3office

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Picture
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

private const val HALF_WIDTH = 8.9f
private const val TARGET_X = 0f
private const val TARGET_Y = 0.6f
private const val TARGET_Z = 0.5f

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
private val ALERT = Color.parseColor("#fbbf24")
private val RING = Color.parseColor("#facc15")

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

private enum class Tint { SHIRT, SKIN, HAIR, EYES, LEGS }

private class WalkerBlock(val part: Part, val slot: Slot, val tint: Tint)

private fun block(w: Float, h: Float, d: Float, x: Float, y: Float, z: Float, slot: Slot, tint: Tint) =
  WalkerBlock(Part(w, h, d, x, y, z, 0), slot, tint)

private val WALKER_BLOCKS = arrayOf(
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
private val ALERT_TOP = Part(0.11f, 0.26f, 0.11f, 0f, 0f, 0f, ALERT, flat = true)
private val ALERT_DOT = Part(0.11f, 0.1f, 0.11f, 0f, 0f, 0f, ALERT, flat = true)

/** Projects the office onto a canvas; furniture is recorded once, walkers are drawn every frame. */
class OfficeRenderer(val width: Int, val height: Int) {
  private val scale = width / (2f * HALF_WIDTH)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val path = Path()
  private val world = FloatArray(24)
  private val sx = FloatArray(8)
  private val sy = FloatArray(8)

  // Current walker transform, set before drawing its blocks.
  private var wx = 0f
  private var wz = 0f
  private var headingCos = 1f
  private var headingSin = 0f
  private var tiltCos = 1f
  private var tiltSin = 0f
  private var bob = 0f
  private var limbPivot = 0f
  private var limbCos = 1f
  private var limbSin = 0f
  private var spinCos = 1f
  private var spinSin = 0f
  private var hasLimb = false
  private var hasSpin = false
  private var transformed = false

  private val backdrop: Picture
  private val furniture: List<Furniture> = OfficeScenery.furniture()
  private val furnitureDepths: FloatArray
  private val furniturePictures: List<Picture>
  private val pose = Pose()
  private val blockOrder = IntArray(WALKER_BLOCKS.size)
  private val blockDepth = FloatArray(WALKER_BLOCKS.size)
  private val tmp = FloatArray(3)

  init {
    backdrop = record { canvas -> for (part in OfficeScenery.backdrop()) drawBox(canvas, part) }
    furniturePictures = furniture.map { item -> record { canvas -> for (part in item.parts) drawBox(canvas, part) } }
    furnitureDepths = FloatArray(furniture.size) { depth(furniture[it].ax, furniture[it].ay, furniture[it].az) }
  }

  private fun record(draw: (Canvas) -> Unit): Picture {
    val picture = Picture()
    val canvas = picture.beginRecording(width, height)
    draw(canvas)
    picture.endRecording()
    return picture
  }

  private fun depth(x: Float, y: Float, z: Float) = x * TO_CAMERA[0] + y * TO_CAMERA[1] + z * TO_CAMERA[2]

  fun projectX(x: Float, y: Float, z: Float): Float {
    val dx = x - TARGET_X
    val dy = y - TARGET_Y
    val dz = z - TARGET_Z
    return width / 2f + (dx * RIGHT[0] + dy * RIGHT[1] + dz * RIGHT[2]) * scale
  }

  fun projectY(x: Float, y: Float, z: Float): Float {
    val dx = x - TARGET_X
    val dy = y - TARGET_Y
    val dz = z - TARGET_Z
    return height / 2f - (dx * UP[0] + dy * UP[1] + dz * UP[2]) * scale
  }

  /** Applies the current walker transform (limb swing, alert spin, tilt, bob, heading, position). */
  private fun place(x0: Float, y0: Float, z0: Float, out: FloatArray, o: Int) {
    var x = x0
    var y = y0
    var z = z0
    if (hasLimb) {
      val ly = y - limbPivot
      y = limbPivot + ly * limbCos - z * limbSin
      z = ly * limbSin + z * limbCos
    }
    if (hasSpin) {
      val rx = x * spinCos + z * spinSin
      z = -x * spinSin + z * spinCos
      x = rx
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

  private fun drawWalker(canvas: Canvas, sim: OfficeSim, walker: Walker, selected: Boolean) {
    sim.pose(walker, pose)
    val (hair, shirt) = OfficeWorld.colors(walker.id).let { it[0] to it[1] }
    val offline = walker.status == "disconnected"
    fun tint(color: Int) = if (offline) mix(color, OFFLINE, 0.65f) else color

    drawDisc(canvas, walker.px, walker.pz, 0.32f, Color.BLACK, 46)
    if (selected) drawDisc(canvas, walker.px, walker.pz, 0.55f, RING, 140)

    wx = walker.px
    wz = walker.pz
    headingCos = cos(walker.heading)
    headingSin = sin(walker.heading)
    tiltCos = cos(pose.tilt)
    tiltSin = sin(pose.tilt)
    bob = pose.bob
    hasSpin = false
    transformed = true

    for (i in WALKER_BLOCKS.indices) {
      val block = WALKER_BLOCKS[i]
      setLimb(block.slot)
      place(block.part.x, block.part.y, block.part.z, tmp, 0)
      blockDepth[i] = depth(tmp[0], tmp[1], tmp[2])
      blockOrder[i] = i
    }
    // Insertion sort, far to near; there are only a dozen blocks.
    for (i in 1 until blockOrder.size) {
      val current = blockOrder[i]
      var j = i - 1
      while (j >= 0 && blockDepth[blockOrder[j]] > blockDepth[current]) {
        blockOrder[j + 1] = blockOrder[j]
        j--
      }
      blockOrder[j + 1] = current
    }
    for (index in blockOrder) {
      val block = WALKER_BLOCKS[index]
      setLimb(block.slot)
      val color = when (block.tint) {
        Tint.SHIRT -> tint(shirt)
        Tint.SKIN -> tint(SKIN)
        Tint.HAIR -> tint(hair)
        Tint.LEGS -> tint(LEGS)
        Tint.EYES -> EYES
      }
      drawBox(canvas, block.part, color)
    }
    if (walker.status == "waiting") {
      hasLimb = false
      hasSpin = true
      spinCos = cos(pose.alertSpin)
      spinSin = sin(pose.alertSpin)
      drawBox(canvas, Part(ALERT_TOP.w, ALERT_TOP.h, ALERT_TOP.d, 0f, pose.alertY + 0.06f, 0f, ALERT, true))
      drawBox(canvas, Part(ALERT_DOT.w, ALERT_DOT.h, ALERT_DOT.d, 0f, pose.alertY - 0.18f, 0f, ALERT, true))
      hasSpin = false
    }
    hasLimb = false
    transformed = false
  }

  private val drawOrder = ArrayList<Any>()
  private val drawDepth = HashMap<Any, Float>()

  /** Draws the scene in world projection; the caller applies zoom and pan to the canvas. */
  fun draw(canvas: Canvas, sim: OfficeSim, selectedId: String) {
    canvas.drawPicture(backdrop)
    val statuses = HashMap<Int, String>()
    drawOrder.clear()
    drawDepth.clear()
    for (i in furniture.indices) {
      drawOrder.add(i)
      drawDepth[i] = furnitureDepths[i]
    }
    for (walker in sim.walkers.values) {
      statuses[walker.desk] = walker.status
      drawOrder.add(walker)
      drawDepth[walker] = depth(walker.px, 0.3f, walker.pz)
    }
    drawOrder.sortBy { drawDepth[it] ?: 0f }
    for (item in drawOrder) {
      if (item is Int) {
        canvas.drawPicture(furniturePictures[item])
        val desk = furniture[item].desk
        if (desk >= 0) {
          val color = OfficeScenery.screenColors[statuses[desk] ?: "empty"] ?: Color.BLACK
          drawBox(canvas, OfficeScenery.screen(desk, color))
        }
      } else if (item is Walker) {
        drawWalker(canvas, sim, item, item.id == selectedId)
      }
    }
  }

  /** The agent under a point in unzoomed view coordinates. */
  fun pick(sim: OfficeSim, x: Float, y: Float): String? {
    var best: String? = null
    var bestDistance = 0.11f * width
    for (walker in sim.walkers.values) {
      val dx = projectX(walker.px, 0.8f, walker.pz) - x
      val dy = projectY(walker.px, 0.8f, walker.pz) - y
      val distance = sqrt(dx * dx + dy * dy)
      if (distance < bestDistance) {
        bestDistance = distance
        best = walker.id
      }
    }
    return best
  }
}
