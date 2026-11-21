package expo.modules.t3office

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

class OfficeAgent(val id: String, val name: String, val task: String, val status: String, val subagents: Int)

class Walker(val id: String, var name: String, var status: String, var desk: Int, var x: Float, var z: Float) {
  val phase = Random.nextFloat() * 10f
  var heading = PI.toFloat()
  var route: MutableList<FloorPoint> = mutableListOf()
  var pause = Random.nextFloat() * 3f
  var walking = false
  var seated = false
  var task = ""
  var subagents = 0
  var cabinet = -1
  var spot = -1
  var activity = Activity.NONE
  var goalHeading = PI.toFloat()
  // Lane the walker's current spot is reached from, so it leaves the way it came in.
  var lane = -1
  // Sidestep that keeps walkers from meeting head-on; the drawn position is (px, pz).
  var offX = 0f
  var offZ = 0f
  var waited = 0f
  var ghost = 0f
  var px = x
  var pz = z

  val arrived get() = route.isEmpty()
}

class Pose {
  var legLeft = 0f
  var legRight = 0f
  var armLeft = 0f
  var armRight = 0f
  var bob = 0f
  var tilt = 0f
}

private const val WALK_SPEED = 1.7f
private val FACING_DESK = PI.toFloat()
// Turned towards the camera, so a waiting agent waves at you.
private val FACING_VIEWER = atan2(11.0, 13.0).toFloat()
// Everyone steps to the same hand, so two walkers on one lane pass instead of colliding.
private const val SIDESTEP = 0.34f
private const val LOOK_AHEAD = 1.1f
private const val PERSONAL_SPACE = 0.5f
// After waiting this long a walker stops yielding for a while, so a jam always clears.
private const val MAX_WAIT = 1.2f
private const val GHOST_TIME = 1.5f

/** Who is where in the office; rendering reads it every frame. */
class OfficeSim {
  val walkers = LinkedHashMap<String, Walker>()
  var time = 0f
    private set
  private var populated = false

  private fun freeSpot(walker: Walker): Int {
    val taken = walkers.values.filter { it !== walker }.map { it.spot }.toSet()
    val free = OfficeWorld.spots.indices.filter { !taken.contains(it) && it != walker.spot }
    return if (free.isEmpty()) -1 else free[Random.nextInt(free.size)]
  }

  private fun retarget(walker: Walker) {
    walker.spot = -1
    walker.activity = Activity.NONE
    var toLane = -1
    val goal: FloorPoint
    if (walker.cabinet >= 0) {
      goal = if (walker.status == "waiting") OfficeWorld.cabinetWaitSpot(walker.cabinet) else OfficeWorld.cabinetSeat(walker.cabinet)
      walker.goalHeading = if (walker.status == "waiting") FACING_VIEWER else FACING_DESK
    } else {
      when (walker.status) {
        "idle" -> {
          val spot = freeSpot(walker)
          if (spot >= 0) {
            val place = OfficeWorld.spots[spot]
            walker.spot = spot
            walker.activity = place.activity
            walker.goalHeading = place.heading
            toLane = place.lane
            goal = FloorPoint(place.x, place.z)
          } else {
            walker.activity = Activity.WANDER
            walker.goalHeading = FACING_VIEWER
            goal = FloorPoint(-4f + Random.nextFloat() * 12f, 6.2f + Random.nextFloat() * 0.6f)
          }
        }
        "waiting" -> {
          goal = OfficeWorld.deskWaitSpot(walker.desk)
          walker.goalHeading = FACING_VIEWER
        }
        else -> {
          goal = OfficeWorld.seat(walker.desk)
          walker.goalHeading = FACING_DESK
        }
      }
    }
    walker.route = OfficeWorld.route(FloorPoint(walker.x, walker.z), goal, walker.lane, toLane)
    walker.lane = toLane
    walker.pause = 9f + Random.nextFloat() * 9f
  }

  fun setAgents(agents: List<OfficeAgent>) {
    val next = LinkedHashMap<String, OfficeAgent>()
    for (agent in agents.take(OfficeWorld.DESKS)) next[agent.id] = agent
    walkers.keys.retainAll(next.keys)
    val taken = walkers.values.map { it.desk }.toMutableSet()
    val changed = HashSet<Walker>()
    for (agent in next.values) {
      val existing = walkers[agent.id]
      if (existing == null) {
        var desk = 0
        while (taken.contains(desk)) desk++
        taken.add(desk)
        // On first load everyone is already at their desk; later arrivals come in through the door.
        val start = if (populated) OfficeWorld.door else OfficeWorld.seat(desk)
        val walker = Walker(agent.id, agent.name, agent.status, desk, start.x, start.z)
        walker.task = agent.task
        walker.subagents = agent.subagents
        walkers[agent.id] = walker
        changed.add(walker)
      } else {
        existing.name = agent.name
        existing.task = agent.task
        existing.subagents = agent.subagents
        if (existing.status != agent.status) {
          existing.status = agent.status
          changed.add(existing)
        }
      }
    }
    // A thread leaves its office once its subagents finish; others waiting for one move in.
    for (walker in walkers.values) {
      if (walker.cabinet >= 0 && walker.subagents == 0) {
        walker.cabinet = -1
        changed.add(walker)
      }
    }
    for (walker in walkers.values) {
      if (walker.cabinet >= 0 || walker.subagents == 0) continue
      val used = walkers.values.map { it.cabinet }.toSet()
      val free = (0 until OfficeWorld.CABINETS).firstOrNull { !used.contains(it) } ?: break
      walker.cabinet = free
      changed.add(walker)
    }
    for (walker in changed) retarget(walker)
    populated = true
  }

