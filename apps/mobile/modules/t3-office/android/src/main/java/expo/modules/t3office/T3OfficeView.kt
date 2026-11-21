package expo.modules.t3office

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.view.Choreographer
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

private const val MAX_ZOOM = 6f
// Close enough to read faces; a double tap or a focus request lands here.
private const val CLOSE_ZOOM = 2.8f
// The first view fills the frame's height, but never zooms in further than this.
private const val HOME_ZOOM_CAP = 2.2f
private const val NAME_MAX_CHARS = 12
private const val TASK_MAX_CHARS = 18
private const val MAX_LABELS = 16

class T3OfficeView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onSelectAgent by EventDispatcher()
  private val onRendered by EventDispatcher()
  private val canvasView = OfficeCanvasView(context, this)

  internal val sim = OfficeSim()
  internal var renderer: OfficeRenderer? = null
  internal var selectedId = ""
  private var active = true
  private var running = false
  private var lastFrameNanos = 0L
  private var framesDrawn = 0
  private var focusRequest = ""

  // Zoom and pan, applied to the canvas so recorded furniture stays sharp.
  internal var zoom = 1f
  internal var panX = 0f
  internal var panY = 0f

  // Where an animated camera move is heading; a touch cancels it.
  private var animating = false
  private var goalZoom = 1f
  private var goalX = 0f
  private var goalY = 0f

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) return
      val dt = if (lastFrameNanos == 0L) 0f else min(0.1f, (frameTimeNanos - lastFrameNanos) / 1e9f)
      lastFrameNanos = frameTimeNanos
      sim.step(dt)
      if (animating) stepCamera(dt)
      canvasView.invalidate()
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  init {
    addView(
      canvasView,
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    canvasView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    canvasView.layout(0, 0, width, height)
  }

  fun setAgentsJson(json: String) {
    val array = JSONArray(json)
    val agents = ArrayList<OfficeAgent>(array.length())
    for (i in 0 until array.length()) {
      val item = array.getJSONObject(i)
      agents.add(
        OfficeAgent(
          item.getString("id"),
          item.optString("name"),
          item.optString("task"),
          item.optString("status", "idle"),
          item.optInt("subagents", 0),
        ),
      )
    }
    sim.setAgents(agents)
    canvasView.invalidate()
  }

  fun setSelectedId(id: String) {
    selectedId = id
    canvasView.invalidate()
  }

  fun setActive(value: Boolean) {
    active = value
    updateRunning()
  }

  /** "<nonce>|overview" or "<nonce>|<agent id>"; the nonce lets the same target be asked for twice. */
  fun setFocusRequest(request: String) {
    if (request == focusRequest) return
    focusRequest = request
    val target = request.substringAfter('|', "")
    if (target.isEmpty()) return
    if (target == "overview") {
      flyTo(1f, 0f, 0f, centered = true)
      return
    }
    val walker = sim.walkers[target] ?: return
    val renderer = renderer ?: return
    flyTo(
      CLOSE_ZOOM,
      renderer.projectX(walker.px, 0.8f, walker.pz),
      renderer.projectY(walker.px, 0.8f, walker.pz),
      centered = false,
    )
  }

  fun cleanup() {
    active = false
    updateRunning()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    updateRunning()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    updateRunning()
  }

  private fun updateRunning() {
    val shouldRun = active && isAttachedToWindow
    if (shouldRun == running) return
    running = shouldRun
    lastFrameNanos = 0L
    if (running) {
      Choreographer.getInstance().postFrameCallback(frameCallback)
    } else {
      Choreographer.getInstance().removeFrameCallback(frameCallback)
    }
  }

  internal fun sizeChanged(width: Int, height: Int) {
    val next = if (width > 0 && height > 0) OfficeRenderer(width, height) else null
    renderer = next
    animating = false
    if (next == null) return
    // Start as close as fills the frame, so a tall view is not mostly empty.
    val cover = max(width / (next.roomRight - next.roomLeft), height / (next.roomBottom - next.roomTop))
    val home = min(HOME_ZOOM_CAP, max(1f, cover))
    setView(home, width / 2f - width / 2f * home, height / 2f - height / 2f * home)
  }

  /** Whether the room is larger than the view, so one finger pans instead of scrolling the page. */
  internal fun pannable(): Boolean {
    val renderer = renderer ?: return false
    return (renderer.roomRight - renderer.roomLeft) * zoom > canvasView.width + 1f ||
      (renderer.roomBottom - renderer.roomTop) * zoom > canvasView.height + 1f
  }

  private fun clampPan(pan: Float, k: Float, low: Float, high: Float, size: Float): Float {
    val content = (high - low) * k
    if (content <= size) return size / 2f - (low + high) / 2f * k
    return min(-low * k, max(size - high * k, pan))
  }

  internal fun setView(k: Float, x: Float, y: Float) {
    val renderer = renderer ?: return
    zoom = min(MAX_ZOOM, max(1f, k))
    panX = clampPan(x, zoom, renderer.roomLeft, renderer.roomRight, canvasView.width.toFloat())
    panY = clampPan(y, zoom, renderer.roomTop, renderer.roomBottom, canvasView.height.toFloat())
    canvasView.invalidate()
  }

  /** Zooms about a screen point, keeping the point under the finger. */
  internal fun zoomAbout(k: Float, focusX: Float, focusY: Float, fromZoom: Float, fromX: Float, fromY: Float) {
    val next = min(MAX_ZOOM, max(1f, k))
    val ratio = next / fromZoom
    setView(next, focusX - (focusX - fromX) * ratio, focusY - (focusY - fromY) * ratio)
  }

  internal fun stopAnimation() {
    animating = false
  }

  /** Animates the camera to `k`, with the unzoomed view point (x, y) in the middle of the view. */
  internal fun flyTo(k: Float, x: Float, y: Float, centered: Boolean) {
    val width = canvasView.width.toFloat()
    val height = canvasView.height.toFloat()
    goalZoom = min(MAX_ZOOM, max(1f, k))
    goalX = if (centered) 0f else width / 2f - x * goalZoom
    goalY = if (centered) 0f else height / 2f - y * goalZoom
    animating = true
    if (!running) setView(goalZoom, goalX, goalY)
  }

  private fun stepCamera(dt: Float) {
    if (dt <= 0f) return
    val ease = 1f - exp(-dt * 10f)
    val beforeZoom = zoom
    val beforeX = panX
    val beforeY = panY
    setView(zoom + (goalZoom - zoom) * ease, panX + (goalX - panX) * ease, panY + (goalY - panY) * ease)
    // Done when it settles; the pan may stop short of its goal against the room's edge.
    val moved = abs(zoom - beforeZoom) * 100f + abs(panX - beforeX) + abs(panY - beforeY)
    if (abs(goalZoom - zoom) < 0.01f && moved < 0.5f) {
      setView(goalZoom, goalX, goalY)
      animating = false
    }
  }

  internal fun frameDrawn() {
    framesDrawn++
    if (framesDrawn == 30) onRendered(mapOf("frames" to framesDrawn))
  }

  internal fun tapped(x: Float, y: Float, radius: Float) {
    val renderer = renderer ?: return
    val id = renderer.pick(sim, (x - panX) / zoom, (y - panY) / zoom, radius / zoom) ?: ""
    onSelectAgent(mapOf("id" to id))
  }
}

