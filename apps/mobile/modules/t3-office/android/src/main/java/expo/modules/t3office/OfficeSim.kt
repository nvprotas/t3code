package expo.modules.t3office

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

class OfficeAgent(
  val id: String,
  val name: String,
  val task: String,
  val status: String,
  val subagents: Int,
  val team: String = "",
  val teamName: String = "",
  val ask: String = "",
  val quietSince: Long = 0L,
  val merged: Int = 0,
  val alarm: Boolean = false,
  val limited: Boolean = false,
  val provider: String = "",
)

/** The office's robot vacuum, which wanders the lanes and docks between rounds. */
class Vacuum {
  var x = OfficeWorld.dock.x
  var z = OfficeWorld.dock.z
  var heading = 0f
  var route: MutableList<FloorPoint> = mutableListOf()
  var pause = 6f
  var rounds = 0
}

class Walker(val id: String, var name: String, var status: String, var desk: Int, var x: Float, var z: Float) {
  val phase = Random.nextFloat() * 10f
  var heading = PI.toFloat()
  var route: MutableList<FloorPoint> = mutableListOf()
  var pause = Random.nextFloat() * 3f
  var walking = false
  var seated = false
  var task = ""
  var team = ""
  var teamName = ""
  var ask = ""
  var quietSince = 0L
  var sleeping = false
  var merged = 0
  var alarm = false
  var limited = false
  var provider = ""
  // Walking to the gong after a merged pull request, then on to wherever it belongs.
  var celebrate = false
  var hold = 0f
  // Gone from the thread list; walks out through the door and is then removed.
  var leaving = false
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
  // Where the name tag sits: how many steps it is lifted to clear others, eased on screen.
  var labelLevel = 0
  var labelLift = 0f

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
private val HALF_TURN = (PI / 2).toFloat()
private const val VACUUM_SPEED = 0.7f
private const val NAP_AFTER_MS = 2 * 60 * 60 * 1000L
// Seconds before the end of the visit at the gong when the mallet hits.
private const val GONG_STRIKE = 1.9f

/** Who is where in the office; rendering reads it every frame. */
class OfficeSim {
  val walkers = LinkedHashMap<String, Walker>()
  var time = 0f
    private set
  private var populated = false
  val vacuum = Vacuum()
  /** When the gong was last struck, in sim time; negative before the first time. */
  var gongAt = -100f
    private set
  /** Which project holds each pod, and its name for the sign; null while a pod is shared. */
  val podTeam = arrayOfNulls<String>(OfficeWorld.MAX_PODS)
  val podName = arrayOfNulls<String>(OfficeWorld.MAX_PODS)
  /** Bumps whenever the open plan gains or loses a row of pods, so the view rebuilds its scenery. */
  var layoutVersion = 0
    private set
  private var relaid = false
  /** Share of agents held back by a provider limit; the lights dim with it. */
  var limitedShare = 0f
    private set

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
    if (walker.leaving) {
      goal = OfficeWorld.door
      walker.goalHeading = -HALF_TURN
    } else if (walker.celebrate) {
      goal = OfficeWorld.gongSpot
      walker.activity = Activity.GONG
      walker.goalHeading = FACING_DESK
      walker.hold = 2.5f
    } else if (walker.cabinet >= 0) {
      goal = if (walker.status == "waiting") OfficeWorld.cabinetWaitSpot(walker.cabinet) else OfficeWorld.cabinetSeat(walker.cabinet)
      walker.goalHeading = if (walker.status == "waiting") FACING_VIEWER else FACING_DESK
    } else {
      when (walker.status) {
        "idle" -> if (walker.sleeping) {
          // Long idle: back at the desk, head down.
          goal = OfficeWorld.seat(walker.desk)
          walker.activity = Activity.SLEEP
          walker.goalHeading = FACING_DESK
        } else {
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
            goal = FloorPoint(-4f + Random.nextFloat() * 12f, 6.2f + OfficeWorld.shift + Random.nextFloat() * 0.6f)
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

  /**
   * Lends each pod to one project, biggest projects first, keeping pods where they are when it
   * can; then moves anyone sitting in another project's pod. Returns who changed desks.
   */
  private fun arrangeTeams(): List<Walker> {
    val present = walkers.values.filter { !it.leaving }
    val sizes = HashMap<String, Int>()
    for (walker in present) if (walker.team.isNotEmpty()) sizes[walker.team] = (sizes[walker.team] ?: 0) + 1
    val teams = sizes.keys.sortedWith(compareBy<String>({ -(sizes[it] ?: 0) }, { it }))
    val need = HashMap<String, Int>()
    for (team in teams) need[team] = ((sizes[team] ?: 0) + OfficeWorld.DESKS_PER_POD - 1) / OfficeWorld.DESKS_PER_POD
    // Projects sit side by side in a stable order; a project of more than four agents gets
    // neighbouring pods, joined into one wider room. Small ones do not straddle two rows.
    val seq = ArrayList<String?>()
    for (team in teams.sorted()) {
      val count = need[team] ?: 0
      val column = seq.size % OfficeWorld.PODS_PER_ROW
      if (count <= OfficeWorld.PODS_PER_ROW && column != 0 && column + count > OfficeWorld.PODS_PER_ROW) {
        repeat(OfficeWorld.PODS_PER_ROW - column) { seq.add(null) }
      }
      repeat(count) { seq.add(team) }
    }
    val unteamed = present.count { it.team.isEmpty() }
    repeat((unteamed + OfficeWorld.DESKS_PER_POD - 1) / OfficeWorld.DESKS_PER_POD) { seq.add(null) }
    val oldShift = OfficeWorld.shift
    if (OfficeWorld.setRows((seq.size + OfficeWorld.PODS_PER_ROW - 1) / OfficeWorld.PODS_PER_ROW)) relayout(oldShift)
    val owner = arrayOfNulls<String>(OfficeWorld.PODS)
    for (i in 0 until minOf(seq.size, owner.size)) owner[i] = seq[i]
    val joins = BooleanArray(OfficeWorld.MAX_PODS) { pod ->
      pod % OfficeWorld.PODS_PER_ROW < OfficeWorld.PODS_PER_ROW - 1 && pod + 1 < owner.size &&
        owner[pod] != null && owner[pod] == owner[pod + 1]
    }
    if (OfficeWorld.setJoins(joins)) layoutVersion++
    for (pod in 0 until OfficeWorld.MAX_PODS) {
      podTeam[pod] = owner.getOrNull(pod)
      podName[pod] = owner.getOrNull(pod)?.let { team -> present.firstOrNull { it.team == team }?.teamName }
    }
    val occupied = HashMap<Int, Walker>()
    for (walker in present) {
      if (walker.desk in 0 until OfficeWorld.DESKS && !occupied.containsKey(walker.desk)) occupied[walker.desk] = walker
    }
    fun ownPods(team: String) = (0 until OfficeWorld.PODS).filter { owner[it] == team }
    fun freeIn(pods: List<Int>) = pods.flatMap { OfficeWorld.podDesks(it).toList() }.firstOrNull { !occupied.containsKey(it) }
    val moving = present.filter { walker ->
      if (walker.desk !in 0 until OfficeWorld.DESKS || occupied[walker.desk] !== walker) return@filter true
      val pod = OfficeWorld.podOf(walker.desk)
      when (owner[pod]) {
        walker.team -> false
        null -> freeIn(ownPods(walker.team)) != null
        else -> true
      }
    }
    for (walker in moving) if (walker.desk in 0 until OfficeWorld.DESKS && occupied[walker.desk] === walker) occupied.remove(walker.desk)
    val shared = (0 until OfficeWorld.PODS).filter { owner[it] == null }
    for (walker in moving) {
      val desk = freeIn(ownPods(walker.team)) ?: freeIn(shared)
        ?: (0 until OfficeWorld.DESKS).firstOrNull { !occupied.containsKey(it) } ?: 0
      walker.desk = desk
      occupied[desk] = walker
    }
    return moving
  }

  /** The lounge moved with the last row; carry whoever was in it along and let everyone replan. */
  private fun relayout(oldShift: Float) {
    val delta = OfficeWorld.shift - oldShift
    val lounge = OfficeWorld.LOUNGE_START + oldShift
    for (walker in walkers.values) {
      if (walker.z > lounge) {
        walker.z += delta
        walker.pz += delta
      }
      walker.route = mutableListOf()
      walker.lane = -1
    }
    if (vacuum.z > lounge) vacuum.z += delta
    vacuum.route = mutableListOf()
    layoutVersion++
    relaid = true
  }

  /** Applies the thread list; returns how many agents just started waiting for an answer. */
  fun setAgents(agents: List<OfficeAgent>): Int {
    val next = LinkedHashMap<String, OfficeAgent>()
    for (agent in agents.take(OfficeWorld.MAX_DESKS)) next[agent.id] = agent
    val changed = HashSet<Walker>()
    var newlyWaiting = 0
    for (walker in walkers.values.toList()) {
      if (next.containsKey(walker.id)) continue
      if (!populated) {
        walkers.remove(walker.id)
      } else if (!walker.leaving) {
        walker.leaving = true
        walker.celebrate = false
        walker.cabinet = -1
        walker.status = "idle"
        changed.add(walker)
      }
    }
    for (agent in next.values) {
      val existing = walkers[agent.id]
      if (existing == null) {
        val start = OfficeWorld.door
        val walker = Walker(agent.id, agent.name, agent.status, -1, start.x, start.z)
        walker.merged = agent.merged
        update(walker, agent)
        walkers[agent.id] = walker
        changed.add(walker)
      } else {
        if (existing.leaving) {
          existing.leaving = false
          changed.add(existing)
        }
        if (populated && agent.merged > existing.merged && !existing.celebrate) {
          existing.celebrate = true
          changed.add(existing)
        }
        existing.merged = agent.merged
        val wasSleeping = existing.sleeping
        if (existing.status != agent.status) {
          if (populated && agent.status == "waiting") newlyWaiting++
          existing.status = agent.status
          changed.add(existing)
        }
        update(existing, agent)
        if (existing.sleeping != wasSleeping) changed.add(existing)
      }
    }
    relaid = false
    val moved = arrangeTeams()
    if (relaid) for (walker in walkers.values) changed.add(walker)
    for (walker in moved) {
      // On first load everyone is already at their desk; later arrivals come in through the door.
      if (!populated) {
        val seat = OfficeWorld.seat(walker.desk)
        walker.x = seat.x
        walker.z = seat.z
        walker.px = seat.x
        walker.pz = seat.z
      }
      if (walker.cabinet < 0 && (walker.status != "idle" || walker.sleeping)) changed.add(walker)
    }
    // A thread leaves its office once its subagents finish; others waiting for one move in.
    for (walker in walkers.values) {
      if (walker.cabinet >= 0 && walker.subagents == 0) {
        walker.cabinet = -1
        changed.add(walker)
      }
    }
    for (walker in walkers.values) {
      if (walker.leaving || walker.cabinet >= 0 || walker.subagents == 0) continue
      val used = walkers.values.map { it.cabinet }.toSet()
      val free = (0 until OfficeWorld.CABINETS).firstOrNull { !used.contains(it) } ?: break
      walker.cabinet = free
      changed.add(walker)
    }
    for (walker in changed) {
      // A celebration finishes on its own; a status change waits until the gong is struck.
      if (walker.activity == Activity.GONG && walker.celebrate && !walker.leaving && !relaid) continue
      retarget(walker)
    }
    val present = walkers.values.count { !it.leaving }
    limitedShare = if (present == 0) 0f else walkers.values.count { !it.leaving && it.limited }.toFloat() / present
    populated = true
    return newlyWaiting
  }

  private fun update(walker: Walker, agent: OfficeAgent) {
    walker.name = agent.name
    walker.task = agent.task
    walker.team = agent.team
    walker.teamName = agent.teamName
    walker.subagents = agent.subagents
    walker.ask = agent.ask
    walker.quietSince = agent.quietSince
    walker.sleeping = asleep(walker)
    walker.alarm = agent.alarm
    walker.limited = agent.limited
    walker.provider = agent.provider
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
      if (walker.leaving) {
        gone.add(walker.id)
      } else if (walker.activity == Activity.GONG) {
        val before = walker.hold
        walker.hold -= dt
        if (before > GONG_STRIKE && walker.hold <= GONG_STRIKE) gongAt = time
        if (walker.hold <= 0f) {
          walker.celebrate = false
          retarget(walker)
        }
      } else if (walker.status == "idle" && walker.cabinet < 0 && !walker.sleeping) {
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
    walker.seated = target == null &&
      (atDesk || walker.activity == Activity.COUCH || walker.activity == Activity.SLEEP) &&
      walker.activity != Activity.GONG && !walker.leaving
    val turn = atan2(sin(targetHeading - walker.heading), cos(targetHeading - walker.heading))
    walker.heading += turn * min(1f, dt * 10f)
  }

  private val gone = ArrayList<String>()
  private var napCheck = 0f

  private fun asleep(walker: Walker) = walker.status == "idle" && walker.quietSince > 0L &&
    System.currentTimeMillis() - walker.quietSince > NAP_AFTER_MS

  /** Idle agents doze off after a long quiet spell, even when nothing else changes. */
  private fun checkNaps(dt: Float) {
    napCheck -= dt
    if (napCheck > 0f) return
    napCheck = 20f
    for (walker in walkers.values) {
      val sleeping = asleep(walker)
      if (sleeping == walker.sleeping) continue
      walker.sleeping = sleeping
      if (!walker.leaving && !walker.celebrate && walker.cabinet < 0) retarget(walker)
    }
  }

  fun step(dt: Float) {
    time += dt
    for (walker in walkers.values) stepWalker(walker, dt)
    for (id in gone) walkers.remove(id)
    gone.clear()
    checkNaps(dt)
    stepVacuum(dt)
  }

  private fun stepVacuum(dt: Float) {
    val vacuum = vacuum
    val target = vacuum.route.firstOrNull()
    if (target == null) {
      vacuum.pause -= dt
      if (vacuum.pause > 0f) return
      vacuum.rounds++
      val docking = vacuum.rounds % 5 == 0
      val goal = if (docking) OfficeWorld.dock else OfficeWorld.randomFloorPoint(Random)
      vacuum.route = OfficeWorld.route(FloorPoint(vacuum.x, vacuum.z), goal)
      vacuum.pause = if (docking) 15f + Random.nextFloat() * 15f else 0.5f + Random.nextFloat() * 2f
      return
    }
    val dx = target.x - vacuum.x
    val dz = target.z - vacuum.z
    val distance = hypot(dx, dz)
    val step = VACUUM_SPEED * dt
    if (distance <= step) {
      vacuum.x = target.x
      vacuum.z = target.z
      vacuum.route.removeAt(0)
    } else {
      vacuum.x += dx / distance * step
      vacuum.z += dz / distance * step
    }
    if (distance > 1e-3f) {
      val goal = atan2(dx, dz)
      val turn = atan2(sin(goal - vacuum.heading), cos(goal - vacuum.heading))
      vacuum.heading += turn * min(1f, dt * 5f)
    }
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
      } else if (walker.activity == Activity.SLEEP) {
        out.armLeft = -1.4f
        out.armRight = -1.4f
        out.tilt = 0.45f + sin(t * 1.3f) * 0.03f
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
    if (walker.activity == Activity.GONG && !walker.leaving) {
      if (walker.hold > GONG_STRIKE) {
        out.armLeft = 0f
        out.armRight = -2.7f
      } else {
        out.armLeft = -2.9f + sin(t * 8f) * 0.2f
        out.armRight = -2.9f + sin(t * 8f + 1f) * 0.2f
        out.bob = abs(sin(t * 8f)) * 0.05f
      }
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
