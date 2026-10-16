package expo.modules.t3ssh

import android.content.Context
import android.util.Log
import android.net.ConnectivityManager
import android.net.Network
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.keepalive.KeepAliveRunner
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import net.schmizz.sshj.transport.DisconnectListener
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.net.SocketFactory

// A plain class parsed from the JS object: Expo Records are built reflectively,
// and R8 strips their no-arg constructor in release builds.
class ConnectOptions(
  val attemptId: String,
  val hostname: String,
  val port: Int,
  val username: String,
  val keyRef: String,
  var passphrase: String?,
  val hostKey: String?,
) {
  companion object {
    fun from(raw: Map<String, Any?>) = ConnectOptions(
      attemptId = raw["attemptId"] as String,
      hostname = raw["hostname"] as String,
      port = (raw["port"] as Number).toInt(),
      username = raw["username"] as String,
      keyRef = raw["keyRef"] as String,
      passphrase = raw["passphrase"] as String?,
      hostKey = raw["hostKey"] as String?,
    )
  }
}

class T3SshModule : Module() {
  private class Connection(val attemptId: String, val promise: Promise, val passphrase: CharArray?) {
    val sessionId = UUID.randomUUID().toString()
    val client = SSHClient(DefaultConfig().apply { keepAliveProvider = KeepAliveProvider.KEEP_ALIVE })
    val trust = CompletableFuture<Boolean>()
    @Volatile var closed = false
    var settled = false
    var connected = false
    var failure: CodedException? = null
    var deadline: ScheduledFuture<*>? = null
    var deadlineVersion = 0
    var socket: Socket? = null
    var verifiedKey: String? = null
    var forward: SshForward? = null
    var network: Network? = null
    var networkCallback: ConnectivityManager.NetworkCallback? = null
    var connectivity: ConnectivityManager? = null
    val forwardLock = Any()
  }

  private val lock = Any()
  private val workers = Executors.newCachedThreadPool()
  private val cleanup = Executors.newCachedThreadPool()
  private val deadlines = Executors.newSingleThreadScheduledExecutor()
  private val attempts = mutableMapOf<String, Connection>()
  private val sessions = mutableMapOf<String, Connection>()
  private var destroyed = false
  private val keyStore by lazy { SshKeyStore(requireNotNull(appContext.reactContext).applicationContext) }

  init { SshCrypto.initialize() }

  override fun definition() = ModuleDefinition {
    Name("T3Ssh")
    Events("onHostKey", "onClosed")

    AsyncFunction("generateKey") { comment: String, promise: Promise ->
      async(promise, "SSH_KEY_INVALID", "Unable to generate private key") {
        val generated = SshKeys.generate(comment)
        SSHClient().use { SshKeys.inspect(it, generated.privateKey) }
        mapOf("keyRef" to keyStore.save(generated.privateKey), "publicKey" to generated.publicKey, "encrypted" to false)
      }
    }
    AsyncFunction("importKey") { privateKey: String, promise: Promise ->
      async(promise, "SSH_KEY_INVALID", "Unable to import private key") {
        val info = SSHClient().use { SshKeys.inspect(it, privateKey) }
        mapOf("keyRef" to keyStore.save(privateKey), "publicKey" to info.publicKey, "encrypted" to info.encrypted)
      }
    }
    AsyncFunction("deleteKey") { keyRef: String, promise: Promise ->
      async(promise, "SSH_KEY_INVALID", "Unable to delete private key") { keyStore.delete(keyRef); null }
    }
    AsyncFunction("connect") { raw: Map<String, Any?>, promise: Promise ->
      // Register before dispatch so a following cancel cannot miss queued work.
      var registered: Connection? = null
      var options: ConnectOptions? = null
      try {
        val parsed = ConnectOptions.from(raw)
        options = parsed
        validate(parsed)
        val connection = synchronized(lock) {
          check(!destroyed)
          require(!attempts.containsKey(parsed.attemptId))
          Connection(parsed.attemptId, promise, parsed.passphrase?.toCharArray()).also {
            attempts[it.attemptId] = it
          }
        }
        registered = connection
        parsed.passphrase = null
        workers.execute { connect(connection, parsed) }
      } catch (_: Exception) {
        options?.passphrase = null
        val error = sshError("SSH_OPEN_FAILED", "Unable to start SSH connection")
        registered?.let { stop(it, error) } ?: promise.reject(error)
      }
    }
    AsyncFunction("confirmHostKey") { attemptId: String, accept: Boolean, promise: Promise ->
      async(promise, "SSH_OPEN_FAILED", "Unable to confirm host key") {
        synchronized(lock) { attempts[attemptId]?.trust?.complete(accept) }
        null
      }
    }
    AsyncFunction("cancel") { attemptId: String, promise: Promise ->
      async(promise, "SSH_CANCELLED", "Unable to cancel SSH connection") {
        synchronized(lock) { attempts[attemptId] }?.let {
          stop(it, sshError("SSH_CANCELLED", "SSH connection cancelled"))
        }
        null
      }
    }
    AsyncFunction("exec") { sessionId: String, command: String, stdin: String?, timeoutMs: Double, promise: Promise ->
      async(promise, "SSH_EXEC_FAILED", "SSH command failed") {
        exec(session(sessionId), command, stdin, timeoutMs)
      }
    }
    AsyncFunction("forward") { sessionId: String, remoteHost: String, remotePort: Int, promise: Promise ->
      async(promise, "SSH_FORWARD_FAILED", "Unable to forward local port") {
        forward(session(sessionId), remoteHost, remotePort)
      }
    }
    Function("isOpen") { sessionId: String ->
      synchronized(lock) { sessions[sessionId]?.let { !it.closed && it.client.isConnected && it.client.isAuthenticated } == true }
    }
    AsyncFunction("close") { sessionId: String, promise: Promise ->
      async(promise, "SSH_SESSION_CLOSED", "Unable to close SSH session") {
        synchronized(lock) { sessions[sessionId] }?.let {
          stop(it, sshError("SSH_SESSION_CLOSED", "SSH session closed"), notify = false)
        }
        null
      }
    }
    OnDestroy {
      val active = synchronized(lock) {
        destroyed = true
        (attempts.values + sessions.values).distinct()
      }
      active.forEach { stop(it, sshError("SSH_CANCELLED", "SSH module destroyed"), notify = false) }
      deadlines.shutdownNow()
      workers.shutdownNow()
      cleanup.shutdown()
    }
  }

