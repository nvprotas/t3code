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
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import kotlin.math.max
import kotlin.math.min

private const val MAX_ZOOM = 5f
private const val LABEL_MAX_CHARS = 14

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

  // Zoom and pan, applied to the canvas so recorded furniture stays sharp.
  internal var zoom = 1f
  internal var panX = 0f
  internal var panY = 0f

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!running) return
      val dt = if (lastFrameNanos == 0L) 0f else min(0.1f, (frameTimeNanos - lastFrameNanos) / 1e9f)
      lastFrameNanos = frameTimeNanos
      sim.step(dt)
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
    renderer = if (width > 0 && height > 0) OfficeRenderer(width, height) else null
    setView(1f, 0f, 0f)
  }

  internal fun setView(k: Float, x: Float, y: Float) {
    val width = canvasView.width.toFloat()
    val height = canvasView.height.toFloat()
    zoom = min(MAX_ZOOM, max(1f, k))
    panX = min(0f, max(width - width * zoom, x))
    panY = min(0f, max(height - height * zoom, y))
    canvasView.invalidate()
  }

  internal fun frameDrawn() {
    framesDrawn++
    if (framesDrawn == 30) onRendered(mapOf("frames" to framesDrawn))
  }

  internal fun tapped(x: Float, y: Float) {
    val renderer = renderer ?: return
    val id = renderer.pick(sim, (x - panX) / zoom, (y - panY) / zoom) ?: ""
    onSelectAgent(mapOf("id" to id))
  }
}

/** Draws the office and turns pinch, drag and taps into zoom, pan and selection. */
private class OfficeCanvasView(context: Context, private val host: T3OfficeView) : View(context) {
  private val density = resources.displayMetrics.density
  private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = 9f * density
    typeface = Typeface.DEFAULT_BOLD
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

  private val scaleDetector = ScaleGestureDetector(
    context,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        val next = min(MAX_ZOOM, max(1f, host.zoom * detector.scaleFactor))
        val ratio = next / host.zoom
        host.setView(
          next,
          detector.focusX - (detector.focusX - host.panX) * ratio,
          detector.focusY - (detector.focusY - host.panY) * ratio,
        )
        return true
      }
    },
  )

  private val gestureDetector = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true

      override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
        if (host.zoom <= 1.001f || scaleDetector.isInProgress) return false
        host.setView(host.zoom, host.panX - distanceX, host.panY - distanceY)
        return true
      }

      override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
        host.tapped(e.x, e.y)
        return true
      }

      override fun onDoubleTap(e: MotionEvent): Boolean {
        host.setView(1f, 0f, 0f)
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
      // Keep the screen's scroll view from stealing a pinch, or a drag while zoomed in.
      MotionEvent.ACTION_DOWN -> parent?.requestDisallowInterceptTouchEvent(host.zoom > 1.001f)
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
      val x = renderer.projectX(walker.px, 1.45f, walker.pz) * host.zoom + host.panX
      val y = renderer.projectY(walker.px, 1.45f, walker.pz) * host.zoom + host.panY
      val waiting = walker.status == "waiting"
      val top = drawLabel(canvas, walker.name, x, y, walker.id == host.selectedId, waiting)
      if (waiting) drawAlert(canvas, x, top - 3f * density, host.sim.time)
      if (walker.cabinet >= 0 && walker.subagents > 0) drawSubagents(canvas, renderer, walker)
    }
    host.frameDrawn()
  }

  /** Draws the name tag with its bottom edge at y and returns its top edge. */
  private fun drawLabel(canvas: Canvas, name: String, x: Float, y: Float, selected: Boolean, waiting: Boolean): Float {
    val text = if (name.length > LABEL_MAX_CHARS) name.take(LABEL_MAX_CHARS - 1) + "…" else name
    val textWidth = labelPaint.measureText(text)
    val padX = 4f * density
    val top = y - labelPaint.textSize - 4f * density
    pill.set(x - textWidth / 2f - padX, top, x + textWidth / 2f + padX, y)
    pillPaint.color = when {
      selected -> Color.rgb(0xfa, 0xcc, 0x15)
      waiting -> Color.rgb(0xea, 0x58, 0x0c)
      else -> Color.argb(150, 0, 0, 0)
    }
    canvas.drawRoundRect(pill, 5f * density, 5f * density, pillPaint)
    labelPaint.color = if (selected) Color.rgb(0x1f, 0x29, 0x37) else Color.WHITE
    canvas.drawText(text, x, y - 3.5f * density, labelPaint)
    return top
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
    val text = "\u00d7" + walker.subagents
    val textWidth = labelPaint.measureText(text)
    pill.set(x - textWidth / 2f - 4f * density, y - 7f * density, x + textWidth / 2f + 4f * density, y + 7f * density)
    pillPaint.color = Color.argb(200, 15, 23, 42)
    canvas.drawRoundRect(pill, 5f * density, 5f * density, pillPaint)
    labelPaint.color = Color.WHITE
    canvas.drawText(text, x, y + labelPaint.textSize * 0.36f, labelPaint)
  }
}