  private fun stepWalker(walker: Walker, dt: Float) {
    val target = walker.route.firstOrNull()
    var targetHeading = walker.heading
    var sidestepX = 0f
    var sidestepZ = 0f
    var blocked = false
    if (walker.ghost > 0f) walker.ghost -= dt
    if (target != null) {
      val dx = target.x - walker.x
      val dz = target.z - walker.z
      val distance = hypot(dx, dz)
      if (distance > 1e-3f && walker.ghost <= 0f) {
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
      if (blocked) {
        walker.waited += dt
        if (walker.waited >= MAX_WAIT) {
          walker.waited = 0f
          walker.ghost = GHOST_TIME
        }
      } else {
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
      targetHeading = walker.goalHeading
      if (walker.status == "idle" && walker.cabinet < 0) {
        walker.pause -= dt
        if (walker.pause <= 0f) retarget(walker)
      }
    }
    val ease = min(1f, dt * 6f)
    walker.offX += (sidestepX - walker.offX) * ease
    walker.offZ += (sidestepZ - walker.offZ) * ease
    walker.px = walker.x + walker.offX
    walker.pz = walker.z + walker.offZ

    walker.walking = target != null && !blocked
    val atDesk = walker.status == "working" || walker.status == "disconnected" ||
      (walker.cabinet >= 0 && walker.status != "waiting")
    walker.seated = target == null && (atDesk || walker.activity == Activity.COUCH)
    val turn = atan2(sin(targetHeading - walker.heading), cos(targetHeading - walker.heading))
    walker.heading += turn * min(1f, dt * 10f)
  }

  fun step(dt: Float) {
    time += dt
    for (walker in walkers.values) stepWalker(walker, dt)
  }

  /** Whether someone is at the ping-pong table, so the ball is in play. */
  fun pingPongPlayers(): Int = walkers.values.count {
    it.arrived && (it.spot == OfficeWorld.PING_PONG_LEFT || it.spot == OfficeWorld.PING_PONG_RIGHT)
  }

  fun pose(walker: Walker, out: Pose) {
    val t = time + walker.phase
    out.bob = 0f
    out.tilt = 0f
    out.legLeft = 0f
    out.legRight = 0f
    if (walker.walking) {
      val swing = sin(t * 9f)
      out.legLeft = swing * 0.6f
      out.legRight = -swing * 0.6f
      out.armLeft = -swing * 0.5f
      out.armRight = swing * 0.5f
      out.bob = abs(cos(t * 9f)) * 0.04f
      return
    }
    if (walker.seated) {
      out.legLeft = (-PI / 2).toFloat()
      out.legRight = (-PI / 2).toFloat()
      if (walker.status == "working") {
        out.armLeft = -1.15f + sin(t * 18f) * 0.12f
        out.armRight = -1.15f + sin(t * 18f + PI.toFloat()) * 0.12f
      } else if (walker.activity == Activity.COUCH) {
        out.armLeft = -0.35f
        out.armRight = -0.35f + sin(t * 0.8f) * 0.1f
        out.tilt = -0.12f
      } else {
        out.armLeft = -0.6f
        out.armRight = -0.6f
      }
      if (walker.status == "disconnected") out.tilt = 0.3f
      return
    }
    if (walker.status == "waiting") {
      out.armLeft = sin(t * 1.5f) * 0.05f
      out.armRight = -2.7f + sin(t * 7f) * 0.3f
      return
    }
    when (walker.activity) {
      Activity.COFFEE -> {
        val sip = (t % 5f) < 1f
        out.armLeft = sin(t * 1.5f) * 0.05f
        out.armRight = if (sip) -2.0f else -1.2f
      }
      Activity.ARCADE -> {
        out.armLeft = -1.25f + sin(t * 15f) * 0.15f
        out.armRight = -1.25f + sin(t * 11f + 1f) * 0.15f
        out.bob = abs(sin(t * 3f)) * 0.02f
      }
      Activity.READ -> {
        out.armLeft = -1.0f
        out.armRight = -1.0f
        out.tilt = 0.08f
      }
      Activity.PINGPONG -> {
        out.armLeft = -0.4f
        out.armRight = -1.0f + sin(t * 5f) * 0.6f
        out.bob = abs(sin(t * 5f)) * 0.03f
      }
      Activity.CHAT -> {
        out.armLeft = -0.4f + sin(t * 2.6f) * 0.35f
        out.armRight = -0.2f + sin(t * 1.9f + 2f) * 0.25f
      }
      else -> {
        out.armLeft = sin(t * 1.5f) * 0.05f
        out.armRight = -sin(t * 1.5f) * 0.05f
      }
    }
  }
}