  private fun async(promise: Promise, code: String, message: String, body: () -> Any?) {
    try {
      workers.execute {
        try {
          promise.resolve(body())
        } catch (error: CodedException) {
          promise.reject(error)
        } catch (_: Exception) {
          promise.reject(sshError(code, message))
        }
      }
    } catch (_: Exception) {
      promise.reject(sshError(code, message))
    }
  }

  private fun validate(options: ConnectOptions) {
    require(options.attemptId.isNotBlank() && options.attemptId.length <= 128)
    require(validHost(options.hostname) && options.port in 1..65535)
    require(options.username.isNotBlank() && options.username.length <= 256 && options.username.none { it.isISOControl() })
    require(options.hostKey == null || options.hostKey!!.length <= 16384)
    require(options.passphrase == null || options.passphrase!!.length <= 65536)
  }

  private fun validHost(host: String) = host.isNotBlank() && host.length <= 253 &&
    host.none { it.isWhitespace() || it.isISOControl() || it == '/' || it == '\\' }

  private fun session(id: String): Connection = synchronized(lock) {
    sessions[id]?.takeUnless { it.closed } ?: throw sshError("SSH_SESSION_CLOSED", "SSH session is closed")
  }

  private fun checkActive(connection: Connection) {
    synchronized(lock) { connection.failure?.let { throw it } }
  }

  private fun clearDeadline(connection: Connection) {
    synchronized(lock) {
      connection.deadlineVersion++
      connection.deadline?.cancel(false)
      connection.deadline = null
    }
  }

  private fun deadline(connection: Connection, message: String) {
    synchronized(lock) {
      clearDeadline(connection)
      if (connection.closed) return
      val version = connection.deadlineVersion
      connection.deadline = deadlines.schedule({
        synchronized(lock) {
          if (!connection.closed && connection.deadlineVersion == version) {
            stop(connection, sshError("SSH_TIMEOUT", message))
          }
        }
      }, 15, TimeUnit.SECONDS)
    }
  }

