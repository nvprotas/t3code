# BouncyCastle registers its algorithms by class name and SSHJ builds key
# providers and ciphers through reflection, so R8 must keep both libraries
# intact. Without this, release builds cannot parse any private key.
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
-keep class net.schmizz.** { *; }
-dontwarn net.schmizz.**
-keep class com.hierynomus.** { *; }
-dontwarn com.hierynomus.**
-keep class net.i2p.crypto.eddsa.** { *; }
-dontwarn net.i2p.crypto.eddsa.**
-dontwarn org.slf4j.**
