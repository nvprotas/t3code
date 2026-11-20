package expo.modules.t3office

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

class OfficeAgent(val id: String, val name: String, val status: String)

class Walker(val id: String, var name: String, var status: String, var desk: Int, var x: Float, var z: Float) {
  val phase = Random.nextFloat() * 10f
  var heading = PI.toFloat()
  var route: MutableList<FloorPoint> = mutableListOf()
  var pause = Random.nextFloat() * 3f
  var walking = false
  var seated = false
  // Sidestep that keeps walkers from meeting head-on; the drawn position is (px, pz).
  var offX = 0f
  var offZ = 0f
  var waited = 0f
  var px = x
  var pz = z
}

class Pose {
  var legLeft = 0f
  var legRight = 0f
  var armLeft = 0f
  var armRight = 0f
  var bob = 0f
  var tilt = 0f
  var alertY = 0f
  var alertSpin = 0f
}

private const val WALK_SPEED = 1.5f
private val FACING_DESK = PI.toFloat()
// Turned towards the camera, so a waiting agent waves at you.
private val FACING_VIEWER = atan2(11.0, 13.0).toFloat()
// Everyone steps to the same hand, so two walkers on one lane pass instead of colliding.
private const val SIDESTEP = 0.34f
private const val LOOK_AHEAD = 1.1f
private const val PERSONAL_SPACE = 0.5f
private const val MAX_WAIT = 1.5f

/** Who is where in the office; rendering reads it every frame. */
class OfficeSim {
  val walkers = LinkedHashMap<String, Walker>()
  private var clock = 0f
  private var populated = false

  private fun retarget(walker: Walker) {
    val seat = OfficeWorld.seat(walker.desk)
    val goal = when (walker.status) {
      "idle" -> {
        val spot = OfficeWorld.lounge[Random.nextInt(OfficeWorld.lounge.size)]
        FloorPoint(spot.x + (Random.nextFloat() - 0.5f) * 0.8f, spot.z + (Random.nextFloat() - 0.5f) * 0.4f)
      }
      "waiting" -> FloorPoint(seat.x + 1f, seat.z)
      else -> seat
    }
    walker.route = OfficeWorld.route(FloorPoint(walker.x, walker.z), goal)
  }

  fun setAgents(agents: List<OfficeAgent>) {
    val next = LinkedHashMap<String, OfficeAgent>()
    for (agent in agents.take(OfficeWorld.DESKS)) next[agent.id] = agent
    walkers.keys.retainAll(next.keys)
    val taken = walkers.values.map { it.desk }.toMutableSet()
    for (agent in next.values) {
      val existing = walkers[agent.id]
      if (existing == null) {
        var desk = 0
        while (taken.contains(desk)) desk++
        taken.add(desk)
        // On first load everyone is already at their desk; later arrivals come in through the door.
        val start = if (populated) OfficeWorld.door else OfficeWorld.seat(desk)
        val walker = Walker(agent.id, agent.name, agent.status, desk, start.x, start.z)
        walkers[agent.id] = walker
        retarget(walker)
      } else {
        existing.name = agent.name
        if (existing.status != agent.status) {
          existing.status = agent.status
          retarget(existing)
        }
      }
    }
    populated = true
  }

  private fun stepWalker(walker: Walker, dt: Float) {
    val target = walker.route.firstOrNull()
    var targetHeading = walker.heading
    var sidestepX = 0f
    var sidestepZ = 0f
    var blocked = false
    if (target != null) {
      val dx = target.x - walker.x
      val dz = target.z - walker.z
      val distance = hypot(dx, dz)
      if (distance > 1e-3f) {
        val dirX = dx / distance
        val dirZ = dz / distance
        for (other in walkers.values) {
          if (other === walker) continue
          val ox = other.px - walker.px
          val oz = other.pz - walker.pz
          val ahead = ox * dirX + oz * dirZ
          if (ahead <= 0f || ahead > LOOK_AHEAD) continue
          val side = ox * dirZ - oz * dirX
          if (abs(side) > PERSONAL_SPACE + 0.1f) continue
          sidestepX = dirZ * SIDESTEP
          sidestepZ = -dirX * SIDESTEP
          if (ahead < PERSONAL_SPACE && abs(side) < PERSONAL_SPACE * 0.6f) blocked = true
        }
      }
      if (blocked && walker.waited < MAX_WAIT) {
        walker.waited += dt
      } else {
        blocked = false
        walker.waited = 0f
        val step = WALK_SPEED * dt
        if (distance <= step) {
          walker.x = target.x
          walker.z = target.z
          walker.route.removeAt(0)
        } else {
          walker.x += dx / distance * step
          walker.z += dz / distance * step
        }
      }
      if (distance > 1e-3f) targetHeading = atan2(dx, dz)
    } else {
      walker.waited = 0f
      if (walker.status == "idle") {
        walker.pause -= dt
        if (walker.pause <= 0f) {
          walker.pause = 4f + Random.nextFloat() * 6f
          retarget(walker)
        }
      }
    }
    val ease = min(1f, dt * 6f)
    walker.offX += (sidestepX - walker.offX) * ease
    walker.offZ += (sidestepZ - walker.offZ) * ease
    walker.px = walker.x + walker.offX
    walker.pz = walker.z + walker.offZ

    val seat = OfficeWorld.seat(walker.desk)
    walker.walking = target != null && !blocked
    walker.seated = target == null &&
      (walker.status == "working" || walker.status == "disconnected") &&
      abs(walker.x - seat.x) + abs(walker.z - seat.z) < 1e-3f
    if (walker.seated) targetHeading = FACING_DESK
    if (target == null && walker.status == "waiting") targetHeading = FACING_VIEWER
    val turn = atan2(sin(targetHeading - walker.heading), cos(targetHeading - walker.heading))
    walker.heading += turn * min(1f, dt * 10f)
  }

  fun step(dt: Float) {
    clock += dt
    for (walker in walkers.values) stepWalker(walker, dt)
  }

  fun pose(walker: Walker, out: Pose) {
    val t = clock + walker.phase
    out.alertY = 1.65f + sin(t * 4f) * 0.06f
    out.alertSpin = t * 1.5f
    out.bob = 0f
    out.tilt = 0f
    when {
      walker.walking -> {
        val swing = sin(t * 9f)
        out.legLeft = swing * 0.6f
        out.legRight = -swing * 0.6f
        out.armLeft = -swing * 0.5f
        out.armRight = swing * 0.5f
        out.bob = abs(cos(t * 9f)) * 0.04f
      }
      walker.seated -> {
        val working = walker.status == "working"
        out.legLeft = (-PI / 2).toFloat()
        out.legRight = (-PI / 2).toFloat()
        out.armLeft = if (working) -1.15f + sin(t * 18f) * 0.12f else -0.6f
        out.armRight = if (working) -1.15f + sin(t * 18f + PI.toFloat()) * 0.12f else -0.6f
        if (walker.status == "disconnected") out.tilt = 0.3f
      }
      else -> {
        out.legLeft = 0f
        out.legRight = 0f
        out.armLeft = sin(t * 1.5f) * 0.05f
        out.armRight = if (walker.status == "waiting") -2.7f + sin(t * 7f) * 0.25f else -sin(t * 1.5f) * 0.05f
      }
    }
  }
}