  private fun connect(connection: Connection, options: ConnectOptions) {
    try {
      checkActive(connection)
      deadline(connection, "SSH connection or key exchange timed out")
      val client = connection.client
      client.connectTimeout = 15000
      // Trust confirmation has its own 60-second deadline on the reader thread.
      client.timeout = 90000
      client.transport.timeoutMs = 90000
      client.socketFactory = object : SocketFactory() {
        override fun createSocket(): Socket = synchronized(lock) {
          checkActive(connection)
          Socket().also { connection.socket = it }
        }
        override fun createSocket(host: String, port: Int): Socket = throw UnsupportedOperationException()
        override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = throw UnsupportedOperationException()
        override fun createSocket(host: InetAddress, port: Int): Socket = throw UnsupportedOperationException()
        override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = throw UnsupportedOperationException()
      }
      client.connection.keepAlive.apply {
        keepAliveInterval = 15
        (this as KeepAliveRunner).maxAliveCount = 3
      }
      client.transport.setDisconnectListener(DisconnectListener { _, message ->
        val timedOut = message?.contains("keep-alive response") == true
        stop(connection, sshError(
          if (timedOut) "SSH_TIMEOUT" else "SSH_SESSION_CLOSED",
          if (timedOut) "SSH keepalive timed out" else "SSH transport disconnected",
        ))
      })
      client.addHostKeyVerifier(verifier(connection, options.hostKey))
      watchNetwork(connection)
      checkActive(connection)
      client.connect(options.hostname, options.port)
      checkActive(connection)
      deadline(connection, "SSH authentication timed out")
      val bytes = keyStore.read(options.keyRef)
      val key = try {
        SshKeys.load(client, String(bytes, Charsets.UTF_8), connection.passphrase)
      } finally {
        bytes.fill(0)
        connection.passphrase?.fill('\u0000')
      }
      checkActive(connection)
      try {
        client.authPublickey(options.username, key)
      } catch (_: UserAuthException) {
        throw sshError("SSH_AUTH_FAILED", "SSH public key authentication failed")
      }
      synchronized(lock) {
        checkActive(connection)
        clearDeadline(connection)
        client.socket.soTimeout = 0
        client.transport.timeoutMs = 15000
        connection.connected = true
        sessions[connection.sessionId] = connection
        attempts.remove(connection.attemptId)
        connection.settled = true
        connection.promise.resolve(mapOf("sessionId" to connection.sessionId, "hostKey" to requireNotNull(connection.verifiedKey)))
      }
    } catch (error: Exception) {
      Log.w("T3Ssh", "SSH connect failed: ${error.javaClass.name}: ${error.message}")
      val failure = when (error) {
        is CodedException -> error
        is SocketTimeoutException, is TimeoutException -> sshError("SSH_TIMEOUT", "SSH connection timed out")
        else -> sshError("SSH_OPEN_FAILED", "SSH connection failed")
      }
      stop(connection, failure)
    } finally {
      options.passphrase = null
      connection.passphrase?.fill('\u0000')
      if (connection.closed) runCatching { connection.client.close() }
    }
  }