/** Draws the office and turns pinch, drag and taps into zoom, pan and selection. */
private class OfficeCanvasView(context: Context, private val host: T3OfficeView) : View(context) {
  private val density = resources.displayMetrics.density
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val namePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = 10f * density
    typeface = Typeface.DEFAULT_BOLD
    textAlign = Paint.Align.CENTER
  }
  private val taskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = 8.5f * density
    textAlign = Paint.Align.CENTER
  }
  private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val badgeText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = 13f * density
    typeface = Typeface.DEFAULT_BOLD
    textAlign = Paint.Align.CENTER
    color = Color.WHITE
  }
  private val pill = RectF()

  // Label layout scratch space, reused every frame.
  private val order = arrayOfNulls<Walker>(MAX_LABELS)
  private val rank = IntArray(MAX_LABELS)
  private val placed = FloatArray(MAX_LABELS * 4)

  // One-finger zoom: double tap, then drag up or down without lifting.
  private var dragZoom = false
  private var dragMoved = false
  private var dragStartY = 0f
  private var dragAnchorX = 0f
  private var dragAnchorY = 0f
  private var dragFromZoom = 1f
  private var dragFromX = 0f
  private var dragFromY = 0f

  private val scaleDetector = ScaleGestureDetector(
    context,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        host.zoomAbout(
          host.zoom * detector.scaleFactor,
          detector.focusX,
          detector.focusY,
          host.zoom,
          host.panX,
          host.panY,
        )
        return true
      }
    },
  ).apply { isQuickScaleEnabled = false }

  private val gestureDetector = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true

      override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
        if (!host.pannable() || scaleDetector.isInProgress || dragZoom) return false
        host.setView(host.zoom, host.panX - distanceX, host.panY - distanceY)
        return true
      }

      override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
        host.tapped(e.x, e.y, 28f * density)
        return true
      }

      override fun onDoubleTapEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            parent?.requestDisallowInterceptTouchEvent(true)
            dragZoom = true
            dragMoved = false
            dragStartY = e.y
            dragAnchorX = e.x
            dragAnchorY = e.y
            dragFromZoom = host.zoom
            dragFromX = host.panX
            dragFromY = host.panY
          }
          MotionEvent.ACTION_MOVE -> {
            val dy = e.y - dragStartY
            if (abs(dy) > touchSlop) dragMoved = true
            if (dragMoved) {
              host.zoomAbout(
                dragFromZoom * exp(dy / (140f * density)),
                dragAnchorX,
                dragAnchorY,
                dragFromZoom,
                dragFromX,
                dragFromY,
              )
            }
          }
          MotionEvent.ACTION_UP -> {
            if (!dragMoved) {
              // A plain double tap: close up on that spot, or back to the whole room.
              if (host.zoom < CLOSE_ZOOM * 0.8f) {
                host.flyTo(CLOSE_ZOOM, (e.x - host.panX) / host.zoom, (e.y - host.panY) / host.zoom, centered = false)
              } else {
                host.flyTo(1f, 0f, 0f, centered = true)
              }
            }
            dragZoom = false
          }
          MotionEvent.ACTION_CANCEL -> dragZoom = false
        }
        return true
      }
    },
  )

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    host.sizeChanged(w, h)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        host.stopAnimation()
        // Keep the screen's scroll view from stealing a drag that pans the room.
        parent?.requestDisallowInterceptTouchEvent(host.pannable())
      }
      MotionEvent.ACTION_POINTER_DOWN -> parent?.requestDisallowInterceptTouchEvent(true)
    }
    scaleDetector.onTouchEvent(event)
    gestureDetector.onTouchEvent(event)
    return true
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawColor(Color.rgb(0x1b, 0x1f, 0x27))
    val renderer = host.renderer ?: return
    canvas.save()
    canvas.translate(host.panX, host.panY)
    canvas.scale(host.zoom, host.zoom)
    renderer.draw(canvas, host.sim, host.selectedId)
    canvas.restore()
    for (walker in host.sim.walkers.values) {
      if (walker.cabinet >= 0 && walker.subagents > 0) drawSubagents(canvas, renderer, walker)
    }
    drawLabels(canvas, renderer)
    host.frameDrawn()
  }

  private fun priority(walker: Walker) = when {
    walker.id == host.selectedId -> 0
    walker.status == "waiting" -> 1
    else -> 2
  }

  /**
   * Name tags, most important first. A tag that would cover one already drawn moves up;
   * when zoomed out, a plain tag that still collides is left out.
   */
  private fun drawLabels(canvas: Canvas, renderer: OfficeRenderer) {
    var count = 0
    for (walker in host.sim.walkers.values) {
      if (count == MAX_LABELS) break
      order[count] = walker
      rank[count] = priority(walker)
      count++
    }
    // Insertion sort by rank, then front to back, so nearer agents keep their tags.
    for (i in 1 until count) {
      val walker = order[i]!!
      val r = rank[i]
      var j = i - 1
      while (j >= 0 && (rank[j] > r || (rank[j] == r && order[j]!!.pz < walker.pz))) {
        order[j + 1] = order[j]
        rank[j + 1] = rank[j]
        j--
      }
      order[j + 1] = walker
      rank[j + 1] = r
    }
    // Show the task line only when figures are big enough to tell apart.
    val detailed = renderer.pixelsPerUnit * host.zoom > 26f * density
    var drawn = 0
    for (i in 0 until count) {
      val walker = order[i]!!
      val important = rank[i] < 2
      val x = renderer.projectX(walker.px, 1.45f, walker.pz) * host.zoom + host.panX
      val baseY = renderer.projectY(walker.px, 1.45f, walker.pz) * host.zoom + host.panY
      if (x < -60f * density || x > width + 60f * density || baseY < -20f * density || baseY > height + 60f * density) continue
      val name = clip(walker.name, NAME_MAX_CHARS)
      val task = if (detailed || important) clip(walker.task, TASK_MAX_CHARS) else ""
      val padX = 5f * density
      val textWidth = max(namePaint.measureText(name), if (task.isEmpty()) 0f else taskPaint.measureText(task))
      val labelHeight = namePaint.textSize + 5f * density + if (task.isEmpty()) 0f else taskPaint.textSize + 2f * density
      val left = x - textWidth / 2f - padX
      val right = x + textWidth / 2f + padX
      var bottom = baseY
      var free = false
      for (attempt in 0 until 4) {
        if (!overlaps(left, bottom - labelHeight, right, bottom, drawn)) {
          free = true
          break
        }
        bottom -= labelHeight + 2f * density
      }
      if (!free) {
        if (!important) continue
        bottom = baseY
      }
      val top = bottom - labelHeight
      placed[drawn * 4] = left
      placed[drawn * 4 + 1] = top
      placed[drawn * 4 + 2] = right
      placed[drawn * 4 + 3] = bottom
      drawn++
      drawLabel(canvas, name, task, left, top, right, bottom, x, walker)
      if (walker.status == "waiting") drawAlert(canvas, x, top - 3f * density, host.sim.time)
    }
  }

  private fun overlaps(left: Float, top: Float, right: Float, bottom: Float, drawn: Int): Boolean {
    for (i in 0 until drawn) {
      if (left < placed[i * 4 + 2] && right > placed[i * 4] && top < placed[i * 4 + 3] && bottom > placed[i * 4 + 1]) return true
    }
    return false
  }

  private fun clip(text: String, limit: Int) = if (text.length > limit) text.take(limit - 1) + "…" else text

  private fun drawLabel(
    canvas: Canvas,
    name: String,
    task: String,
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
    x: Float,
    walker: Walker,
  ) {
    val selected = walker.id == host.selectedId
    pill.set(left, top, right, bottom)
    pillPaint.color = when {
      selected -> Color.rgb(0xfa, 0xcc, 0x15)
      walker.status == "waiting" -> Color.rgb(0xea, 0x58, 0x0c)
      else -> Color.argb(170, 0, 0, 0)
    }
    canvas.drawRoundRect(pill, 6f * density, 6f * density, pillPaint)
    val ink = if (selected) Color.rgb(0x1f, 0x29, 0x37) else Color.WHITE
    namePaint.color = ink
    val nameBaseline = top + 2.5f * density + namePaint.textSize * 0.92f
    canvas.drawText(name, x, nameBaseline, namePaint)
    if (task.isNotEmpty()) {
      taskPaint.color = if (selected) Color.rgb(0x37, 0x41, 0x51) else Color.argb(215, 255, 255, 255)
      canvas.drawText(task, x, nameBaseline + 2f * density + taskPaint.textSize, taskPaint)
    }
  }

  /** A pulsing "!" bubble over an agent that needs an answer, drawn on top of everything. */
  private fun drawAlert(canvas: Canvas, x: Float, bottom: Float, time: Float) {
    val radius = (10f + 1.5f * kotlin.math.sin(time * 6f)) * density
    val cy = bottom - radius
    badgePaint.color = Color.WHITE
    canvas.drawCircle(x, cy, radius + 2f * density, badgePaint)
    badgePaint.color = Color.rgb(0xdc, 0x26, 0x26)
    canvas.drawCircle(x, cy, radius, badgePaint)
    canvas.drawText("!", x, cy + badgeText.textSize * 0.36f, badgeText)
  }

  /** How many subagents a thread runs, shown on its office's door sign. */
  private fun drawSubagents(canvas: Canvas, renderer: OfficeRenderer, walker: Walker) {
    val cx = OfficeWorld.cabinetX[walker.cabinet]
    val x = renderer.projectX(cx, 2.72f, -6.9f) * host.zoom + host.panX
    val y = renderer.projectY(cx, 2.72f, -6.9f) * host.zoom + host.panY
    val text = "×" + walker.subagents
    val textWidth = namePaint.measureText(text)
    pill.set(x - textWidth / 2f - 4f * density, y - 7f * density, x + textWidth / 2f + 4f * density, y + 7f * density)
    pillPaint.color = Color.argb(200, 15, 23, 42)
    canvas.drawRoundRect(pill, 5f * density, 5f * density, pillPaint)
    namePaint.color = Color.WHITE
    canvas.drawText(text, x, y + namePaint.textSize * 0.36f, namePaint)
  }
}
