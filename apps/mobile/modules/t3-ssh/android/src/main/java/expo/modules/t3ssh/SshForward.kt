package expo.modules.t3ssh

import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.DirectConnection
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService

internal class SshForward(
  private val client: SSHClient,
  private val remoteHost: String,
  private val remotePort: Int,
  private val workers: ExecutorService,
) : Closeable {
  private val listener = ServerSocket()
  private val sockets = mutableSetOf<Socket>()
  private val channels = mutableSetOf<DirectConnection>()
  @Volatile private var closed = false

  init {
    try {
      listener.bind(InetSocketAddress(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), 0))
    } catch (error: Exception) {
      listener.close()
      throw error
    }
  }

  val localPort: Int get() = listener.localPort

  fun listen() {
    while (!closed) {
      val socket = try { listener.accept() } catch (error: Exception) {
        if (closed) return else throw error
      }
      synchronized(this) {
        if (closed) {
          socket.close()
          return
        }
        sockets.add(socket)
      }
      try {
        workers.execute { relay(socket) }
      } catch (error: Exception) {
        synchronized(this) { sockets.remove(socket) }
        socket.close()
        throw error
      }
    }
  }

  private fun relay(socket: Socket) {
    var channel: DirectConnection? = null
    try {
      if (closed || socket.isClosed) return
      val connection = client.newDirectConnection(remoteHost, remotePort)
      channel = connection
      synchronized(this) {
        if (closed) return
        channels.add(connection)
      }
      workers.execute {
        try {
          pump(socket.getInputStream(), connection.outputStream)
          connection.outputStream.close()
        } catch (_: Exception) {
          runCatching { socket.close() }
          runCatching { connection.close() }
        }
      }
      pump(connection.inputStream, socket.getOutputStream())
    } catch (_: Exception) {
      // A refused destination closes this TCP connection, not the SSH session.
    } finally {
      runCatching { socket.close() }
      runCatching { channel?.close() }
      synchronized(this) {
        sockets.remove(socket)
        channel?.let { channels.remove(it) }
      }
    }
  }

  /**
   * Copies until EOF, flushing every read. SSHJ's channel stream holds data
   * until a full packet, so a short request would never reach the server.
   */
  private fun pump(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(32 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) return
      output.write(buffer, 0, read)
      output.flush()
    }
  }

  fun stopListening() {
    val active = synchronized(this) {
      closed = true
      sockets.toList().also { sockets.clear() }
    }
    runCatching { listener.close() }
    active.forEach { runCatching { it.close() } }
  }

  override fun close() {
    stopListening()
    val active = synchronized(this) { channels.toList().also { channels.clear() } }
    active.forEach { runCatching { it.close() } }
  }
}