  private fun verifier(connection: Connection, pinnedKey: String?) = object : HostKeyVerifier {
    override fun findExistingAlgorithms(hostname: String, port: Int): List<String> =
      pinnedKey?.let { listOf(it.substringBefore(' ')) } ?: emptyList()

    override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
      val hostKey = SshKeys.publicKey(key)
      synchronized(lock) {
        if (connection.closed) return false
        (connection.verifiedKey ?: pinnedKey)?.let { expected ->
          if (expected != hostKey) {
            stop(connection, sshError("SSH_HOST_KEY_CHANGED", "SSH host key changed"))
            return false
          }
          connection.verifiedKey = hostKey
          return true
        }
        clearDeadline(connection)
        sendEvent("onHostKey", mapOf(
          "attemptId" to connection.attemptId,
          "hostKey" to hostKey,
          "fingerprint" to SshKeys.fingerprint(key),
        ))
      }
      val accepted = try { connection.trust.get(60, TimeUnit.SECONDS) } catch (_: Exception) { false }
      synchronized(lock) {
        if (connection.closed) return false
        if (!accepted) {
          stop(connection, sshError("SSH_HOST_KEY_REJECTED", "SSH host key rejected or confirmation timed out"))
          return false
        }
        connection.verifiedKey = hostKey
        deadline(connection, "SSH key exchange timed out")
        return true
      }
    }
  }

  private fun watchNetwork(connection: Connection) {
    val manager = requireNotNull(appContext.reactContext).getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    synchronized(lock) {
      checkActive(connection)
      connection.network = manager.activeNetwork
      val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          synchronized(lock) {
            if (connection.closed) return
            if (connection.network == null) connection.network = network
            else if (connection.network != network) stop(connection, sshError("SSH_SESSION_CLOSED", "Default network changed"))
          }
        }
        override fun onLost(network: Network) {
          synchronized(lock) {
            if (connection.network == network) stop(connection, sshError("SSH_SESSION_CLOSED", "Default network lost"))
          }
        }
      }
      manager.registerDefaultNetworkCallback(callback)
      connection.connectivity = manager
      connection.networkCallback = callback
    }
  }

  private fun stop(connection: Connection, error: CodedException, notify: Boolean = true) {
    synchronized(lock) {
      if (connection.closed) return
      connection.closed = true
      connection.failure = error
      clearDeadline(connection)
      connection.passphrase?.fill('\u0000')
      connection.trust.complete(false)
      attempts.remove(connection.attemptId, connection)
      sessions.remove(connection.sessionId)
      runCatching { connection.socket?.close() }
      val forward = connection.forward
      connection.forward = null
      forward?.stopListening()
      val callback = connection.networkCallback
      connection.networkCallback = null
      cleanup.execute {
        callback?.let { runCatching { connection.connectivity?.unregisterNetworkCallback(it) } }
        runCatching { forward?.close() }
        runCatching { connection.client.close() }
      }
      if (!connection.settled) {
        connection.settled = true
        connection.promise.reject(error)
      } else if (connection.connected && notify) {
        sendEvent("onClosed", mapOf(
          "sessionId" to connection.sessionId,
          "code" to if (error.code == "SSH_TIMEOUT") "SSH_TIMEOUT" else "SSH_SESSION_CLOSED",
          "message" to error.localizedMessage,
        ))
      }
    }
  }

  private fun forward(connection: Connection, remoteHost: String, remotePort: Int): Map<String, Int> {
    require(validHost(remoteHost) && remotePort in 1..65535)
    return synchronized(connection.forwardLock) {
      val previous = synchronized(lock) {
        checkActive(connection)
        connection.forward.also { connection.forward = null }
      }
      previous?.stopListening()
      previous?.let { cleanup.execute { it.close() } }
      val forward = SshForward(connection.client, remoteHost, remotePort, workers)
      try {
        synchronized(lock) {
          checkActive(connection)
          connection.forward = forward
        }
        workers.execute {
          try { forward.listen() } catch (_: Exception) {
            stop(connection, sshError("SSH_SESSION_CLOSED", "SSH forward listener failed"))
          }
        }
        mapOf("localPort" to forward.localPort)
      } catch (error: Exception) {
        forward.close()
        throw error
      }
    }
  }

  private fun exec(connection: Connection, command: String, stdin: String?, timeoutMs: Double): Map<String, Any> {
    require(timeoutMs.isFinite() && timeoutMs >= 1 && timeoutMs <= Long.MAX_VALUE.toDouble())
    // Own the channel before opening it so timeout also covers channel-open/exec requests.
    val channel = SessionChannel(connection.client.connection, connection.client.remoteCharset)
    val task = workers.submit<Map<String, Any>> {
      val streams = mutableListOf<Future<*>>()
      try {
        checkActive(connection)
        channel.open()
        val process = channel.exec(command)
        val completion = ExecutorCompletionService<Unit>(workers)
        var stdout = ""
        var stderr = ""
        streams.add(completion.submit(java.util.concurrent.Callable {
          stdout = readOutput(process.inputStream)
        }))
        streams.add(completion.submit(java.util.concurrent.Callable {
          stderr = readOutput(process.errorStream)
        }))
        streams.add(completion.submit(java.util.concurrent.Callable {
          process.outputStream.use { output ->
            stdin?.let { output.write(it.toByteArray(Charsets.UTF_8)) }
          }
          Unit
        }))
        // Observe any stream failure immediately, including output overflow while stdin blocks.
        repeat(3) { completion.take().get() }
        process.join()
        checkActive(connection)
        val exitCode = process.exitStatus ?: throw sshError("SSH_EXEC_FAILED", "SSH command closed without exit status")
        mapOf("stdout" to stdout, "stderr" to stderr, "exitCode" to exitCode)
      } finally {
        streams.forEach { it.cancel(true) }
      }
    }
    try {
      return task.get(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
    } catch (error: Exception) {
      if (error is TimeoutException) throw sshError("SSH_TIMEOUT", "SSH command timed out")
      if (connection.closed) throw sshError("SSH_SESSION_CLOSED", "SSH session is closed")
      var cause: Throwable? = error
      while (cause is ExecutionException) cause = cause.cause
      if (cause is CodedException) throw cause
      throw sshError("SSH_EXEC_FAILED", "SSH command failed")
    } finally {
      task.cancel(true)
      cleanup.execute { runCatching { channel.close() } }
    }
  }

  private fun readOutput(input: InputStream): String {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val count = input.read(buffer)
      if (count == -1) break
      if (output.size() + count > 4 * 1024 * 1024) throw sshError("SSH_EXEC_FAILED", "SSH command output exceeds 4 MiB")
      output.write(buffer, 0, count)
    }
    return output.toString("UTF-8")
  }
}
